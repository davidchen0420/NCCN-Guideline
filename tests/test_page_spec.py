"""Page specs (re-extraction of algorithm pages typed as footnote pages), the page audit and the
integrity of the published guideline files.

  python -m pytest -q tests/test_page_spec.py
"""
import json
import sys
from pathlib import Path

import pymupdf
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nccn_nav import audit_pages, page_spec  # noqa: E402


# --- synthetic guideline: page A-2 links to A-3A, which carries a small flowchart ---------------

def _page(doc, boxes):
    p = doc.new_page(width=792, height=612)
    for (x, y), t in boxes.items():
        p.insert_text((x, y), t, fontsize=10)
    return p


@pytest.fixture()
def pack(tmp_path):
    doc = pymupdf.open()
    _page(doc, {(60, 200): "Start", (300, 200): "See TT-3A"})
    _page(doc, {(60, 200): "Workup", (300, 160): "Resectable", (300, 260): "Unresectable",
                (520, 160): "Surgery", (520, 260): "TT-5"})
    pdf = tmp_path / "g.pdf"
    doc.save(pdf)

    def node(i, page, text, bbox, role, links=()):
        return {"id": i, "page": page, "pdf_page": 1, "text": text, "lines": [text], "bbox": bbox, "line_bboxes": [bbox],
                "role": role, "footnotes": [], "links": list(links), "bbox_matches_pdf": True}
    link = {"code": "TT-3A", "part": None, "type": "page", "page": "TT-3A", "pdf_page": 2}
    page = lambda i, n, kind: {"id": i, "code": i, "part": None, "parts": None, "pdf_page": n, "kind": kind, "title": "T",
                               "section": None, "size": [792, 612], "content_band": [80, 560], "text": "", "tables": [], "footnotes": {}}
    g = {
        "format": "nccn-guideline/1", "built": "2020-01-01",
        "guideline": {"slug": "g", "title": "G", "pdf_pages": 2},
        "sections": None,
        "pages": [page("TT-2", 1, "algorithm"), page("TT-3A", 2, "footnotes"), page("TT-5", 3, "algorithm")],
        "nodes": [node("TT-2:n190_60", "TT-2", "Start", [60, 190, 90, 202], "entry"),
                  node("TT-2:n190_300", "TT-2", "See TT-3A", [300, 190, 350, 202], "leaf", [link]),
                  node("TT-5:n100_60", "TT-5", "Final", [60, 100, 90, 112], "entry")],
        "edges": [{"src": "TT-2:n190_60", "dst": "TT-2:n190_300", "evidence": "two_methods"}],
        "continuations": [], "entries": ["TT-2:n190_60", "TT-5:n100_60"],
        "schema": {"variables": {"resectable": {"type": "bool", "definition": ""},
                                 "stage": {"type": "enum", "values": ["I", "II"], "definition": ""}}, "derived": {}},
        "quality": {"clinician_validated": False},
    }
    (tmp_path / "g").mkdir()
    (tmp_path / "g" / "guideline.json").write_text(json.dumps(g))
    return page_spec.Pack(tmp_path / "g", pdf)


SPEC = {
    "page": "TT-3A", "note": "test",
    "boxes": [
        {"key": "w", "region": [50, 190, 120, 205], "decision_type": "condition",
         "predicate": {"fact": "stage", "op": "in", "value": ["I", "II"]}},
        {"key": "r", "region": [290, 150, 380, 165], "decision_type": "condition",
         "predicate": {"fact": "resectable", "op": "==", "value": True}},
        {"key": "u", "region": [290, 250, 400, 265], "decision_type": "condition",
         "predicate": {"fact": "resectable", "op": "==", "value": False}},
        {"key": "s", "region": [510, 150, 560, 165]},
        {"key": "x", "region": [510, 250, 560, 265]},
    ],
    "edges": [["w", "r"], ["w", "u"], ["r", "s"], ["u", "x"]],
}


def test_apply_makes_the_page_an_algorithm_page_and_wires_it(pack):
    pack.apply(json.loads(json.dumps(SPEC)))
    pack.wire()
    pack.link_conditions()
    g = pack.g
    page = {p["id"]: p for p in g["pages"]}["TT-3A"]
    assert page["kind"] == "algorithm" and page["kind_before"] == "footnotes" and page["reextracted"] == "test"
    nodes = {n["id"]: n for n in g["nodes"] if n["page"] == "TT-3A"}
    assert len(nodes) == 5 and all(n["bbox_matches_pdf"] for n in nodes.values())
    by_text = {n["text"]: n["id"] for n in nodes.values()}
    entry = by_text["Workup"]
    assert g["entries"].count(entry) == 1 and nodes[entry]["role"] == "entry"
    # the page's own leaf "TT-5" continues on A-5, and the leaf of A-2 that named A-3A continues into it
    assert {"src": "TT-2:n190_300", "dst": entry, "page": "TT-3A"} in g["continuations"]
    assert {"src": by_text["TT-5"], "dst": "TT-5:n100_60", "page": "TT-5"} in g["continuations"]
    assert nodes[entry]["reached_from"] == ["TT-2:n190_300"]
    q = pack.quality()
    assert q["reextracted_pages"] == ["TT-3A"] and q["algorithm_pages"] == 3 and q["entries"] == 3


