"""Benchmark scorers: graph fidelity (node/edge P/R/F1) and CancerGUIDE-style path scores."""
import re
from difflib import SequenceMatcher


def norm(text):
    text = re.sub(r"\(PROS-[^)]*\)", " ", text)
    return re.sub(r"[^a-z0-9≥≤<>]+", " ", text.lower()).strip()


def _prf(tp, n_pred, n_gold):
    p = tp / n_pred if n_pred else 0.0
    r = tp / n_gold if n_gold else 0.0
    return {"precision": p, "recall": r, "f1": 2 * p * r / (p + r) if p + r else 0.0}


def match_nodes(pred_nodes, gold_nodes, threshold=0.6):
    """Greedy one-to-one match on normalized text similarity. Returns {pred_id: gold_id}."""
    pairs = []
    for p in pred_nodes:
        for g in gold_nodes:
            a, b = norm(p["text"]), norm(g["text"])
            score = 1.0 if a == b else SequenceMatcher(None, a, b).ratio()
            if b and (b in a or a in b):
                score = max(score, 0.9)
            pairs.append((score, p["id"], g["id"]))
    mapping, used = {}, set()
    for score, pid, gid in sorted(pairs, reverse=True):
        if score >= threshold and pid not in mapping and gid not in used:
            mapping[pid] = gid
            used.add(gid)
    return mapping


def graph_prf(pred, gold, mapping=None):
    mapping = mapping or match_nodes(pred["nodes"], gold["nodes"])
    gold_edges = {(e["src"], e["dst"]) for e in gold["edges"]}
    pred_edges = {(mapping.get(e["src"]), mapping.get(e["dst"])) for e in pred["edges"]}
    return {
        "nodes": _prf(len(mapping), len(pred["nodes"]), len(gold["nodes"])),
        "edges": _prf(len(pred_edges & gold_edges), len(pred["edges"]), len(gold_edges)),
        "missed_edges": sorted(gold_edges - pred_edges),
        "spurious_edges": sorted(e for e in pred_edges - gold_edges),
    }


def path_jaccard(pred_path, gold_path):
    a, b = set(pred_path), set(gold_path)
    return len(a & b) / len(a | b) if a | b else 1.0


def recommendation_match(pred, acceptable):
    """Exact match of the final recommendation against the set of acceptable node IDs."""
    return pred in set(acceptable)
