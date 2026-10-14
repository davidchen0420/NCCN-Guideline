"""Smoke benchmark: encoding fidelity of each extraction strategy against reference graphs.

Usage: python -m nccn_nav.bench_encoding <private_dir>
Reads <private_dir>/gold/<PAGE>.json and strategy outputs; prints node/edge P/R/F1 only
(no guideline text), so the output is safe to commit.
"""
import json
import sys
from pathlib import Path

from .consensus import match_structural
from .scoring import graph_prf, text_sim


def flow_nodes(graph):
    return {**graph, "nodes": [n for n in graph["nodes"] if n.get("kind", "box") == "box"]}


def match_positioned(pred_nodes, gold_nodes, threshold=0.6):
    """One-to-one map for graphs with box positions: text similarity, and among look-alike
    boxes the one at the nearest vertical position."""
    pairs = []
    for p in pred_nodes:
        for g in gold_nodes:
            sim = text_sim(p["text"], g["text"])
            if sim >= threshold:
                dy = abs(p["bbox"][1] - g["bbox"][1]) if p.get("bbox") and g.get("bbox") else 0
                pairs.append((sim - dy / 1000, p["id"], g["id"]))
    mapping, used = {}, set()
    for _, pid, gid in sorted(pairs, reverse=True):
        if pid not in mapping and gid not in used:
            mapping[pid] = gid
            used.add(gid)
    return mapping


def load_strategies(private, page):
    out = {}
    e1 = json.loads((private / "e1_graphs.json").read_text())
    if page in e1:
        out["E1 vector"] = flow_nodes(e1[page])
    merged = private / "merged_graphs.json"
    if merged.exists() and page in json.loads(merged.read_text()):
        g = json.loads(merged.read_text())[page]
        # What the navigator uses: E1 boxes with consensus arrows, minus arrows the image check rejected.
        out["E4 merged+review"] = flow_nodes(g)
    path = private / "e2" / f"{page}.json"
    if path.exists():
        out["E2 VLM (Haiku)"] = json.loads(path.read_text())
    return out


def main(private):
    private = Path(private)
    rows = []
    for gold_path in sorted((private / "gold").glob("*.json")):
        page = gold_path.stem
        gold = json.loads(gold_path.read_text())
        for name, pred in load_strategies(private, page).items():
            if name.startswith("E2"):
                mapping = match_structural(pred, gold["nodes"], gold["edges"])
            else:
                mapping = match_positioned(pred["nodes"], gold["nodes"])
            r = graph_prf(pred, gold, mapping)
            rows.append((page, name, r))
    print(f"{'page':8} {'strategy':18} {'node P':>6} {'node R':>6} {'edge P':>6} {'edge R':>6} {'edge F1':>7}")
    totals = {}
    for page, name, r in rows:
        n, e = r["nodes"], r["edges"]
        print(f"{page:8} {name:18} {n['precision']:6.2f} {n['recall']:6.2f} {e['precision']:6.2f} {e['recall']:6.2f} {e['f1']:7.2f}")
        totals.setdefault(name, []).append(e["f1"])
    for name, f1s in totals.items():
        print(f"mean edge F1  {name:18} {sum(f1s) / len(f1s):.2f}  (pages={len(f1s)})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "private")
