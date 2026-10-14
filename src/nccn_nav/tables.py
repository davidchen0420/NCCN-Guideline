"""Table and list pages as decision graphs.

Some NCCN pages state decisions as tables or headed lists instead of arrows. A Haiku agent
(prompts/table_decisions.md) copies their rows into tables/<PAGE>.json as
{"rows": [{"header", "condition", "recommendation"}]}. Here code checks every row against
the page's own text and turns the kept rows into the same graph form as a flowchart:

  t_root (page entry) -> t<i>_c (condition) -> t<i>_r (recommendation)

A row without a condition (a plain list item) links the root straight to its recommendation.
The predicates step then writes conditions for the t<i>_c nodes like any other branch.

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


def apply(root, merged):
    """Add table graphs to merged pages (called by consensus.merge_all). Returns
    {page: (kept, rejected)}."""
    from .guideline import Spec
    from .pdfvec import _text_lines, configure

    root = Path(root)
    tdir = root / "tables"
    if not tdir.exists():
        return {}
    spec = Spec(root)
    configure(spec)
    report = {}
    from .guideline import fname

    for page in merged:
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
