"""Inputs for the Haiku steps that need page images, plus a per-guideline status report.
Everything here is deterministic; the LLM agents only read the files written here and
write their outputs where `out` says.

  python -m nccn_nav.batch render private/<slug>              page PNGs for E2 and table pages
  python -m nccn_nav.batch export-e2 private/<slug> [n]       llm/e2_batch_<k>.jsonl ({image, out})
  python -m nccn_nav.batch export-tables private/<slug> [n]   llm/table_batch_<k>.jsonl ({image, text, out})
  python -m nccn_nav.batch export-edge-review private/<slug> [n]  llm/edge_review_<k>.json
  python -m nccn_nav.batch status private [slug ...]          stage completion table
"""
import json
import sys
from pathlib import Path

from .guideline import Spec, fname
from .pdfvec import _text_lines

SCALE = 1210 / 792  # px per PDF point; prompts/edge_review.md states this scale


def _abs(p):
    return str(Path(p).resolve())


def table_pages(root):
    """Algorithm pages whose decisions are not drawn as arrows: no edges at all, or more
    than half of their boxes are orphans (lists and tables)."""
    root = Path(root)
    graphs = json.loads((root / "e1_graphs.json").read_text())
    out = []
    for code, g in graphs.items():
        boxes = [n for n in g["nodes"] if n["kind"] == "box"]
        orphans = sum(n.get("role") == "orphan" for n in boxes)
        if boxes and (not g["edges"] or orphans > 0.5 * len(boxes)):
            out.append(code)
    return out


def e2_pages(root):
    return json.loads((Path(root) / "redflags.json").read_text())["e2_pages"]


def render(root):
    root = Path(root)
    spec = Spec(root)
    (root / "render").mkdir(exist_ok=True)
    pages = list(dict.fromkeys(e2_pages(root) + table_pages(root)))
    made = 0
    for code in pages:
        out = root / "render" / f"{fname(code)}.png"
        if not out.exists():
            spec.doc[spec.index_of(code)].get_pixmap(matrix=_matrix()).save(out)
            made += 1
    print(f"{root.name}: {len(pages)} pages to render, {made} new")


def _matrix():
    import pymupdf

    return pymupdf.Matrix(SCALE, SCALE)


def _write_batches(root, name, rows, per):
    (root / "llm").mkdir(exist_ok=True)
    for old in (root / "llm").glob(f"{name}_*.json*"):
        old.unlink()
    paths = []
    for k in range(0, len(rows), per):
        path = root / "llm" / f"{name}_{k // per}.jsonl"
        path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows[k:k + per]))
        paths.append(_abs(path))
    return paths


def export_e2(root, per=8):
    root = Path(root)
    (root / "e2").mkdir(exist_ok=True)
    rows = [{"page": c, "image": _abs(root / "render" / f"{fname(c)}.png"), "out": _abs(root / "e2" / f"{fname(c)}.json")}
            for c in e2_pages(root) if not (root / "e2" / f"{fname(c)}.json").exists()]
    paths = _write_batches(root, "e2_batch", rows, int(per))
    print(f"{root.name}: {len(rows)} E2 pages in {len(paths)} batches")
    return paths


def export_tables(root, per=4):
    """Each table page gets its image and its own text lines (top to bottom, with x/y), so the
    agent copies text instead of reading it off the image."""
    root = Path(root)
    spec = Spec(root)
    (root / "tables").mkdir(exist_ok=True)
    rows = []
    for c in table_pages(root):
        if (root / "tables" / f"{fname(c)}.json").exists():
            continue
        lines = sorted(_text_lines(spec.doc[spec.index_of(c)]), key=lambda l: (round(l["bbox"][1]), l["bbox"][0]))
        text_path = root / "llm" / f"table_text_{fname(c)}.txt"
        (root / "llm").mkdir(exist_ok=True)
        text_path.write_text("\n".join(f"y={l['bbox'][1]:.0f} x={l['bbox'][0]:.0f} | {l['text']}" for l in lines))
        rows.append({"page": c, "image": _abs(root / "render" / f"{fname(c)}.png"), "text": _abs(text_path),
                     "out": _abs(root / "tables" / f"{fname(c)}.json")})
    paths = _write_batches(root, "table_batch", rows, int(per))
    print(f"{root.name}: {len(rows)} table pages in {len(paths)} batches")
    return paths


