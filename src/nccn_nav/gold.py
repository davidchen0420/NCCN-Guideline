"""Write a hand-checked gold graph for one page (gold/<PAGE>.json), scored by bench_encoding.

The checker looks at the page image and lists the boxes and arrows it sees. Boxes found by
E1 are reused by id (text and position copied verbatim); boxes E1 missed are added with
their text and top y. Arrows are listed with short labels.

  python -m nccn_nav.gold private/<slug> <PAGE> "a=n120_40 b=n160_300 ..." "k:410:text|..." "a>b a>k ..."
  python -m nccn_nav.gold pick private <n> [seed]    seeded random algorithm page per guideline
"""
import json
import random
import sys
from pathlib import Path


def write(root, page, keep, new, edges):
    root = Path(root)
    g = json.loads((root / "e1_graphs.json").read_text())[page]
    by_id = {n["id"]: n for n in g["nodes"]}
    nodes = [{"id": k, "text": by_id[v]["text"], "bbox": by_id[v]["bbox"]}
             for k, v in (x.split("=") for x in keep.split())]
    for item in filter(None, new.split("|")):
        k, y, text = item.split(":", 2)
        nodes.append({"id": k, "text": text, "bbox": [0, float(y), 0, float(y) + 12]})
    ids = {n["id"] for n in nodes}
    pairs = [e.split(">") for e in edges.split()]
    unknown = {x for p in pairs for x in p} - ids
    if unknown:
        raise SystemExit(f"edges use unknown labels: {sorted(unknown)}")
    (root / "gold").mkdir(exist_ok=True)
    (root / "gold" / f"{page}.json").write_text(json.dumps(
        {"nodes": nodes, "edges": [{"src": a, "dst": b} for a, b in pairs],
         "basis": "checked by eye from page image"}, indent=1))
    print(f"{page}: {len(nodes)} nodes, {len(pairs)} edges")


def pick(private, slugs, seed=0):
    """One seeded random algorithm page with at least 3 boxes per guideline (chosen before
    looking at any extraction output)."""
    rng = random.Random(int(seed))
    out = {}
    for slug in slugs.split(","):
        g = json.loads((Path(private) / slug / "e1_graphs.json").read_text())
        pages = sorted(p for p, v in g.items() if sum(n["kind"] == "box" for n in v["nodes"]) >= 3)
        out[slug] = rng.choice(pages) if pages else None
    print(json.dumps(out))
    return out


if __name__ == "__main__":
    if sys.argv[1] == "pick":
        pick(*sys.argv[2:])
    else:
        write(*sys.argv[1:6])
