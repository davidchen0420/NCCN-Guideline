"""All local (no-LLM) encoding steps for one guideline, in one command.

  python -m nccn_nav.pipeline private/<slug>

Writes into private/<slug>/:
  e1_graphs.json   E1 vector graph per algorithm page, nodes typed by structure
  footnotes.json   footnotes per page code (letters repeat across pages with different text)
  pages.json, chunks_full.json   complete page store (fulltext.py)
  redflags.json    pages whose E1 graph looks wrong; these get the E2 vision cross-check
Prints counts only.
"""
import json
import random
import re
import sys
from pathlib import Path

from . import fulltext
from .guideline import Spec
from .pdfvec import configure, extract_page_graph, page_footnotes

FOLLOW_UP = re.compile(r"\b(surveillance|follow-up|monitor\w*)\b", re.I)


def type_nodes(g, spec):
    """Structural role of each box: entry / branch (one of several children) / step / leaf,
    plus `link` for boxes that only point to another page."""
    kids, parents = {}, {}
    for e in g["edges"]:
        kids.setdefault(e["src"], []).append(e["dst"])
        parents.setdefault(e["dst"], []).append(e["src"])
    for n in g["nodes"]:
        if n["kind"] != "box":
            continue
        nid = n["id"]
        if re.fullmatch(r"\s*(See\b.*)?" + spec.link_re.pattern + r"\s*", n["text"]) or \
                (n["text"].lstrip().startswith("See ") and n.get("links")):
            role = "link"
        elif nid not in parents:
            role = "entry" if nid in kids else "orphan"
        elif any(len(kids[p]) > 1 for p in parents[nid]):
            role = "branch"
        else:
            role = "step" if nid in kids else "leaf"
        n["role"] = role
        n["follow_up"] = bool(FOLLOW_UP.search(n["text"]))
    return g


def red_flags(g):
    boxes = [n for n in g["nodes"] if n["kind"] == "box"]
    flags = []
    if not g["edges"]:
        flags.append("no_edges")
    if g["n_unattached"]:
        flags.append(f"unattached_arrows:{g['n_unattached']}")
    # Orphans in the top band are section headers; "Footnotes on X-nA" lines are notes.
    orphans = [n["id"] for n in boxes if n.get("role") == "orphan" and n["bbox"][1] > 110
               and not n["text"].startswith("Footnote")]
    if orphans:
        flags.append(f"orphans:{len(orphans)}")
    if g["n_connectors"] and len(g["edges"]) < 0.6 * g["n_connectors"]:
        flags.append("few_edges_per_arrow")
    # A leaf in the middle of the page with no page link usually means a missed arrow.
    dead = [n["id"] for n in boxes if n.get("role") == "leaf" and not n.get("links") and n["bbox"][2] < 500]
    if dead:
        flags.append(f"dead_ends:{len(dead)}")
    if len(boxes) > 35:
        flags.append("dense_page")
    return flags


def run(root, sample=0.2, seed=0):
    root = Path(root)
    spec = Spec(root)
    configure(spec)
    graphs, flags = {}, {}
    for code in spec.flow_pages():
        g = extract_page_graph(spec.doc, spec.index_of(code))
        g["page_id"] = code
        graphs[code] = type_nodes(g, spec)
        flags[code] = red_flags(g)
    (root / "e1_graphs.json").write_text(json.dumps(graphs, indent=1))
    (root / "footnotes.json").write_text(json.dumps(page_footnotes(spec), indent=1))
    pages = fulltext.build(root)
    chunks = fulltext.chunk_pages(pages)
    (root / "chunks_full.json").write_text(json.dumps(chunks))
    # E2 (vision) runs on every flagged page plus a random audit sample of clean pages.
    clean = [p for p, f in flags.items() if not f]
    rng = random.Random(seed)
    audit = sorted(rng.sample(clean, max(1, round(sample * len(clean))))) if clean else []
    e2_pages = [p for p, f in flags.items() if f] + audit
    (root / "redflags.json").write_text(json.dumps({"flags": flags, "audit_sample": audit,
                                                    "e2_pages": e2_pages}, indent=1))
    n_edges = sum(len(g["edges"]) for g in graphs.values())
    n_boxes = sum(sum(n["kind"] == "box" for n in g["nodes"]) for g in graphs.values())
    print(f"{spec.slug}: prefixes {spec.prefixes}, {len(graphs)} algorithm pages, {n_boxes} boxes, "
          f"{n_edges} arrows, {len(chunks)} chunks")
    print(f"  red-flag pages {sum(bool(f) for f in flags.values())}/{len(flags)}, "
          f"audit sample {len(audit)}, E2 queue {len(e2_pages)}")
    return graphs, flags


if __name__ == "__main__":
    run(sys.argv[1])
