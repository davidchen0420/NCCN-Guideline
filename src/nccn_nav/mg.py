"""MedGUIDE benchmark for any guideline (HF MedGUIDE/MedGUIDE-MCQA-8K, parquet in
private/medguide_all/). Each item is a vignette, multiple-choice options and the decision
path (box texts) it was generated from.

  python -m nccn_nav.mg prepare private/<slug>   items.json + seeded 50/50 dev/test split
  python -m nccn_nav.mg map private/<slug>       map paths/options onto our graph
  python -m nccn_nav.mg score private/<slug> [dev|test]

Label validation is deterministic: an item is "valid on our graph" when its whole path maps
to a chain of connected boxes in our graph and its answer is the chain's last box. An
optional LLM check (medguide/label_check_*.json) can further exclude items whose label
contradicts the case text. Prints numbers only.
"""
import json
import random
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

from .navigator import Guideline, walk
from .scoring import norm

DISEASES = {"prostate": ["prostate_14"], "nsclc": ["nscl_2", "nscl_3"], "sclc": ["sclc_7"],
            "colon": ["col6"]}
PARQUET = Path(__file__).resolve().parents[2] / "private" / "medguide_all" / "data" / "train-00000-of-00001.parquet"


def prepare(root, seed=0):
    import pandas as pd

    root = Path(root)
    df = pd.read_parquet(PARQUET)
    items = []
    for disease in DISEASES[root.name]:
        rows = df[df.disease == disease].reset_index(drop=True)
        for i, r in rows.iterrows():
            # Prostate keeps the ids used by earlier runs (M<n> in file order).
            iid = f"M{i}" if root.name == "prostate" else f"{disease}:{i}"
            items.append({"id": iid, "disease": disease, "profile": r.profile, "options": list(r.options),
                          "answer": r.answer, "answer_text": r.answer_text, "path": list(r.path)})
    rng = random.Random(seed)
    split = {}
    for disease in DISEASES[root.name]:
        ids = [x["id"] for x in items if x["disease"] == disease]
        rng.shuffle(ids)
        half = len(ids) // 2
        split.update({i: "dev" for i in ids[:half]})
        split.update({i: "test" for i in ids[half:]})
    out = root / "medguide"
    out.mkdir(exist_ok=True)
    (out / "items.json").write_text(json.dumps(items))
    (out / "split.json").write_text(json.dumps(split))
    print(f"{len(items)} items; dev {sum(v == 'dev' for v in split.values())}, "
          f"test {sum(v == 'test' for v in split.values())}")


REF_RE = re.compile(r"\b([A-Z]{2,6}-[0-9]+[A-Z]?)\b")


def _sim(a, b):
    # Page references are what tell look-alike boxes apart ("pMMR/MSS (COL-10)" vs "(COL-11)").
    ra, rb = set(REF_RE.findall(a)), set(REF_RE.findall(b))
    if ra and rb and not ra & rb:
        return 0.0
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    s = SequenceMatcher(None, a, b).ratio()
    return max(s, 0.9) if (a in b or b in a) and min(len(a), len(b)) > 6 else s


def _descendants(gl, start, depth=12):
    seen, frontier = {start}, [start]
    for _ in range(depth):
        frontier = [c for n in frontier for c in gl.children.get(n, []) if c not in seen]
        seen.update(frontier)
    return seen


def map_item(gl, item, thr=0.6):
    """Follow the item's path through our graph: each step must be a child (or a short
    pass-through) of the previous box. Returns chain nodes or None where it breaks."""
    nodes = gl.nodes
    first = [(n, _sim(item["path"][0], nodes[n]["text"])) for n in nodes if not n.endswith(":START")]
    states = [n for n, s in sorted(first, key=lambda x: -x[1]) if s >= thr][:5]
    chains = [[n] for n in states]
    for step in item["path"][1:]:
        nxt = []
        for chain in chains:
            # MedGUIDE paths skip workup/link boxes: allow up to two intermediate boxes.
            near = set(gl.children.get(chain[-1], []))
            for _ in range(2):
                near |= {g for c in near for g in gl.children.get(c, [])}
            scored = sorted(((_sim(step, nodes[c]["text"]), c) for c in near), reverse=True)
            if scored and scored[0][0] >= thr:
                nxt.append(chain + [scored[0][1]])
        if not nxt:
            return None
        chains = nxt[:5]
    return chains[0]


