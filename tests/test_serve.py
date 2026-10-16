"""Tests for nccn_nav.serve: static files, the AI-decisions proxy, cache and retries.

The proxy is exercised against a stub HTTP server standing in for the Decisions API
(OPENAI_BASE_URL), so no network and no key are needed. Run: python -m pytest -q tests/test_serve.py
"""
import hashlib
import http.client
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from nccn_nav import serve  # noqa: E402

SECRET = "TOP-SECRET-OUTSIDE-THE-ROOT"
PATIENT = "PATIENT-FACT-LINE-psa=12"


# ----------------------------------------------------------------------------- fixtures

class Upstream:
    """A stand-in for the Decisions API: replays queued responses, then a default 200."""

    def __init__(self):
        self.requests = []      # (path, headers, parsed body)
        self.script = []        # [(status, body dict, headers dict)]
        self.lock = threading.Lock()
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                with outer.lock:
                    outer.requests.append((self.path, dict(self.headers), body))
                    status, payload, headers = outer.script.pop(0) if outer.script else (200, outer.default(body), {})
                raw = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                for k, v in headers.items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(raw)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/v1"

    @staticmethod
    def default(body):
        out = []
        for q in body["questions"]:
            if q["type"] == "choice":
                vals = [c["value"] for c in q["choices"]]
                out.append({"type": "choice", "name": q["name"], "choice": vals[0], "confidence": 0.9,
                            "probabilities": [{"value": v, "probability": 0.9 if i == 0 else 0.1 / max(1, len(vals) - 1)} for i, v in enumerate(vals)]})
            else:
                out.append({"type": "predicate", "name": q["name"], "probability": 0.8})
        return {"answers": out}

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def upstream():
    u = Upstream()
    yield u
    u.close()


