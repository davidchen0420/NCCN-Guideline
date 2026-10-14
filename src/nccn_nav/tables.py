"""Table and list pages as decision graphs.

Some NCCN pages state decisions as tables or headed lists instead of arrows. A Haiku agent
(prompts/table_decisions.md) copies them into tables_v2/<PAGE>.json as
{"tables": [{"title", "layout", "columns": [{"header", "kind"}], "rows": [{"cells": [...]}]}]}.
Here code checks every cell against the page's own text and turns the tables into the same
graph form as a flowchart:

  pathway table: t_root -> first cell -> next cell -> ... -> next-page reference, one path per
                 row; a cell repeated in consecutive rows (a span such as "Intermediate" over
                 "Favorable"/"Unfavorable intermediate") becomes one shared node.
  lookup table:  t_root -> row label -> "<column header>: <cell>" for every filled cell.

Boxes the flowchart extractor found on the page that the table covers (the same grid read as
loose boxes) are dropped with their arrows, so a page has one representation.

The first format, tables/<PAGE>.json {"rows": [{"header", "condition", "recommendation"}]},
is still read for pages without a structured table:

  t_root (page entry) -> t<i>_c (condition) -> t<i>_r (recommendation)

  python -m nccn_nav.tables check private/<slug>    rows kept/rejected per page
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

from .scoring import norm

MIN_COVER = 0.9  # share of a row's words and word pairs that must occur in the page text


def _tokens(text):
    return norm(text).split()


def page_index(lines):
    """Words and word pairs of the page: pairs within a line, plus line-end/line-start pairs
    (a table cell's wrapped lines can be interleaved with other columns in reading order)."""
    words, pairs, ends, starts = Counter(), set(), set(), set()
    for l in lines:
        t = _tokens(l["text"])
        if not t:
            continue
        words.update(t)
        pairs.update(zip(t, t[1:]))
        ends.add(t[-1])
        starts.add(t[0])
    return words, pairs, ends, starts


def coverage(text, index):
    words, pairs, ends, starts = index
    t = _tokens(text)
    if not t:
        return 1.0
    got = Counter(t) & words
    w = sum(got.values()) / len(t)
    bigrams = list(zip(t, t[1:]))
    if not bigrams:
        return w
    p = sum((a, b) in pairs or (a in ends and b in starts) for a, b in bigrams) / len(bigrams)
    return min(w, p)


def validate(rows, lines):
    """(kept, rejected): a row is kept only if its condition, recommendation and header are
    copied from the page (MIN_COVER), so paraphrased or invented rows never enter."""
    index = page_index(lines)
    kept, rejected = [], []
    for r in rows or []:
        if not isinstance(r, dict) or not (r.get("recommendation") or "").strip():
            rejected.append((r, "no recommendation"))
            continue
        bad = [k for k in ("condition", "recommendation", "header") if coverage(r.get(k) or "", index) < MIN_COVER]
        if bad:
            rejected.append((r, f"not on page: {','.join(bad)}"))
        else:
            kept.append(r)
    return kept, rejected


def _bbox_of(text, lines):
    """Box of the page line that the text starts with (for display and stable ordering)."""
    head = norm(text)[:40]
    for l in lines:
        nl = norm(l["text"])
        if nl and (head.startswith(nl[:40]) or nl.startswith(head[:len(nl)])):
            return [round(v, 1) for v in l["bbox"]]
    return [0, 0, 0, 0]


def to_graph(rows, lines, title):
    nodes = [{"id": "t_root", "text": title, "kind": "box", "bbox": [0, 0, 0, 0], "role": "table_root",
              "links": [], "footnote_refs": []}]
    edges = []
    for i, r in enumerate(rows):
        cond = (r.get("condition") or "").strip()
        header = (r.get("header") or "").strip()
        rec = r["recommendation"].strip()
        rid = f"t{i}_r"
        nodes.append({"id": rid, "text": rec, "kind": "box", "bbox": _bbox_of(rec, lines), "role": "table_rec",
                      "links": re.findall(r"\(([A-Z][A-Z0-9_/]{1,11}-[A-Z0-9]+)\)", rec), "footnote_refs": []})
        if cond:
            cid = f"t{i}_c"
            text = f"{header}: {cond}" if header and norm(header) not in norm(cond) else cond
            nodes.append({"id": cid, "text": text, "kind": "box", "bbox": _bbox_of(cond, lines),
                          "role": "table_condition", "links": [], "footnote_refs": []})
            edges += [{"src": "t_root", "dst": cid, "support": "table"}, {"src": cid, "dst": rid, "support": "table"}]
        else:
            edges.append({"src": "t_root", "dst": rid, "support": "table"})
    return nodes, edges


PAGE_REF_RE = re.compile(r"\b([A-Z][A-Z0-9_/]{1,11}-[A-Z0-9]+(?: \d+ of \d+)?)\b")
ROLE = {"condition": "table_condition", "recommendation": "table_rec", "reference": "table_ref", "note": "table_note"}


def validate_tables(tables, lines):
    """(tables with unsupported cells blanked, list of rejections). A row whose first filled
    cell is not on the page is dropped (its path would start from an invented condition)."""
    index = page_index(lines)
    out, rejected = [], []
    for t in tables or []:
        if not isinstance(t, dict):
            continue
        cols = [c if isinstance(c, dict) else {"header": str(c), "kind": "condition"} for c in t.get("columns", [])]
        for c in cols:
            if coverage(c.get("header") or "", index) < MIN_COVER:
                rejected.append((c.get("header"), "header not on page"))
                c["header"] = ""
        rows = []
        for r in t.get("rows", []):
            cells = list(r.get("cells", []) if isinstance(r, dict) else r)
            cells = [(c or "").strip() if isinstance(c, str) else "" for c in cells][:max(len(cols), 1)]
            cells += [""] * (len(cols) - len(cells))
            filled = [i for i, c in enumerate(cells) if c]
            if not filled:
                continue
            bad = [i for i in filled if coverage(cells[i], index) < MIN_COVER]
            if filled[0] in bad:
                rejected.append((cells, "first cell not on page"))
                continue
            for i in bad:
                rejected.append((cells[i], "cell not on page"))
                cells[i] = ""
            rows.append(cells)
        if rows:
            out.append({"title": (t.get("title") or "").strip(), "layout": t.get("layout", "pathway"),
                        "columns": cols, "rows": rows})
    return out, rejected


def tables_to_graph(tables, lines, title):
    nodes = [{"id": "t_root", "text": title, "kind": "box", "bbox": [0, 0, 0, 0], "role": "table_root",
              "links": [], "footnote_refs": []}]
    edges, seen = [], set()

    def add_edge(a, b):
        if (a, b) not in seen:
            seen.add((a, b))
            edges.append({"src": a, "dst": b, "support": "table"})

    def node(nid, text, role, column):
        nodes.append({"id": nid, "text": text, "kind": "box", "bbox": _bbox_of(text, lines), "role": role,
                      "column": column, "links": PAGE_REF_RE.findall(text), "footnote_refs": []})

    for ti, t in enumerate(tables):
        top = "t_root"
        if len(tables) > 1 and t["title"]:
            top = f"t{ti}"
            node(top, t["title"], "table_title", "")
            add_edge("t_root", top)
        cols = t["columns"]
        if t["layout"] == "lookup":
            for ri, cells in enumerate(t["rows"]):
                label = cells[0] or f"row {ri + 1}"
                rid = f"t{ti}_{ri}_0"
                node(rid, label, "table_condition", cols[0]["header"] if cols else "")
                add_edge(top, rid)
                for ci in range(1, len(cells)):
                    if cells[ci]:
                        head = cols[ci]["header"] if ci < len(cols) else ""
                        vid = f"t{ti}_{ri}_{ci}"
                        node(vid, f"{head}: {cells[ci]}" if head else cells[ci], "table_value", head)
                        add_edge(rid, vid)
            continue
        trie = {}  # path of (column, text) -> node id: identical leading cells share a node
        for ri, cells in enumerate(t["rows"]):
            parent, path = top, ()
            for ci, cell in enumerate(cells):
                kind = cols[ci].get("kind", "condition") if ci < len(cols) else "condition"
                if not cell:
                    continue
                if kind == "note":  # explanatory cells annotate the node before them
                    prev = next((n for n in nodes if n["id"] == parent), None)
                    if prev is not None:
                        prev.setdefault("notes", []).append(cell)
                    continue
                path += ((ci, cell),)
                if path not in trie:
                    trie[path] = f"t{ti}_{ri}_{ci}"
                    node(trie[path], cell, ROLE.get(kind, "table_condition"), cols[ci]["header"] if ci < len(cols) else "")
                add_edge(parent, trie[path])
                parent = trie[path]
    return nodes, edges


def covered(text, cells_index):
    return coverage(text, cells_index) >= MIN_COVER


def apply(root, merged):
    """Add table graphs to merged pages (called by consensus.merge_all). Returns
    {page: (kept, rejected)}."""
    from .guideline import Spec
    from .pdfvec import _text_lines, configure

    root = Path(root)
    tdir = root / "tables"
    if not tdir.exists() and not (root / "tables_v2").exists():
        return {}
    spec = Spec(root)
    configure(spec)
    report = {}
    from .guideline import fname

    for page in merged:
        f2 = root / "tables_v2" / f"{fname(page)}.json"
        if f2.exists():
            try:
                tables = json.loads(f2.read_text()).get("tables", [])
            except (json.JSONDecodeError, AttributeError):
                report[page] = (0, -1)
                continue
            lines = _text_lines(spec.doc[spec.index_of(page)])
            kept, rejected = validate_tables(tables, lines)
            report[page] = (sum(len(t["rows"]) for t in kept), len(rejected))
            if not kept:
                continue
            g = merged[page]
            title = next((n["text"] for n in g["nodes"] if n["kind"] == "header"), page)
            nodes, edges = tables_to_graph(kept, lines, f"{title} ({page})")
            # Loose boxes that are the same grid (their text lies in the table) go.
            cells = [{"text": c} for t in kept for r in t["rows"] for c in r] + \
                    [{"text": c["header"]} for t in kept for c in t["columns"]] + [{"text": t["title"]} for t in kept]
            cindex = page_index(cells)
            drop = {n["id"] for n in g["nodes"] if n["kind"] == "box" and not n["id"].startswith("t")
                    and covered(n["text"], cindex)}
            g["nodes"] = [n for n in g["nodes"] if not n["id"].startswith("t") and n["id"] not in drop] + nodes
            g["edges"] = [e for e in g["edges"] if e.get("support") != "table"
                          and e["src"] not in drop and e["dst"] not in drop] + edges
            continue
        f = tdir / f"{fname(page)}.json"
        if not f.exists():
            continue
        try:
            rows = json.loads(f.read_text()).get("rows", [])
        except (json.JSONDecodeError, AttributeError):
            report[page] = (0, -1)
            continue
        lines = _text_lines(spec.doc[spec.index_of(page)])
        kept, rejected = validate(rows, lines)
        report[page] = (len(kept), len(rejected))
        if not kept:
            continue
        g = merged[page]
        title = next((n["text"] for n in g["nodes"] if n["kind"] == "header"), page)
        nodes, edges = to_graph(kept, lines, f"{title} ({page})")
        g["nodes"] = [n for n in g["nodes"] if not n["id"].startswith("t")] + nodes
        g["edges"] = [e for e in g["edges"] if e.get("support") != "table"] + edges
    return report


if __name__ == "__main__":
    cmd, root = sys.argv[1:3]
    merged = json.loads((Path(root) / "merged_graphs.json").read_text())
    for page, (k, r) in apply(root, merged).items():
        print(f"{page}: kept {k}, rejected {r}")
