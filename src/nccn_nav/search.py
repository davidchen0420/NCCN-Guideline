"""Strategy A2 tool: plain BM25 retrieval over the whole guideline (flow pages flattened to
text, plus Principles and Discussion chunks). No graph structure.

  python -m nccn_nav.search <private> "<query>" [k]
"""
import json
import sys
from pathlib import Path

import pymupdf

from .pdfvec import page_ids
from .textlayer import Retriever


def flow_page_chunks(private):
    doc = pymupdf.open(Path(private) / "pdf" / "prostate.pdf")
    out = []
    for i, code in page_ids(doc).items():
        if code.startswith("PROS-") and code[5:].rstrip("A").isdigit():
            text = " ".join(doc[i].get_text().split())
            out.append({"source": "algorithm", "page": code, "text": text})
    return out


def main(private, query, k=4):
    cache = Path(private) / "chunks_full.json"  # complete page store from fulltext.py
    if not cache.exists():
        cache = Path(private) / "chunks_all.json"
    if not cache.exists():
        chunks = flow_page_chunks(private) + json.loads((Path(private) / "chunks.json").read_text())
        cache.write_text(json.dumps(chunks))
    retriever = Retriever(json.loads(cache.read_text()))
    for hit in retriever.search(query, k=int(k)):
        print(f"[{hit['page']}] {hit['text'][:1500]}\n")


if __name__ == "__main__":
    main(*sys.argv[1:])