def map_all(root):
    root = Path(root)
    gl = Guideline(root)
    items = json.loads((root / "medguide" / "items.json").read_text())
    out = {}
    for item in items:
        chain = map_item(gl, item)
        rec = {"chain": chain, "valid": False, "option_nodes": {}}
        if chain:
            pool = _descendants(gl, chain[0])
            letters = "ABCDEFGHIJKLMNOP"
            on_path = set(chain)
            for k, opt in enumerate(item["options"]):
                # Look-alike boxes ("Surveillance" on several branches): prefer the one on the
                # item's own path, so the answer box is identified unambiguously.
                scored = sorted(((round(_sim(opt, gl.nodes[n]["text"]), 2), n in on_path, n) for n in pool), reverse=True)
                if scored and scored[0][0] >= 0.6:
                    rec["option_nodes"][letters[k]] = scored[0][2]
            ans = rec["option_nodes"].get(item["answer"])
            # Valid: the answer box is the end of the mapped path and no other option maps to it.
            rec["valid"] = ans == chain[-1] and list(rec["option_nodes"].values()).count(ans) == 1
        out[item["id"]] = rec
    (root / "medguide" / "mapping.json").write_text(json.dumps(out, indent=0))
    n_chain = sum(r["chain"] is not None for r in out.values())
    n_valid = sum(r["valid"] for r in out.values())
    print(f"{len(out)} items: path maps onto graph {n_chain}, valid (answer = mapped path end) {n_valid}")
    return out


def build_facts(root):
    """Validate both extraction runs against the schema and the case text, keep only facts the
    two runs agree on, and report per-variable extraction statistics."""
    from .facts import agreement, validate

    root = Path(root)
    schema = json.loads((root / "fact_schema.json").read_text())
    items = {x["id"]: x for x in json.loads((root / "medguide" / "items.json").read_text())}
    runs = {}
    for run in ("a", "b"):
        raw = {}
        for f in sorted((root / "medguide").glob(f"facts_raw_{run}_*.json")):
            raw.update(json.loads(f.read_text()))
        runs[run] = raw
    final, stats, rejected = {}, {}, 0
    ids = sorted(set(runs["a"]) | set(runs["b"]))
    for i in ids:
        va, ra = validate(runs["a"].get(i, {}), schema, items[i]["profile"])
        vb, rb = validate(runs["b"].get(i, {}), schema, items[i]["profile"])
        rejected += len(ra) + len(rb)
        if not runs["b"]:
            keep, disagree = va, []  # single run: no agreement filter
        else:
            keep, disagree = agreement(va, vb)
        final[i] = keep
        for name in set(va) | set(vb):
            st = stats.setdefault(name, {"extracted": 0, "agreed": 0, "disagreed": 0})
            st["extracted"] += 1
            st["agreed"] += name in keep
            st["disagreed"] += name in disagree
    (root / "medguide" / "facts_final.json").write_text(json.dumps(final, indent=0))
    (root / "medguide" / "facts_stats.json").write_text(json.dumps(stats, indent=1))
    n = len(ids)
    tot_ext = sum(v["extracted"] for v in stats.values())
    tot_agree = sum(v["agreed"] for v in stats.values())
    print(f"{n} cases; facts per case kept {sum(len(v) for v in final.values()) / max(n, 1):.1f}; "
          f"run agreement {tot_agree / max(tot_ext, 1):.2f}; values rejected by validation {rejected}; "
          f"schema variables never extracted {len(set(schema['variables']) - set(stats))}/{len(schema['variables'])}")


