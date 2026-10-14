"""Coverage audit: what share of each page's words ended up in the encoding
(graph nodes, footnotes, text chunks, tables). Prints numbers only.

  python -m nccn_nav.coverage <private>
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

from .fulltext import reading_order_text
from .guideline import Spec
from .textlayer import _discussion_label, _is_reference_list

WORD = re.compile(r"[A-Za-z0-9]{3,}")
# Running header/footer words are cut by the page bands; these are what remains generic.
BOILERPLATE = {"nccn", "guidelines", "version", "national", "comprehensive", "network", "index", "table",
               "contents", "discussion", "please", "note", "rights", "reserved", "content", "may", "not",
               "the", "and", "for"}


def words(text):
    return Counter(w.lower() for w in WORD.findall(text) if w.lower() not in BOILERPLATE)


def encoded_text_by_page(private):
    private = Path(private)
    by_page = {}
    graphs = private / "merged_graphs.json"
    if not graphs.exists():
        graphs = private / "e1_graphs.json"
    for page, g in json.loads(graphs.read_text()).items():
        by_page.setdefault(page, []).extend(n["text"] for n in g["nodes"])
        by_page[page].extend(g.get("footnotes", {}).values())
    chunk_file = private / "chunks_full.json"
    if not chunk_file.exists():
        chunk_file = private / "chunks.json"
    for c in json.loads(chunk_file.read_text()):
        by_page.setdefault(c["page"], []).append(c["text"])
    tables = private / "tables.json"
    if tables.exists():
        for t in json.loads(tables.read_text()):
            by_page.setdefault(t["page"], []).append(t["markdown"])
    fn = private / "footnote_pages.json"
    if fn.exists():
        for page, text in json.loads(fn.read_text()).items():
            by_page.setdefault(page, []).append(text)
    return {p: " ".join(t) for p, t in by_page.items()}


def main(private):
    spec = Spec(private)
    doc, ids = spec.doc, spec.ids
    encoded = encoded_text_by_page(private)
    groups = {}
    for i, page in enumerate(doc):
        code = ids.get(i)
        if code is None:
            code = (_discussion_label(page) if spec.kind(i) == "discussion" else None) or f"p{i + 1}"
        if _is_reference_list(page) or i < 2:
            continue  # reference lists and cover/panel pages are intentionally not indexed
        src = words(reading_order_text(page))  # content band only: no running header/footer
        if not src:
            continue
        got = words(encoded.get(code, "") + " " + encoded.get(re.sub(r"\s.*", "", code), ""))
        covered = sum(min(n, got[w]) for w, n in src.items()) / sum(src.values())
        group = spec.kind(i)
        groups.setdefault(group, []).append(covered)
    print(f"{'page kind':12} {'pages':>5} {'mean word coverage':>19} {'min':>5}")
    for g, cov in sorted(groups.items(), key=lambda kv: kv[0]):
        print(f"{g:12} {len(cov):5} {sum(cov) / len(cov):19.2f} {min(cov):5.2f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "private")