@pytest.fixture
def site(tmp_path, upstream, monkeypatch):
    """A served root with a few files, a file outside it, and the proxy pointed at the stub."""
    outside = tmp_path / "outside.txt"
    outside.write_text(SECRET)
    root = tmp_path / "root"
    (root / "built").mkdir(parents=True)
    (root / "built" / "oncocarta.html").write_text("<!doctype html><title>x</title>")
    (root / "built" / "app.js").write_text("export const a = 1;")
    (root / "data").mkdir()
    (root / "data" / "g.json").write_text('{"a": 1}')
    (root / "Guideline").mkdir()
    (root / "Guideline" / "g.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
    (root / "notes.unknownext").write_text("hi")
    (root / ".git").mkdir()
    (root / ".git" / "config").write_text("[core]")
    (root / "link").symlink_to(outside)
    monkeypatch.setenv("OPENAI_BASE_URL", upstream.url)
    monkeypatch.setenv("OCARTA_CACHE", str(tmp_path / "cache"))
    monkeypatch.setenv("OCARTA_RETRY_BASE", "0.001")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_DECISIONS_MODEL", raising=False)
    server = serve.make_server(root, "127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
    s = type("Site", (), {})()
    s.port, s.root, s.cache = server.server_address[1], root, tmp_path / "cache"
    yield s
    server.shutdown()
    server.server_close()


def request(site, method, path, body=None, headers=None, raw_body=None):
    conn = http.client.HTTPConnection("127.0.0.1", site.port, timeout=10)
    h = dict(headers or {})
    data = raw_body
    if body is not None:
        data = json.dumps(body).encode()
        h.setdefault("Content-Type", "application/json")
    conn.request(method, path, body=data, headers=h)
    r = conn.getresponse()
    payload = r.read()
    conn.close()
    return r.status, {k.lower(): v for k, v in r.getheaders()}, payload


def post(site, body, **kw):
    status, headers, payload = request(site, "POST", "/api/decide", body=body, **kw)
    return status, json.loads(payload), headers


def good(n=1, **over):
    qs = [{"type": "choice", "name": f"n:PAGE-1:n{i}", "instructions": "Choose the branch.",
           "choices": [{"value": "PAGE-1:a", "description": "A"}, {"value": "none", "description": "None"}]} for i in range(n)]
    return {"input": f"Patient (structured answers):\n{PATIENT}", "questions": qs, **over}


# ----------------------------------------------------------------------------- static files

@pytest.mark.parametrize("path,mime", [
    ("/built/oncocarta.html", "text/html"),
    ("/built/app.js", "text/javascript"),
    ("/data/g.json", "application/json"),
    ("/Guideline/g.pdf", "application/pdf"),
])
def test_static_files_have_the_right_mime_type(site, path, mime):
    status, headers, body = request(site, "GET", path)
    assert status == 200
    assert headers["content-type"].split(";")[0] == mime
    assert int(headers["content-length"]) == len(body) > 0
    status, headers2, body2 = request(site, "HEAD", path)
    assert status == 200 and body2 == b"" and headers2["content-type"] == headers["content-type"]


def test_static_content_unknown_type_and_missing(site):
    assert request(site, "GET", "/notes.unknownext")[2] == b"hi"
    assert request(site, "GET", "/built/missing.html")[0] == 404
    assert request(site, "GET", "/built")[0] == 301           # directory without slash
    assert request(site, "GET", "/built/")[0] == 404          # no listing, no index page
    status, headers, _ = request(site, "GET", "/")
    assert status == 302 and headers["location"] == "/built/oncocarta.html"


@pytest.mark.parametrize("path", [
    "/../outside.txt", "/built/../../outside.txt", "/%2e%2e/outside.txt", "/..%2foutside.txt",
    "/built/%2e%2e/%2e%2e/outside.txt", "/%2E%2E%2Foutside.txt", "/built/..\\..\\outside.txt", "//..//outside.txt",
])
def test_directory_traversal_is_blocked(site, path):
    status, _, body = request(site, "GET", path)
    assert status in (400, 403, 404)
    assert SECRET.encode() not in body


def test_symlink_out_of_the_root_and_dot_directories_are_not_served(site):
    status, _, body = request(site, "GET", "/link")
    assert status == 403 and SECRET.encode() not in body
    assert request(site, "GET", "/.git/config")[0] == 404
    assert request(site, "GET", "/.cache/decisions/abc.json")[0] == 404


def test_static_post_is_refused(site):
    assert request(site, "POST", "/built/oncocarta.html", raw_body=b"x")[0] == 405
    assert request(site, "GET", "/api/nothing")[0] == 404


def test_server_binds_to_loopback_by_default():
    s = serve.make_server(Path(__file__).parent, port=0)
    try:
        assert s.server_address[0] == "127.0.0.1"
    finally:
        s.server_close()


# ----------------------------------------------------------------------------- status

def test_status_without_and_with_key(site, monkeypatch):
    status, _, body = request(site, "GET", "/api/decide/status")
    assert status == 200 and json.loads(body) == {"enabled": False, "model": "gpt-6-luna"}
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_DECISIONS_MODEL", "custom-model")
    assert json.loads(request(site, "GET", "/api/decide/status")[2]) == {"enabled": True, "model": "custom-model"}
    assert b"sk-test" not in request(site, "GET", "/api/decide/status")[2]


def test_decide_without_a_key_is_503(site, upstream):
    status, body, _ = post(site, good())
    assert status == 503 and "OPENAI_API_KEY" in body["error"]
    assert upstream.requests == []


def test_foreign_host_or_origin_is_refused(site, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert request(site, "GET", "/api/decide/status", headers={"Host": "evil.example"})[0] == 403
    assert post(site, good(), headers={"Origin": "https://evil.example"})[0] == 403
    assert post(site, good(), headers={"Origin": f"http://127.0.0.1:{site.port}"})[0] == 200


# ----------------------------------------------------------------------------- validation

@pytest.fixture
def keyed(site, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    return site


def test_validation_errors(keyed, upstream):
    q = good()["questions"][0]
    cases = {
        "more than 16 questions": good(17),
        "duplicate": {**good(), "questions": [q, dict(q)]},
        "no questions": {"input": "x", "questions": []},
        "questions not a list": {"input": "x", "questions": "no"},
        "missing input": {"questions": [q]},
        "input not a string": {"input": ["x"], "questions": [q]},
        "bad type": {"input": "x", "questions": [{**q, "type": "essay"}]},
        "missing name": {"input": "x", "questions": [{k: v for k, v in q.items() if k != "name"}]},
        "no instructions": {"input": "x", "questions": [{**q, "instructions": ""}]},
        "choice without choices": {"input": "x", "questions": [{k: v for k, v in q.items() if k != "choices"}]},
        "repeated choice value": {"input": "x", "questions": [{**q, "choices": [{"value": "a", "description": ""}, {"value": "a", "description": ""}]}]},
        "score without levels": {"input": "x", "questions": [{"type": "score", "name": "s", "instructions": "i"}]},
        "oversized field": {"input": "x", "questions": [{**q, "instructions": "x" * 5000}]},
        "not an object": ["x"],
    }
    for label, body in cases.items():
        status, out, _ = post(keyed, body)
        assert status == 400, label
        assert out["error"], label
    assert upstream.requests == []


def test_validation_limits_and_transport_errors(keyed, upstream):
    status, out, _ = post(keyed, good(16))
    assert status == 200 and len(out["answers"]) == 16          # exactly the limit is fine
    assert request(keyed, "POST", "/api/decide", raw_body=b"{nope", headers={"Content-Type": "application/json"})[0] == 400
    assert request(keyed, "POST", "/api/decide", raw_body=b"{}", headers={"Content-Type": "text/plain"})[0] == 415
    big = {"input": "x" * (serve.MAX_BODY + 10), "questions": good()["questions"]}
    assert post(keyed, big)[0] == 413
    assert request(keyed, "POST", "/api/decide", raw_body=b"", headers={"Content-Type": "application/json"})[0] == 400
    assert len(upstream.requests) == 1


# ----------------------------------------------------------------------------- forwarding

def test_forwarding_adds_the_key_and_model_and_returns_answers(keyed, upstream, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-forward")
    status, out, _ = post(keyed, good(2, model="attacker-model", stream=True))
    assert status == 200 and out["cached"] is False and out["model"] == "gpt-6-luna"
    assert [a["name"] for a in out["answers"]] == ["n:PAGE-1:n0", "n:PAGE-1:n1"]
    path, headers, body = upstream.requests[0]
    assert path == "/v1/decisions"
    assert headers["Authorization"] == "Bearer sk-forward"
    assert headers["Content-Type"] == "application/json"
    assert body["model"] == "gpt-6-luna" and set(body) == {"model", "input", "questions"}
    assert body["input"].endswith(PATIENT) and len(body["questions"]) == 2
    assert out["hash"] == hashlib.sha256(serve.canonical("gpt-6-luna", serve.validate_request(good(2)))).hexdigest()


def test_model_comes_from_the_environment(keyed, upstream, monkeypatch):
    monkeypatch.setenv("OPENAI_DECISIONS_MODEL", "other-model")
    post(keyed, good())
    assert upstream.requests[0][2]["model"] == "other-model"


def test_refusals_and_predicates_pass_through(keyed, upstream):
    answers = [{"type": "refusal", "name": "n:PAGE-1:n0"}, {"type": "predicate", "name": "o:PAGE-1:x", "probability": 0.25}]
    upstream.script.append((200, {"answers": answers}, {}))
    body = good()
    body["questions"].append({"type": "predicate", "name": "o:PAGE-1:x", "instructions": "This option is appropriate."})
    status, out, _ = post(keyed, body)
    assert status == 200 and out["answers"] == answers


def test_upstream_errors(keyed, upstream):
    upstream.script.append((400, {"error": {"message": "bad question"}}, {}))
    status, out, _ = post(keyed, good())
    assert status == 502 and out["upstream_status"] == 400 and out["error"] == "bad question"
    assert len(upstream.requests) == 1                              # a 400 is not retried
    upstream.script.append((200, {"unexpected": True}, {}))
    assert post(keyed, good(2))[0] == 502                           # no "answers"


def test_unreachable_upstream_is_a_gateway_timeout(keyed, monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "http://127.0.0.1:1/v1")
    status, out, _ = post(keyed, good())
    assert status == 504 and out["upstream_status"] == 0


# ----------------------------------------------------------------------------- retries

def test_retry_on_429_then_success(keyed, upstream):
    upstream.script += [(429, {"error": {"message": "slow down"}}, {"Retry-After": "0"}), (429, {"error": {}}, {}), (503, {}, {})]
    status, out, _ = post(keyed, good())
    assert status == 200 and out["cached"] is False
    assert len(upstream.requests) == 4                              # three failures, then the default 200


def test_retries_are_capped(keyed, upstream):
    upstream.script += [(429, {"error": {"message": "slow down"}}, {})] * 10
    status, out, headers = post(keyed, good())
    assert status == 429 and out["upstream_status"] == 429
    assert len(upstream.requests) == serve.MAX_RETRIES + 1
    upstream.script.clear()
    upstream.requests.clear()
    upstream.script += [(500, {}, {})] * 10
    assert post(keyed, good(2))[0] == 502
    assert len(upstream.requests) == serve.MAX_RETRIES + 1


def test_backoff_doubles_and_honours_retry_after(monkeypatch, upstream):
    monkeypatch.setenv("OPENAI_BASE_URL", upstream.url)
    monkeypatch.setenv("OCARTA_RETRY_BASE", "0.5")
    upstream.script += [(500, {}, {}), (500, {}, {}), (429, {}, {"Retry-After": "3"})]
    waits = []
    answers = serve.call_upstream(b'{"model":"m","input":"","questions":[]}', "k", upstream.url, sleep=waits.append)
    assert answers == []
    assert waits == [0.5, 1.0, 3.0]


# ----------------------------------------------------------------------------- cache

def test_cache_hit_skips_upstream_and_stores_no_request(keyed, upstream, capsys):
    s1, o1, _ = post(keyed, good(2))
    s2, o2, _ = post(keyed, good(2))
    assert (s1, s2) == (200, 200)
    assert o1["cached"] is False and o2["cached"] is True
    assert o1["answers"] == o2["answers"] and o1["hash"] == o2["hash"]
    assert len(upstream.requests) == 1
    files = list(keyed.cache.glob("*.json"))
    assert [f.stem for f in files] == [o1["hash"]]
    stored = files[0].read_text()
    assert PATIENT not in stored and "Choose the branch" not in stored      # answers only
    assert json.loads(stored)["answers"] == o1["answers"]
    # a different request, or the same one with another model, is a different entry
    post(keyed, good(3))
    assert len(upstream.requests) == 2
    log = capsys.readouterr().err
    assert "cache=hit" in log and "cache=miss" in log and o1["hash"][:12] in log


def test_cache_key_ignores_key_order_and_extra_fields(keyed, upstream):
    a = good()
    b = {"questions": [dict(reversed(list(a["questions"][0].items())))], "input": a["input"], "model": "ignored"}
    post(keyed, a)
    out = post(keyed, b)[1]
    assert out["cached"] is True and len(upstream.requests) == 1


def test_cache_depends_on_model_and_endpoint(keyed, upstream, monkeypatch):
    post(keyed, good())
    monkeypatch.setenv("OPENAI_DECISIONS_MODEL", "other-model")
    assert post(keyed, good())[1]["cached"] is False
    monkeypatch.delenv("OPENAI_DECISIONS_MODEL")
    assert post(keyed, good())[1]["cached"] is True
    other = Upstream()
    try:
        monkeypatch.setenv("OPENAI_BASE_URL", other.url)       # same request, another endpoint (a mock)
        assert post(keyed, good())[1]["cached"] is False
        assert len(other.requests) == 1
    finally:
        other.close()


def test_failed_calls_are_not_cached(keyed, upstream):
    upstream.script.append((400, {"error": {"message": "no"}}, {}))
    assert post(keyed, good())[0] == 502
    assert post(keyed, good())[1]["cached"] is False
    assert len(upstream.requests) == 2


def test_corrupt_cache_entry_is_ignored(keyed, upstream):
    key = post(keyed, good())[1]["hash"]
    (keyed.cache / f"{key}.json").write_text("{not json")
    assert post(keyed, good())[1]["cached"] is False


def test_logs_never_contain_request_bodies_or_the_key(keyed, upstream, capsys, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-very-secret")
    post(keyed, good())
    request(keyed, "GET", "/built/app.js")
    log = capsys.readouterr().err
    assert "POST /api/decide -> 200" in log and "GET /built/app.js -> 200" in log
    assert PATIENT not in log and "sk-very-secret" not in log


def test_canonical_request_is_stable():
    r1 = serve.validate_request(good(2))
    r2 = json.loads(json.dumps(r1))
    assert serve.canonical("m", r1) == serve.canonical("m", r2)
    assert serve.canonical("m", r1) != serve.canonical("n", r1)