def engine_answer(gl, facts, option_nodes, n_options=None):
    """Answer from deterministic walks from every entry the facts satisfy: the first option box
    each walk passes through last; abstain if walks disagree.
    Abstain (None) when walks disagree or no option box is reached. (An earlier rule that took
    "the only option still reachable" leaked the label: distractors often sit on branches the
    walk can never reach, so it scored the same with shuffled facts.)"""
    inverse = {}
    for letter, node in option_nodes.items():
        inverse.setdefault(node, []).append(letter)
    answers = set()
    for w in walk(gl, facts):
        # The last option box reached (chosen on the dev split over "first": 36/51 vs 14/51 on colon).
        hit = [n for n in w["path"] if n in inverse]
        if hit:
            answers.update(inverse[hit[-1]])
    return answers.pop() if len(answers) == 1 else None


def _load(root, *names):
    merged = {}
    for n in names:
        p = root / "medguide" / n
        if p.exists():
            merged.update(json.loads(p.read_text()))
    return merged


def score(root, split_name="test"):
    root = Path(root)
    gl = Guideline(root)
    items = {x["id"]: x for x in json.loads((root / "medguide" / "items.json").read_text())}
    split = json.loads((root / "medguide" / "split.json").read_text())
    mapping = json.loads((root / "medguide" / "mapping.json").read_text())
    checks = _load(root, "label_check.json")
    facts = _load(root, "facts_final.json")
    a0 = _load(root, *sorted(f.name for f in (root / "medguide").glob("A0_*.json")))
    ids = [i for i in items if split[i] == split_name and mapping[i]["valid"]
           and checks.get(i, {}).get("verdict", "consistent") == "consistent"]
    a5 = {i: engine_answer(gl, facts.get(i, {}), mapping[i]["option_nodes"], len(items[i]["options"]))
          for i in ids} if facts else {}
    # Controls. (1) Majority box: always pick the option at the answer box most common among
    # dev items, which shows how much a tree's items share one answer. (2) The engine run on
    # facts shuffled between items, which shows how much the case's own facts matter.
    from collections import Counter

    dev_boxes = Counter(mapping[i]["option_nodes"].get(items[i]["answer"]) for i in items
                        if split[i] == "dev" and mapping[i]["valid"])
    rank = {box: r for r, (box, _) in enumerate(dev_boxes.most_common())}
    majority = {}
    for i in ids:
        opts = [(rank[n], l) for l, n in mapping[i]["option_nodes"].items() if n in rank]
        majority[i] = min(opts)[1] if opts else None
    import random as _random

    shuffled_ids = ids[:]
    _random.Random(0).shuffle(shuffled_ids)
    shuffled = {i: engine_answer(gl, facts.get(j, {}), mapping[i]["option_nodes"]) for i, j in zip(ids, shuffled_ids)} if facts else {}
    rows = [("B majority box (dev)", majority), ("A0 no context", a0), ("A5 engine (abstains)", a5),
            ("A5 shuffled facts", shuffled), ("A5 + A0 fallback", {i: a5.get(i) or a0.get(i) for i in ids})]
    print(f"{root.name} [{split_name}] scored items: {len(ids)} "
          f"(valid on graph {sum(mapping[i]['valid'] for i in items if split[i] == split_name)}"
          f"/{sum(split[i] == split_name for i in items)}; LLM label check excluded "
          f"{sum(checks.get(i, {}).get('verdict', 'consistent') != 'consistent' for i in items if split[i] == split_name and mapping[i]['valid'])})")
    for name, pred in rows:
        if not pred:
            continue
        answered = [i for i in ids if pred.get(i)]
        right = sum(pred[i] == items[i]["answer"] for i in answered)
        n = len(ids)
        acc = right / n if n else 0
        half = 1.96 * (acc * (1 - acc) / n) ** 0.5 if n else 0
        print(f"  {name:22} {right:>4}/{len(answered):<4} coverage {len(answered) / max(n, 1):.2f}  "
              f"accuracy {acc:.3f} ±{half:.3f}")
    return a5


if __name__ == "__main__":
    cmd, root = sys.argv[1], sys.argv[2]
    {"prepare": prepare, "map": map_all, "score": score, "facts": build_facts}[cmd](root, *sys.argv[3:])
