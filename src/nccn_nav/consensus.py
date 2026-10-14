"""Strategy E4: cross-check two independent extractions (E1 vector, E2 VLM).

Edges both agree on are accepted; the rest go to a human review queue. The accepted graph
keeps E1's node text (copied verbatim from the PDF) wherever an E1 node matches.
"""
from .guideline import fname
from .scoring import match_nodes, norm, text_sim


def match_structural(e2, e1_boxes, e1_edges, thr=0.6, tie=0.05):
    """Map E2 node ids to E1 box ids by text, breaking ties between look-alike boxes (pages
    repeat "Progression", "Response or stable disease", ...) by which choice makes the most
    E2 arrows coincide with E1 arrows to already-mapped neighbours."""
    cands = {}
    for n in e2["nodes"]:
        scored = sorted(((text_sim(n["text"], b["text"]), b["id"]) for b in e1_boxes), reverse=True)
        best = scored[0][0] if scored else 0
        if best >= thr:
            cands[n["id"]] = [(sc, bid) for sc, bid in scored if sc >= best - tie]
    e1_set = {(e["src"], e["dst"]) for e in e1_edges}
    e2_adj = {}
    for e in e2["edges"]:
        e2_adj.setdefault(e["src"], []).append(("out", e["dst"]))
        e2_adj.setdefault(e["dst"], []).append(("in", e["src"]))
    order_e2 = [n["id"] for n in e2["nodes"]]
    y_of = {b["id"]: (b["bbox"][1], b["bbox"][0]) if b.get("bbox") else (k, 0) for k, b in enumerate(e1_boxes)}
    mapping, used = {}, set()
    # Unambiguous text matches first.
    for nid, cs in sorted(cands.items(), key=lambda kv: -kv[1][0][0]):
        if len(cs) == 1 and cs[0][1] not in used:
            mapping[nid] = cs[0][1]
            used.add(cs[0][1])
    while True:
        best = None
        for nid, cs in cands.items():
            if nid in mapping:
                continue
            for sc, bid in cs:
                if bid in used:
                    continue
                support = sum(
                    ((bid, mapping[m]) if d == "out" else (mapping[m], bid)) in e1_set
                    for d, m in e2_adj.get(nid, []) if m in mapping)
                # Last resort for identical texts: keep reading order (k-th look-alike in E2
                # is the k-th look-alike in E1, top to bottom).
                pool = {b for _, b in cs}
                twins_e2 = [x for x in order_e2 if x == nid or (x in cands and pool & {b for _, b in cands[x]})]
                twins_e1 = sorted((b for _, b in cs), key=lambda b: y_of[b])
                rank_gap = abs(twins_e2.index(nid) - twins_e1.index(bid)) if bid in twins_e1 else 99
                key = (support, sc, -rank_gap)
                if best is None or key > best[0]:
                    best = (key, nid, bid)
        if best is None:
            return mapping
        mapping[best[1]] = best[2]
        used.add(best[2])


def consensus(e1, e2):
    mapping = match_nodes(e2["nodes"], e1["nodes"])  # e2 id -> e1 id
    e1_edges = {(e["src"], e["dst"]) for e in e1["edges"]}
    e2_edges = {(mapping.get(e["src"]), mapping.get(e["dst"])) for e in e2["edges"]}
    agreed = e1_edges & e2_edges
    review = sorted(e1_edges ^ {e for e in e2_edges if None not in e})
    unmapped_e2 = [n["id"] for n in e2["nodes"] if n["id"] not in mapping]
    used = {n for e in agreed for n in e}
    return {
        "nodes": [n for n in e1["nodes"] if n["id"] in used],
        "edges": [{"src": s, "dst": t} for s, t in sorted(agreed)],
        "review_edges": review,
        "unmatched_vlm_nodes": unmapped_e2,
        "agreement": len(agreed) / max(len(e1_edges | e2_edges), 1),
    }


def merge_all(private):
    """Build <private>/merged_graphs.json in E1's format for every flow page: E1 nodes, plus
    edges labelled 'agreed' (E1 and E2), 'e1_only' or 'e2_only'. All edges are kept for
    navigation; non-agreed ones form the human review queue."""
    import json
    from pathlib import Path

    private = Path(private)
    e1 = json.loads((private / "e1_graphs.json").read_text())
    verdicts = {}
    for f in sorted((private / "review").glob("edge_verdicts_*.json")):
        verdicts.update({k: v["verdict"] for k, v in json.loads(f.read_text()).items()})
    merged, stats = {}, {}
    for page, g in e1.items():
        boxes = [n for n in g["nodes"] if n["kind"] == "box"]
        e2_path = private / "e2" / f"{fname(page)}.json"
        edges = {(e["src"], e["dst"]): "e1_only" for e in g["edges"]}
        if e2_path.exists():
            e2 = json.loads(e2_path.read_text())
            mapping = match_structural(e2, boxes, g["edges"])
            for e in e2["edges"]:
                key = (mapping.get(e["src"]), mapping.get(e["dst"]))
                if None in key or key[0] == key[1]:
                    continue
                edges[key] = "agreed" if key in edges else "e2_only"
        # Image-checked verdicts on disputed arrows (review/edge_verdicts_*.json, keyed
        # "PAGE:src->dst"): "no" removes the arrow, "yes" marks it verified.
        for (s, t) in list(edges):
            verdict = verdicts.get(f"{page}:{s}->{t}")
            if verdict == "no":
                del edges[(s, t)]
            elif verdict == "yes" and edges[(s, t)] != "agreed":
                edges[(s, t)] = "verified"
        merged[page] = {**g, "edges": [{"src": s, "dst": t, "support": v} for (s, t), v in sorted(edges.items())]}
        counts = {}
        for v in edges.values():
            counts[v] = counts.get(v, 0) + 1
        stats[page] = counts
    # Table and list pages: decision rows checked against the page text (tables.py).
    from .tables import apply as apply_tables

    for page, (kept, _) in apply_tables(private, merged).items():
        if kept:
            stats[page]["table"] = sum(e.get("support") == "table" for e in merged[page]["edges"])
    (private / "merged_graphs.json").write_text(json.dumps(merged, indent=1))
    return stats


if __name__ == "__main__":
    import sys

    stats = merge_all(sys.argv[1])
    total = {}
    for counts in stats.values():
        for k, v in counts.items():
            total[k] = total.get(k, 0) + v
    print(total)
