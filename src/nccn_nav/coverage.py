"""Coverage audit: what share of each page's words ended up in the encoding
(graph nodes, footnotes, text chunks, tables). Prints numbers only.

  python -m nccn_nav.coverage <private>
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

from .pdfvec import page_ids
from .textlayer import _discussion_label, _is_reference_list

WORD = re.compile(r"[A-Za-z0-9]{3,}")
BOILERPLATE = {"nccn", "guidelines", "version", "prostate", "cancer", "national", "comprehensive",
               "network", "index", "table", "contents", "discussion", "please", "note", "rights",
               "reserved", "content", "may", "not", "the", "and", "for"}


def words(text):
    return Counter(w.lower() for w in WORD.findall(text) if w.lower() not in BOILERPLATE)


def encoded_text_by_page(private):
    private = Path(private)
    by_page = {}
    for page, g in json.loads((private / "e1_graphs.json").read_text()).items():
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
    doc = pymupdf.open(Path(private) / "pdf" / "prostate.pdf")
    ids = page_ids(doc)
    encoded = encoded_text_by_page(private)
    groups = {}
    for i, page in enumerate(doc):
        code = ids.get(i)
        if code is None:
            code = _discussion_label(page) or f"p{i + 1}"
        if _is_reference_list(page) or i < 2:
            continue  # reference lists and cover/panel pages are intentionally not indexed
        src = words(" ".join(page.get_text().split()[30:]))  # drop the header block
        if not src:
            continue
        got = words(encoded.get(code, "") + " " + encoded.get(re.sub(r"\s.*", "", code), ""))
        covered = sum(min(n, got[w]) for w, n in src.items()) / sum(src.values())
        group = re.sub(r"\d+", "#", code.split()[0]) if code.startswith(("MS", "ST", "p")) else code
        groups.setdefault(group, []).append(covered)
    print(f"{'page group':12} {'pages':>5} {'mean word coverage':>19} {'min':>5}")
    for g, cov in sorted(groups.items(), key=lambda kv: kv[0]):
        print(f"{g:12} {len(cov):5} {sum(cov) / len(cov):19.2f} {min(cov):5.2f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "private")
