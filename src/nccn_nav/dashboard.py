"""Build the interactive guideline dashboard as one self-contained HTML file.

Reads the processed guideline folder (merged_graphs.json or e1_graphs.json, footnotes.json,
fact_schema.json, llm/pred_out_*.json predicate drafts, chunks_full.json) and writes
private/viz/dashboard.html plus bundle.json. The output contains guideline text, so it
belongs in the gitignored private directory. `--sample` builds from a synthetic demo.

  python -m nccn_nav.dashboard [data_dir]  ->  private/viz/dashboard.html (default data_dir: data/prostate)
  python -m nccn_nav.dashboard --sample    ->  <tmp or ./sample_out>/dashboard.html
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
W, H = 792, 612  # PDF page size in points
TOP, BOTTOM = 85, 560
PAGE_RE = re.compile(r"[A-Z]+-\d+")


def _page_order(page):
    m = re.fullmatch(r"([A-Z]+)-(\d+)", page)
    return (m.group(1), int(m.group(2))) if m else (page, 0)


def _load(private, *names):
    for name in names:
        path = Path(private) / name
        if path.exists():
            return json.loads(path.read_text())
    return None


def footnote_text(store, page, letter):
    """Same lookup as pdfvec.footnote_text (letters repeat across pages)."""
    for code in (page, page + "A"):
        if letter in store.get(code, {}):
            return store[code][letter]
    prefix = page.split("-")[0] + "-"
    for code, notes in store.items():
        if code.startswith(prefix) and letter in notes:
            return notes[letter]
    return None


def load_predicates(private):
    """Current predicates: position-id keys from the LLM drafting rounds (null = none).
    Stale entries (e.g. old sequential ids in predicates.json) are dropped by the caller
    because they match no box in the current graph."""
    preds, draft = {}, False
    path = Path(private) / "predicates.json"
    if path.exists():
        preds.update({k: v for k, v in json.loads(path.read_text()).items() if v})
    for f in sorted((Path(private) / "llm").glob("pred_out_*.json")):
        out = json.loads(f.read_text())
        preds.update({k: v for k, v in out.items() if v})
        draft = True
    return preds, draft


def build_bundle(private):
    graphs = _load(private, "merged_graphs.json", "e1_graphs.json")
    if graphs is None:
        raise FileNotFoundError(f"no merged_graphs.json or e1_graphs.json in {private}")
    notes = _load(private, "footnotes.json") or {}
    preds, preds_draft = load_predicates(private)
    valid = {f"{pg}:{n['id']}" for pg, g in graphs.items() for n in g["nodes"]}
    preds = {k: v for k, v in preds.items() if k in valid}
    preds_draft = preds_draft and bool(preds)
    schema = _load(private, "fact_schema.json") or {"variables": {}, "derived": {}}
    chunks = _load(private, "chunks_full.json", "chunks.json") or []
    chunks = [c for c in chunks if c.get("source") in ("principles", "principles-table", "discussion", "staging", "staging-table")]
    for c in chunks:  # fold table variants into their section so the sidebar groups sensibly
        c["source"] = c["source"].split("-")[0]

    pages, links, children, roots = {}, set(), {}, {}
    for page in sorted(graphs, key=_page_order):
        g = graphs[page]
        has_parent = {e["dst"] for e in g["edges"]}
        has_child = {e["src"] for e in g["edges"]}
        nodes = []
        for n in g["nodes"]:
            nid = f"{page}:{n['id']}"
            node_links = [re.sub(r"\s.*", "", link) for link in n.get("links", [])]
            fns = [[r, footnote_text(notes, page, r)] for r in n.get("footnote_refs", [])]
            nodes.append({"id": n["id"], "kind": n.get("kind", "box"), "text": n["text"], "bbox": n["bbox"],
                          "pred": preds.get(nid), "links": node_links, "role": n.get("role"),
                          "footnotes": [f for f in fns if f[1]]})
            if n.get("kind", "box") == "box":
                children[nid] = []
                for link in node_links:
                    if link != page:
                        links.add((page, link))
        ids = {n["id"] for n in nodes if n["kind"] == "box"}
        edges, counts = [], {}
        for e in g["edges"]:
            if e["src"] not in ids or e["dst"] not in ids:
                continue
            sup = e.get("support", "agreed")
            cls = "unsure" if ("unsure" in sup or sup.endswith("_only")) else ("verified" if "verified" in sup else "agreed")
            counts[cls] = counts.get(cls, 0) + 1
            edges.append({"src": e["src"], "dst": e["dst"], "cls": cls})
            children[f"{page}:{e['src']}"].append(f"{page}:{e['dst']}")
        roots[page] = [f"{page}:{n['id']}" for n in nodes
                       if n["kind"] == "box" and n["id"] not in has_parent and n["id"] in has_child]
        pages[page] = {"nodes": nodes, "edges": edges, "counts": counts}

    # A leaf that points at another flow page continues on that page's entry boxes (as in navigator.py).
    for page, pg in pages.items():
        for n in pg["nodes"]:
            nid = f"{page}:{n['id']}"
            if n["kind"] == "box" and not children[nid]:
                for link in n["links"]:
                    if link != page and link in roots and PAGE_RE.fullmatch(link):
                        children[nid] += roots[link]

    def codes(source):
        return sorted({c["page"] for c in chunks if c["source"] == source}, key=_page_order)

    return {"pages": pages, "links": sorted(links), "children": children, "roots": roots,
            "chunks": chunks, "principles": codes("principles"), "discussion": codes("discussion"),
            "schema": schema, "preds_draft": preds_draft,
            "w": W, "top": TOP, "bottom": BOTTOM,
            "title": _load(private, "title.json") or "Guideline dashboard"}


def build(private, out_dir=None, title=None):
    bundle = build_bundle(private)
    if title:
        bundle["title"] = title
    out_dir = Path(out_dir) if out_dir else Path("private") / "viz"
    out_dir.mkdir(parents=True, exist_ok=True)
    template = (HERE / "dashboard.html").read_text()
    doc = (template.replace("/*PREDICATES_JS*/", (HERE / "predicates.js").read_text())
           .replace("/*BUNDLE*/null", json.dumps(bundle).replace("</", "<\\/")))
    (out_dir / "bundle.json").write_text(json.dumps(bundle))
    out = out_dir / "dashboard.html"
    out.write_text(doc)
    return out, bundle


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--sample":
        out_dir = Path(args[1]) if len(args) > 1 else Path("sample_out")
        path, b = build(HERE / "sample", out_dir, "Sample guideline (synthetic demo data)")
    else:
        path, b = build(args[0] if args else "data/prostate")
    print(path, len(b["pages"]), "flow pages", sum(len(p["nodes"]) for p in b["pages"].values()), "boxes")