def test_apply_twice_replaces_the_page(pack):
    for _ in range(2):
        pack.apply(json.loads(json.dumps(SPEC)))
        pack.wire()
    assert len([n for n in pack.g["nodes"] if n["page"] == "TT-3A"]) == 5
    assert len(pack.g["entries"]) == 3
    assert len(pack.g["continuations"]) == len({(c["src"], c["dst"]) for c in pack.g["continuations"]})


def test_predicates_must_use_the_schema(pack):
    bad = json.loads(json.dumps(SPEC))
    bad["boxes"][0]["predicate"] = {"fact": "stage", "op": "==", "value": "III"}
    with pytest.raises(ValueError, match="no value"):
        pack.apply(bad)
    bad["boxes"][0]["predicate"] = {"fact": "not_a_variable", "op": "==", "value": 1}
    with pytest.raises(ValueError, match="unknown variable"):
        pack.apply(bad)


def test_edges_must_name_boxes(pack):
    bad = json.loads(json.dumps(SPEC))
    bad["edges"].append(["w", "nope"])
    with pytest.raises(ValueError, match="unknown box"):
        pack.apply(bad)


def test_status_needs_a_predicate(pack):
    bad = json.loads(json.dumps(SPEC))
    bad["boxes"][3].update({"decision_type": "condition", "predicate_status": "model_reviewed"})
    with pytest.raises(ValueError, match="without a predicate"):
        pack.apply(bad)


# --- the audit ---------------------------------------------------------------------------------

def test_audit_signals_count_body_lines_codes_and_arrows():
    page = {"text": "WORKUP\nSee COL-5\nCOL-14\na Footnote text here\nStep → next", "footnotes": {"a": "Footnote text here"}}
    sig = audit_pages.page_signals(page, {"COL"})
    assert sig["arrows"] == 1 and sig["sees"] == 1 and sig["codes"] == 2 and sig["body"] == 4


# --- published files ---------------------------------------------------------------------------

DATA = ROOT / "data"


def _guidelines():
    index = DATA / "index.json"
    if not index.exists():
        return []
    return [row["slug"] for row in json.loads(index.read_text())["guidelines"]]


@pytest.mark.parametrize("slug", _guidelines())
def test_published_graph_is_consistent(slug):
    g = json.loads((DATA / slug / "guideline.json").read_text())
    pages = {p["id"]: p for p in g["pages"]}
    assert len(pages) == len(g["pages"]), "page ids are unique"
    ids = {n["id"] for n in g["nodes"]}
    # (two published guidelines still hold a pair of boxes with one id on different pages; the pages
    # re-extracted here must not add to that)
    new_ids = [n["id"] for n in g["nodes"] if pages[n["page"]].get("reextracted")]
    assert len(set(new_ids)) == len(new_ids), "box ids of re-extracted pages are unique"
    algo = {p for p, v in pages.items() if v["kind"] == "algorithm"}
    for n in g["nodes"]:
        assert n["page"] in algo, f"{n['id']} sits on {n['page']}, not an algorithm page"
        assert n["id"].startswith(pages[n["page"]]["code"] + ":") or pages[n["page"]].get("parts")
    for e in g["edges"]:
        assert e["src"] in ids and e["dst"] in ids, e
        assert e["src"].split(":")[0] == e["dst"].split(":")[0], f"arrow {e['src']} -> {e['dst']} leaves its page"
    algo_codes = {pages[p]["code"] for p in algo}
    for c in g["continuations"]:
        # multi-part pages are named by code here ("GALL-4"), by id elsewhere
        assert c["src"] in ids and c["dst"] in ids and (c["page"] in algo or c["page"] in algo_codes), c
    assert set(g["entries"]) <= ids
    for p in g["pages"]:
        if p.get("reextracted") and p["kind"] == "algorithm":
            assert any(n["page"] == p["id"] for n in g["nodes"]), f"{p['id']} was re-extracted but has no boxes"
            assert any(e.split(":")[0] == p["id"] or e.startswith(p["code"] + ":") for e in g["entries"]), f"{p['id']} has no entry box"
    # every condition uses variables of the guideline's schema
    known = set(g["schema"]["variables"]) | set(g["schema"].get("derived", {}))
    for n in g["nodes"]:
        for key in ("predicate", "received_predicate"):
            if n.get(key):
                assert page_spec.facts_used(n[key]) <= known, (n["id"], page_spec.facts_used(n[key]) - known)
