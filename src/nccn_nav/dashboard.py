"""Build the interactive guideline dashboard as one self-contained HTML file.

Reads the same private inputs as the navigator (merged_graphs.json or e1_graphs.json,
footnotes.json, predicates.json, chunks_full.json or chunks.json) and writes
<private>/viz/dashboard.html plus bundle.json. The output contains guideline text, so it
belongs in the gitignored private directory. `--sample` builds from a synthetic demo.

  python -m nccn_nav.dashboard <private>   ->  <private>/viz/dashboard.html
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


def build_bundle(private):
    graphs = _load(private, "merged_graphs.json", "e1_graphs.json")
    if graphs is None:
        raise FileNotFoundError(f"no merged_graphs.json or e1_graphs.json in {private}")
    notes = _load(private, "footnotes.json") or {}
    preds = _load(private, "predicates.json") or {}
    chunks = _load(private, "chunks_full.json", "chunks.json") or []

    pages, links, children, roots = {}, set(), {}, {}
    for page in sorted(graphs, key=_page_order):
        g = graphs[page]
        has_parent = {e["dst"] for e in g["edges"]}
        has_child = {e["src"] for e in g["edges"]}
        nodes = []
        for n in g["nodes"]:
            if n["kind"] != "box":
                continue
            nid = f"{page}:{n['id']}"
            node_links = [re.sub(r"\s.*", "", link) for link in n.get("links", [])]
            nodes.append({"id": n["id"], "text": n["text"], "bbox": n["bbox"], "pred": preds.get(nid),
                          "links": node_links,
                          "footnotes": [[r, notes[r]] for r in n.get("footnote_refs", []) if r in notes]})
            children[nid] = []
            for link in node_links:
                if link != page:
                    links.add((page, link))
        ids = {n["id"] for n in nodes}
        edges, counts = [], {}
        for e in g["edges"]:
            if e["src"] not in ids or e["dst"] not in ids:
                continue
            sup = e.get("support", "agreed")
            cls = "unsure" if "unsure" in sup else ("verified" if "verified" in sup else "agreed")
            counts[cls] = counts.get(cls, 0) + 1
            edges.append({"src": e["src"], "dst": e["dst"], "cls": cls})
            children[f"{page}:{e['src']}"].append(f"{page}:{e['dst']}")
        roots[page] = [f"{page}:{n['id']}" for n in nodes if n["id"] not in has_parent and n["id"] in has_child]
        pages[page] = {"nodes": nodes, "edges": edges, "counts": counts}

    # A leaf that points at another flow page continues on that page's entry boxes (as in navigator.py).
    for page, pg in pages.items():
        for n in pg["nodes"]:
            nid = f"{page}:{n['id']}"
            if not children[nid]:
                for link in n["links"]:
                    if link != page and link in roots and PAGE_RE.fullmatch(link):
                        children[nid] += roots[link]

    principles = sorted({c["page"] for c in chunks if c["source"] == "principles"}, key=_page_order)
    discussion = sorted({c["page"] for c in chunks if c["source"] == "discussion"}, key=_page_order)
    return {"pages": pages, "links": sorted(links), "children": children, "roots": roots,
            "chunks": chunks, "principles": principles, "discussion": discussion,
            "w": W, "top": TOP, "bottom": BOTTOM,
            "title": _load(private, "title.json") or "Guideline dashboard"}


def build(private, out_dir=None, title=None):
    bundle = build_bundle(private)
    if title:
        bundle["title"] = title
    out_dir = Path(out_dir) if out_dir else Path(private) / "viz"
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
        path, b = build(args[0] if args else "private")
    print(path, len(b["pages"]), "flow pages", sum(len(p["nodes"]) for p in b["pages"].values()), "boxes")
