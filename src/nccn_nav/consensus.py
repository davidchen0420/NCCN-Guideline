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
