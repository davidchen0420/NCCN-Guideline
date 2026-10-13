"""Smoke benchmark: encoding fidelity of each extraction strategy against reference graphs.

Usage: python -m nccn_nav.bench_encoding <private_dir>
Reads <private_dir>/gold/<PAGE>.json and strategy outputs; prints node/edge P/R/F1 only
(no guideline text), so the output is safe to commit.
"""
import json
import sys
from pathlib import Path

from .scoring import graph_prf, match_nodes


def flow_nodes(graph):
    return {**graph, "nodes": [n for n in graph["nodes"] if n.get("kind", "box") == "box"]}


def load_strategies(private, page):
    out = {}
    e1 = json.loads((private / "e1_graphs.json").read_text())
    if page in e1:
        out["E1 vector"] = flow_nodes(e1[page])
    for name, sub in (("E2 VLM (Haiku)", "e2"), ("E3 hybrid", "e3"), ("E4 consensus", "e4")):
        path = private / sub / f"{page}.json"
        if path.exists():
            out[name] = json.loads(path.read_text())
    return out


def main(private):
    private = Path(private)
    rows = []
    for gold_path in sorted((private / "gold").glob("PROS-*.json")):
        page = gold_path.stem
        gold = json.loads(gold_path.read_text())
        for name, pred in load_strategies(private, page).items():
            r = graph_prf(pred, gold, match_nodes(pred["nodes"], gold["nodes"]))
            rows.append((page, name, r))
    print(f"{'page':8} {'strategy':16} {'node P':>6} {'node R':>6} {'edge P':>6} {'edge R':>6} {'edge F1':>7}")
    totals = {}
    for page, name, r in rows:
        n, e = r["nodes"], r["edges"]
        print(f"{page:8} {name:16} {n['precision']:6.2f} {n['recall']:6.2f} {e['precision']:6.2f} {e['recall']:6.2f} {e['f1']:7.2f}")
        totals.setdefault(name, []).append(e["f1"])
    for name, f1s in totals.items():
        print(f"mean edge F1  {name:16} {sum(f1s) / len(f1s):.2f}  (pages={len(f1s)})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "private")
