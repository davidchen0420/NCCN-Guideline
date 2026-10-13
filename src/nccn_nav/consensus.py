"""Strategy E4: cross-check two independent extractions (E1 vector, E2 VLM).

Edges both agree on are accepted; the rest go to a human review queue. The accepted graph
keeps E1's node text (copied verbatim from the PDF) wherever an E1 node matches.
"""
from .scoring import match_nodes


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
    merged, stats = {}, {}
    for page, g in e1.items():
        boxes = [n for n in g["nodes"] if n["kind"] == "box"]
        e2_path = private / "e2" / f"{page}.json"
        edges = {(e["src"], e["dst"]): "e1_only" for e in g["edges"]}
        if e2_path.exists():
            e2 = json.loads(e2_path.read_text())
            mapping = match_nodes(e2["nodes"], boxes)
            for e in e2["edges"]:
                key = (mapping.get(e["src"]), mapping.get(e["dst"]))
                if None in key or key[0] == key[1]:
                    continue
                edges[key] = "agreed" if key in edges else "e2_only"
        merged[page] = {**g, "edges": [{"src": s, "dst": t, "support": v} for (s, t), v in sorted(edges.items())]}
        counts = {}
        for v in edges.values():
            counts[v] = counts.get(v, 0) + 1
        stats[page] = counts
    (private / "merged_graphs.json").write_text(json.dumps(merged, indent=1))
    return stats
