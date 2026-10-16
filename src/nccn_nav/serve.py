"""Local web server for OncoCarta: static files plus an optional AI-decisions proxy.

    OPENAI_API_KEY=... python -m nccn_nav.serve [--port 8000] [--root <repo>] [--host 127.0.0.1]

Serves the repository statically (so ``built/oncocarta.html`` works exactly as under
``python -m http.server``, with correct MIME types) and adds two endpoints used by the app:

    GET  /api/decide/status   -> {"enabled": bool, "model": str}
    POST /api/decide          -> {"answers": [...], "model": str, "cached": bool, "hash": str}

``POST /api/decide`` takes ``{"input": str, "questions": [...]}`` (at most 16 questions with unique
names, at most 200 KB), forwards it to the OpenAI Decisions API with the server-side key and model,
and returns the upstream ``answers``. The API key never reaches the browser.

Environment:
    OPENAI_API_KEY          required for AI; without it POST /api/decide answers 503
    OPENAI_DECISIONS_MODEL  model id (default below)
    OPENAI_BASE_URL         default https://api.openai.com/v1 (point it at a mock for tests)
    OCARTA_CACHE            answer cache directory (default <root>/.cache/decisions)
    OCARTA_RETRY_BASE       first retry delay in seconds (default 0.5, doubled each retry)

Privacy: request bodies are never logged. The cache stores only the upstream answers under the
SHA-256 of the canonical request, never the request itself. Dot-directories (.git, .cache) are not
served. Python standard library only.
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import mimetypes
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_MODEL = "gpt-6-luna"
DEFAULT_BASE_URL = "https://api.openai.com/v1"
MAX_QUESTIONS = 16          # the API documents no limit: batch conservatively
MAX_BODY = 200 * 1024       # bytes accepted from the browser
UPSTREAM_TIMEOUT = 30.0     # seconds per upstream attempt
MAX_RETRIES = 3             # retries after the first attempt (429, 5xx, connection errors)
MAX_RETRY_WAIT = 10.0       # cap on one wait, also on a Retry-After header
QUESTION_TYPES = ("predicate", "choice", "score")

# Caps per field, so a single request cannot be padded to the body limit with one string.
MAX_NAME = 200
MAX_INSTRUCTIONS = 4000
MAX_DESCRIPTION = 2000
MAX_CHOICES = 64
MAX_LEVELS = 16

REPO_ROOT = Path(__file__).resolve().parents[2]

MIME = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
}


# ----------------------------------------------------------------------------- configuration
# Read from the environment at each use, so tests (and a restarted shell) need no reload.

def api_key() -> str:
    return os.environ.get("OPENAI_API_KEY", "").strip()


def model_name() -> str:
    return os.environ.get("OPENAI_DECISIONS_MODEL", "").strip() or DEFAULT_MODEL


def base_url() -> str:
    return (os.environ.get("OPENAI_BASE_URL", "").strip() or DEFAULT_BASE_URL).rstrip("/")


def retry_base() -> float:
    try:
        return max(0.0, float(os.environ.get("OCARTA_RETRY_BASE", "0.5")))
    except ValueError:
        return 0.5


def cache_dir(root: Path) -> Path:
    env = os.environ.get("OCARTA_CACHE", "").strip()
    return Path(env) if env else root / ".cache" / "decisions"


# ----------------------------------------------------------------------------- validation

class BadRequest(ValueError):
    pass


def _text(value, what: str, cap: int, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise BadRequest(f"{what} must be a string")
    if not allow_empty and not value.strip():
        raise BadRequest(f"{what} must not be empty")
    if len(value) > cap:
        raise BadRequest(f"{what} is longer than {cap} characters")
    return value


def validate_request(body) -> dict:
    """Check a browser request and return a clean copy with only the fields that are forwarded."""
    if not isinstance(body, dict):
        raise BadRequest("body must be a JSON object")
    text = _text(body.get("input"), "input", MAX_BODY, allow_empty=True)
    questions = body.get("questions")
    if not isinstance(questions, list) or not questions:
        raise BadRequest("questions must be a non-empty list")
    if len(questions) > MAX_QUESTIONS:
        raise BadRequest(f"at most {MAX_QUESTIONS} questions per request")
    clean, names = [], set()
    for i, q in enumerate(questions):
        where = f"questions[{i}]"
        if not isinstance(q, dict):
            raise BadRequest(f"{where} must be an object")
        name = _text(q.get("name"), f"{where}.name", MAX_NAME)
        if name in names:
            raise BadRequest(f"duplicate question name {name!r}")
        names.add(name)
        kind = q.get("type")
        if kind not in QUESTION_TYPES:
            raise BadRequest(f"{where}.type must be one of {', '.join(QUESTION_TYPES)}")
        item = {"type": kind, "name": name, "instructions": _text(q.get("instructions"), f"{where}.instructions", MAX_INSTRUCTIONS)}
        if kind == "choice":
            item["choices"] = _options(q.get("choices"), where + ".choices", "value", MAX_CHOICES)
        elif kind == "score":
            item["levels"] = _options(q.get("levels"), where + ".levels", "label", MAX_LEVELS)
        clean.append(item)
    return {"input": text, "questions": clean}


def _options(raw, where: str, key: str, cap: int) -> list:
    if not isinstance(raw, list) or not raw:
        raise BadRequest(f"{where} must be a non-empty list")
    if len(raw) > cap:
        raise BadRequest(f"{where} has more than {cap} entries")
    out, seen = [], set()
    for j, c in enumerate(raw):
        if not isinstance(c, dict):
            raise BadRequest(f"{where}[{j}] must be an object")
        k = _text(c.get(key), f"{where}[{j}].{key}", MAX_NAME)
        if k in seen:
            raise BadRequest(f"{where} repeats {k!r}")
        seen.add(k)
        out.append({key: k, "description": _text(c.get("description"), f"{where}[{j}].description", MAX_DESCRIPTION, allow_empty=True)})
    return out


def canonical(model: str, req: dict) -> bytes:
    """The request as sent upstream, in a fixed form: the cache key is the SHA-256 of these bytes."""
    payload = {"model": model, "input": req["input"], "questions": req["questions"]}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


# ----------------------------------------------------------------------------- cache

class Cache:
    """Answers on disk, one small JSON file per request hash. Holds no patient data."""

    def __init__(self, directory: Path):
        self.dir = directory

    def _path(self, key: str) -> Path:
        return self.dir / f"{key}.json"

    def get(self, key: str, base: str):
        try:
            data = json.loads(self._path(key).read_text("utf-8"))
        except (OSError, ValueError):
            return None
        # An entry written against another endpoint (a mock, a proxy) is not an answer from this one.
        if not isinstance(data, dict) or data.get("base_url") != base or not isinstance(data.get("answers"), list):
            return None
        return data["answers"]

    def put(self, key: str, base: str, model: str, answers: list) -> None:
        try:
            self.dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd, tmp = tempfile.mkstemp(dir=self.dir, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"base_url": base, "model": model, "created": int(time.time()), "answers": answers}, f)
            os.replace(tmp, self._path(key))
        except OSError:
            pass  # a cache that cannot be written is only slower


# ----------------------------------------------------------------------------- upstream

class UpstreamError(Exception):
    def __init__(self, status: int, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.status, self.message, self.retry_after = status, message, retry_after


def _error_message(raw: bytes) -> str:
    try:
        err = json.loads(raw.decode("utf-8", "replace")).get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err.get("code") or "")[:300]
        if isinstance(err, str):
            return err[:300]
    except (ValueError, AttributeError):
        pass
    return ""


def _retry_after(headers) -> float | None:
    try:
        return min(MAX_RETRY_WAIT, max(0.0, float(headers.get("Retry-After"))))
    except (TypeError, ValueError):
        return None


def call_upstream(payload: bytes, key: str, base: str, sleep=time.sleep) -> list:
    """POST the request to <base>/decisions, retrying 429, 5xx and connection failures with backoff."""
    url = base + "/decisions"
    delay = retry_base()
    last: UpstreamError | None = None
    for attempt in range(MAX_RETRIES + 1):
        if attempt:
            wait = last.retry_after if last is not None and last.retry_after is not None else delay * 2 ** (attempt - 1)
            sleep(min(MAX_RETRY_WAIT, wait))
        req = urllib.request.Request(url, data=payload, method="POST", headers={
            "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json",
            "User-Agent": "oncocarta-serve",
        })
        try:
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raw = e.read() if hasattr(e, "read") else b""
            last = UpstreamError(e.code, _error_message(raw) or HTTPStatus(e.code).phrase, _retry_after(e.headers))
            if e.code == 429 or e.code >= 500:
                continue
            raise last
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException, OSError) as e:
            last = UpstreamError(0, f"could not reach the Decisions API ({type(e).__name__})")
            continue
        except ValueError:
            raise UpstreamError(502, "the Decisions API returned something that is not JSON")
        answers = data.get("answers") if isinstance(data, dict) else None
        if not isinstance(answers, list):
            raise UpstreamError(502, "the Decisions API response has no answers")
        return answers
    assert last is not None
    raise last


# ----------------------------------------------------------------------------- handler

def _loopback(host: str) -> bool:
    return host in ("127.0.0.1", "::1", "localhost") or host.startswith("127.")


class Handler(SimpleHTTPRequestHandler):
    server_version = "OncoCarta"
    protocol_version = "HTTP/1.1"
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **MIME}
    # set by make_server
    root: Path = REPO_ROOT
    cache: Cache
    check_host: bool = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(self.root), **kwargs)

    # -- logging: method, path (no query), status, cache hit, hash; never a body or a header
    def log_message(self, format, *args):  # noqa: A002
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), format % args))

    def log_request(self, code="-", size="-"):
        extra = getattr(self, "_log_extra", "")
        path = urllib.parse.urlsplit(self.path).path
        code = code.value if isinstance(code, HTTPStatus) else code
        self.log_message("%s %s -> %s%s", self.command, path, code, extra)

    # -- helpers
    def _json(self, status: int, obj, headers: dict | None = None):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if status >= 400 and self.command == "POST":
            self.close_connection = True   # the request body may be unread
            self.send_header("Connection", "close")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        return MIME.get(ext) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"

    def resolve(self, url_path: str):
        """URL path -> (file under the root, None), or (None, HTTP status).

        No '..' (403), no dot-directories such as .git or .cache (404), no symlink out of the root (403).
        """
        path = urllib.parse.unquote(urllib.parse.urlsplit(url_path).path, errors="replace")
        if "\x00" in path or "\\" in path:
            return None, 400
        parts = [p for p in path.split("/") if p not in ("", ".")]
        if any(p == ".." for p in parts):
            return None, 403
        if any(p.startswith(".") for p in parts):
            return None, 404
        root = self.root.resolve()
        target = root.joinpath(*parts)
        try:
            target.resolve().relative_to(root)
        except (ValueError, OSError, RuntimeError):
            return None, 403
        return target, None

    def translate_path(self, path):   # used by the base class only; send_head below does the real work
        target, _ = self.resolve(path)
        return str(target) if target else str(self.root / ".missing")

    def _host_ok(self) -> bool:
        """While bound to loopback, refuse DNS-rebinding (foreign Host) and cross-site (foreign Origin) requests."""
        if not self.check_host:
            return True
        hostport = (self.headers.get("Host") or "").strip().lower()
        host = hostport[1:].split("]")[0] if hostport.startswith("[") else hostport.rsplit(":", 1)[0]
        if not _loopback(host):
            return False
        origin = self.headers.get("Origin")
        if origin is not None and urllib.parse.urlsplit(origin).netloc.lower() != hostport:
            return False
        return True

    # -- routes
    def do_GET(self):
        route = urllib.parse.urlsplit(self.path).path
        if not self._host_ok():
            return self._json(403, {"error": "forbidden host or origin"})
        if route == "/api/decide/status":
            return self._json(200, {"enabled": bool(api_key()), "model": model_name()})
        if route.startswith("/api/"):
            return self._json(404, {"error": "unknown endpoint"})
        self._static()

    def do_HEAD(self):
        route = urllib.parse.urlsplit(self.path).path
        if not self._host_ok():
            return self._json(403, {"error": "forbidden host or origin"})
        if route.startswith("/api/"):
            return self._json(405, {"error": "use GET or POST"})
        self._static()

    def do_POST(self):
        route = urllib.parse.urlsplit(self.path).path
        if route == "/api/decide":
            return self._decide()
        self._json(404 if route.startswith("/api/") else 405, {"error": "unknown endpoint" if route.startswith("/api/") else "method not allowed"})

    def _static(self):
        route = urllib.parse.urlsplit(self.path).path
        if route == "/":
            self.send_response(302)
            self.send_header("Location", "/index.html" if (self.root / "index.html").is_file() else "/built/oncocarta.html")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        local, status = self.resolve(self.path)
        if local is not None and local.is_dir() and not route.endswith("/"):
            self.send_response(301)
            self.send_header("Location", route + "/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if local is None:
            return self.send_error(status)
        super().do_GET() if self.command == "GET" else super().do_HEAD()

    def send_head(self):
        """Headers for a plain file (a directory serves its index page; no listings)."""
        local, status = self.resolve(self.path)
        if local is not None and local.is_dir():
            local = next((local / n for n in ("index.html", "index.htm") if (local / n).is_file()), None)
            status = 404
        if local is None:
            self.send_error(status)
            return None
        try:
            f = open(local, "rb")
        except OSError:
            self.send_error(404)
            return None
        try:
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(local))
            self.send_header("Content-Length", str(os.fstat(f.fileno()).st_size))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return f
        except Exception:
            f.close()
            raise

    def _decide(self):
        self._log_extra = ""
        if not self._host_ok():
            return self._json(403, {"error": "forbidden host or origin"})
        if not api_key():
            return self._json(503, {"error": "AI decisions are off: start the server with OPENAI_API_KEY set"})
        if "application/json" not in (self.headers.get("Content-Type") or "").lower():
            return self._json(415, {"error": "send application/json"})
        try:
            length = int(self.headers.get("Content-Length") or "")
        except ValueError:
            return self._json(411, {"error": "Content-Length is required"})
        if length < 0:
            return self._json(400, {"error": "bad Content-Length"})
        if length > MAX_BODY:
            return self._json(413, {"error": f"request is larger than {MAX_BODY // 1024} KB"})
        raw = self.rfile.read(length)
        try:
            req = validate_request(json.loads(raw.decode("utf-8")))
        except (ValueError, UnicodeDecodeError) as e:
            return self._json(400, {"error": str(e) if isinstance(e, BadRequest) else "body is not valid JSON"})
        model, base = model_name(), base_url()
        payload = canonical(model, req)
        key = hashlib.sha256(payload).hexdigest()
        cache = Cache(cache_dir(self.root))
        answers = cache.get(key, base)
        if answers is not None:
            self._log_extra = f" cache=hit hash={key[:12]}"
            return self._json(200, {"answers": answers, "model": model, "cached": True, "hash": key})
        try:
            answers = call_upstream(payload, api_key(), base)
        except UpstreamError as e:
            self._log_extra = f" cache=miss hash={key[:12]} upstream={e.status}"
            status = 429 if e.status == 429 else 504 if e.status == 0 else 502
            headers = {"Retry-After": str(int(e.retry_after))} if status == 429 and e.retry_after else None
            return self._json(status, {"error": e.message, "upstream_status": e.status}, headers)
        cache.put(key, base, model, answers)
        self._log_extra = f" cache=miss hash={key[:12]}"
        self._json(200, {"answers": answers, "model": model, "cached": False, "hash": key})


def make_server(root: Path | str = REPO_ROOT, host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer:
    """Build (not start) the server; port 0 picks a free port (``server.server_address[1]``)."""
    root = Path(root).resolve()
    handler = type("BoundHandler", (Handler,), {"root": root, "check_host": _loopback(host)})
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m nccn_nav.serve", description=__doc__.split("\n\n")[0])
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1", help="bind address (default: this computer only)")
    ap.add_argument("--root", default=str(REPO_ROOT), help="folder to serve (default: the repository)")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()
    if not root.is_dir():
        ap.error(f"--root {root} is not a folder")
    server = make_server(root, args.host, args.port)
    state = f"AI decisions ON (model {model_name()})" if api_key() else "AI decisions OFF (set OPENAI_API_KEY to enable)"
    print(f"Serving {root} at http://{args.host}:{server.server_address[1]}/built/oncocarta.html\n{state}", file=sys.stderr)
    if not _loopback(args.host):
        print("Warning: bound beyond this computer; anyone who can reach the port can use your API key.", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