def _pos(bbox, w=792, h=612):
    x = (bbox[0] + bbox[2]) / 2
    col = "left" if x < w / 3 else ("center" if x < 2 * w / 3 else "right")
    row = "top" if bbox[1] < h / 3 else ("middle" if bbox[1] < 2 * h / 3 else "bottom")
    return f"{row}-{col}, y={bbox[1]:.0f}"


def export_edge_review(root, per=6):
    """Disputed arrows (found by only one extractor) on pages that have an E2 extraction and
    no verdict yet. Pages without E2 have nothing to dispute."""
    root = Path(root)
    merged = json.loads((root / "merged_graphs.json").read_text())
    (root / "review").mkdir(exist_ok=True)
    done = set()
    for f in (root / "review").glob("edge_verdicts_*.json"):
        done |= set(json.loads(f.read_text()))
    pages = []
    for page, g in merged.items():
        if not (root / "e2" / f"{fname(page)}.json").exists():
            continue
        nodes = {n["id"]: n for n in g["nodes"]}
        w, h = g.get("page_size") or (792, 612)
        edges = []
        for e in g["edges"]:
            eid = f"{page}:{e['src']}->{e['dst']}"
            if e.get("support") in ("e1_only", "e2_only") and eid not in done:
                a, b = nodes[e["src"]], nodes[e["dst"]]
                edges.append({"edge_id": eid, "from": a["text"][:90], "from_pos": _pos(a["bbox"], w, h),
                              "to": b["text"][:90], "to_pos": _pos(b["bbox"], w, h)})
        if edges:
            pages.append({"slug": root.name, "page": page, "image": _abs(root / "render" / f"{fname(page)}.png"),
                          "out": _abs(root / "review" / f"edge_verdicts_{fname(page)}.json"), "edges": edges})
    (root / "llm").mkdir(exist_ok=True)
    for old in (root / "llm").glob("edge_review_*.json"):
        old.unlink()
    paths = []
    for k in range(0, len(pages), int(per)):
        path = root / "llm" / f"edge_review_{k // int(per)}.json"
        path.write_text(json.dumps(pages[k:k + int(per)], ensure_ascii=False, indent=1))
        paths.append(_abs(path))
    print(f"{root.name}: {sum(len(p['edges']) for p in pages)} disputed edges on {len(pages)} pages, "
          f"{len(paths)} batches")
    return paths


def status_one(root):
    root = Path(root)
    row = {"slug": root.name}
    if not (root / "e1_graphs.json").exists():
        return row
    graphs = json.loads((root / "e1_graphs.json").read_text())
    want_e2, want_t = e2_pages(root), table_pages(root)
    row["pages"] = len(graphs)
    row["e2"] = f"{sum((root / 'e2' / f'{fname(c)}.json').exists() for c in want_e2)}/{len(want_e2)}"
    row["tables"] = f"{sum((root / 'tables' / f'{fname(c)}.json').exists() for c in want_t)}/{len(want_t)}"
    merged = root / "merged_graphs.json"
    if merged.exists():
        m = json.loads(merged.read_text())
        counts = {}
        for g in m.values():
            for e in g["edges"]:
                counts[e.get("support", "?")] = counts.get(e.get("support", "?"), 0) + 1
        row["edges"] = counts
    schema = root / "fact_schema.json"
    if schema.exists():
        from .facts import schema_problems

        s = json.loads(schema.read_text())
        row["schema"] = f"{len(s.get('variables', {}))}v/{len(s.get('derived', {}))}d"
        row["schema_problems"] = len(schema_problems(s))
    preds = root / "predicates.json"
    if preds.exists():
        p = json.loads(preds.read_text())
        row["predicates"] = f"{sum(v is not None for v in p.values())}/{len(p)}"
    st = root / "predicates_status.json"
    if st.exists():
        s = json.loads(st.read_text())
        row["reviewed"] = len(s["reviewed_correct"]) + len(s["rejected"])
    return row


def status(private, *slugs):
    private = Path(private)
    roots = [private / s for s in slugs] if slugs else sorted(
        p for p in private.iterdir() if (p / "pdf" / f"{p.name}.pdf").exists())
    rows = [status_one(r) for r in roots]
    for r in rows:
        print(json.dumps(r))
    return rows


if __name__ == "__main__":
    cmd, root, *rest = sys.argv[1:]
    {"render": render, "export-e2": export_e2, "export-tables": export_tables,
     "export-edge-review": export_edge_review, "status": status}[cmd](root, *rest)
