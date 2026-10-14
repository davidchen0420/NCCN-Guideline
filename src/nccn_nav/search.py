"""Strategy A2 tool: plain BM25 retrieval over the whole guideline (flow pages flattened to
text, plus Principles and Discussion chunks). No graph structure.

  python -m nccn_nav.search <private> "<query>" [k]
"""
import json
import os
import sys
from pathlib import Path

from .guideline import Spec
from .textlayer import Retriever


def flow_page_chunks(private):
    spec = Spec(private)
    out = []
    for i, code in spec.ids.items():
        if spec.kind(i) in ("algorithm", "footnotes"):
            text = " ".join(spec.doc[i].get_text().split())
            out.append({"source": "algorithm", "page": code, "text": text})
    return out


def main(private, query, k=4):
    cache = Path(private) / "chunks_full.json"  # complete page store from fulltext.py
    if not cache.exists():
        cache = Path(private) / "chunks_all.json"
    if not cache.exists():
        chunks = flow_page_chunks(private) + json.loads((Path(private) / "chunks.json").read_text())
        cache.write_text(json.dumps(chunks))
    dense = Path(private) if os.environ.get("NAV_DENSE") else None  # NAV_DENSE=1 → hybrid
    retriever = Retriever(json.loads(cache.read_text()), dense_cache=dense)
    for hit in retriever.search(query, k=int(k)):
        print(f"[{hit['page']}] {hit['text'][:1500]}\n")


if __name__ == "__main__":
    main(*sys.argv[1:])
