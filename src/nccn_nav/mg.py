"""MedGUIDE benchmark for any guideline (HF MedGUIDE/MedGUIDE-MCQA-8K, parquet in
private/medguide_all/). Each item is a vignette, multiple-choice options and the decision
path (box texts) it was generated from.

  python -m nccn_nav.mg prepare private/<slug>   items.json + seeded 50/50 dev/test split
  python -m nccn_nav.mg map private/<slug>       map paths/options onto our graph
  python -m nccn_nav.mg score private/<slug> [dev|test]

Label validation is deterministic: an item is "valid on our graph" when its whole path maps
to a chain of connected boxes in our graph and its answer is the chain's last box. An
optional LLM check (medguide/label_check*.json) further excludes items whose label
contradicts the case text. Prints numbers only.
"""
import json
import random
import re
import sys
from pathlib import Path

from .navigator import Guideline, walk
from .scoring import text_sim

TREES_FILE = Path(__file__).resolve().parents[2] / "NCCN Guidelines" / "medguide_trees.json"


def trees_for(root, override=None):
    """MedGUIDE trees for a guideline: from the command line ("tree1,tree2") or the config file."""
    if override:
        return override.split(",")
    trees = json.loads(TREES_FILE.read_text()).get(Path(root).name)
    if not trees:
        raise SystemExit(f"no MedGUIDE trees configured for {Path(root).name}: add it to {TREES_FILE} "
                         "or pass them as `mg prepare <root> tree1,tree2`")
    return trees
PARQUET = Path(__file__).resolve().parents[2] / "private" / "medguide_all" / "data" / "train-00000-of-00001.parquet"


def prepare(root, trees=None, seed=0):
    import pandas as pd

    root = Path(root)
    trees = trees_for(root, trees)
    df = pd.read_parquet(PARQUET)
    items = []
    for disease in trees:
        rows = df[df.disease == disease].reset_index(drop=True)
        for i, r in rows.iterrows():
            iid = f"{disease}:{i}"
            items.append({"id": iid, "disease": disease, "profile": r.profile, "options": list(r.options),
                          "answer": r.answer, "answer_text": r.answer_text, "path": list(r.path)})
    rng = random.Random(seed)
    split = {}
    for disease in trees:
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
    # A mismatch is a penalty, not a veto: MedGUIDE was built from an older guideline version
    # whose page numbers differ (e.g. PROS-15 there is PROS-17 in v6.2026).
    ra, rb = set(REF_RE.findall(a)), set(REF_RE.findall(b))
    penalty = 0.15 if ra and rb and not ra & rb else 0.0
    return max(0.0, text_sim(a, b, min_len=7) - penalty)


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


def option_boxes(gl, text, thr=0.6, band=0.02):
    """Every box in the whole guideline whose text matches an option (look-alike boxes all
    count). Deliberately does not look at the item's gold path, so a distractor that names a
    box on another branch can be (wrongly) reached by the engine."""
    scored = [(_sim(text, gl.nodes[n]["text"]), n) for n in gl.nodes if not n.endswith(":START")]
    best = max((sc for sc, _ in scored), default=0)
    return sorted(n for sc, n in scored if best >= thr and sc >= best - band)


def map_all(root):
    root = Path(root)
    gl = Guideline(root)
    items = json.loads((root / "medguide" / "items.json").read_text())
    out = {}
    letters = "ABCDEFGHIJKLMNOP"
    for item in items:
        chain = map_item(gl, item)
        rec = {"chain": chain, "valid": False, "option_nodes": {}}
        for k, opt in enumerate(item["options"]):
            boxes = option_boxes(gl, opt)
            if boxes:
                rec["option_nodes"][letters[k]] = boxes
        if chain:
            # Valid: the item's path ends on a box that the answer option, and only the answer
            # option, matches.
            end = chain[-1]
            owners = [l for l, boxes in rec["option_nodes"].items() if end in boxes]
            rec["valid"] = owners == [item["answer"]]
        out[item["id"]] = rec
    (root / "medguide" / "mapping.json").write_text(json.dumps(out, indent=0))
    n_chain = sum(r["chain"] is not None for r in out.values())
    n_valid = sum(r["valid"] for r in out.values())
    print(f"{len(out)} items: path maps onto graph {n_chain}, valid (answer = mapped path end) {n_valid}")
    return out


def build_facts(root):
    """Validate both extraction runs against the schema and the case text, keep only facts the
    two runs agree on, and report per-variable extraction statistics."""
    from .facts import agreement, validate_with_history

    root = Path(root)
    schema = json.loads((root / "fact_schema.json").read_text())
    items = {x["id"]: x for x in json.loads((root / "medguide" / "items.json").read_text())}
    runs = {}
    for run in ("a", "b"):
        raw = {}
        for f in sorted((root / "medguide").glob(f"facts_raw_{run}_*.json")):
            raw.update(json.loads(f.read_text()))
        runs[run] = raw
    final, earlier, stats, rejected = {}, {}, {}, 0
    ids = sorted(set(runs["a"]) | set(runs["b"]))
    for i in ids:
        va, ea, ra = validate_with_history(runs["a"].get(i, {}), schema, items[i]["profile"])
        vb, eb, rb = validate_with_history(runs["b"].get(i, {}), schema, items[i]["profile"])
        rejected += len(ra) + len(rb)
        if not runs["b"]:
            keep, disagree = va, []  # single run: no agreement filter
            earlier[i] = ea
        else:
            keep, disagree = agreement(va, vb)
            earlier[i] = agreement(ea, eb)[0]
        final[i] = keep
        for name in set(va) | set(vb):
            st = stats.setdefault(name, {"extracted": 0, "agreed": 0, "disagreed": 0})
            st["extracted"] += 1
            st["agreed"] += name in keep
            st["disagreed"] += name in disagree
    (root / "medguide" / "facts_final.json").write_text(json.dumps(final, indent=0))
    (root / "medguide" / "facts_earlier.json").write_text(json.dumps({k: v for k, v in earlier.items() if v}, indent=0))
    (root / "medguide" / "facts_stats.json").write_text(json.dumps(stats, indent=1))
    n = len(ids)
    tot_ext = sum(v["extracted"] for v in stats.values())
    tot_agree = sum(v["agreed"] for v in stats.values())
    print(f"{n} cases; facts per case kept {sum(len(v) for v in final.values()) / max(n, 1):.1f}; "
          f"run agreement {tot_agree / max(tot_ext, 1):.2f}; values rejected by validation {rejected}; "
          f"schema variables never extracted {len(set(schema['variables']) - set(stats))}/{len(schema['variables'])}")


def engine_answer(gl, facts, option_nodes, earlier=None):
    """Answer from deterministic walks from every entry the facts satisfy: the last option box
    each walk passes through (chosen on dev over "first"). Abstain (None) when walks disagree,
    when a box belongs to several options, or when no option box is reached."""
    inverse = {}
    for letter, boxes in option_nodes.items():
        for node in boxes:
            inverse.setdefault(node, set()).add(letter)
    answers = set()
    for w in walk(gl, facts, earlier=earlier):
        hit = [n for n in w["path"] if n in inverse]
        if hit:
            answers |= inverse[hit[-1]]
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
    # LLM label checks (label_check*.json): items whose label contradicts the case are excluded.
    checks = _load(root, *sorted(f.name for f in (root / "medguide").glob("label_check*.json")))
    facts = _load(root, "facts_final.json")
    earlier = _load(root, "facts_earlier.json")
    a0 = _load(root, *sorted(f.name for f in (root / "medguide").glob("A0_*.json")))
    ids = [i for i in items if split[i] == split_name and mapping[i]["valid"]
           and checks.get(i, {}).get("verdict", "consistent") == "consistent"]
    a5 = {i: engine_answer(gl, facts.get(i, {}), mapping[i]["option_nodes"], earlier.get(i))
          for i in ids} if facts else {}
    # Controls. (1) Majority box: always pick the option at the answer box most common among
    # dev items, which shows how much a tree's items share one answer. (2) The engine run on
    # facts shuffled between items, which shows how much the case's own facts matter.
    from collections import Counter

    dev_boxes = Counter(mapping[i]["chain"][-1] for i in items if split[i] == "dev" and mapping[i]["valid"])
    rank = {box: r for r, (box, _) in enumerate(dev_boxes.most_common())}
    majority = {}
    for i in ids:
        opts = [(rank[n], l) for l, boxes in mapping[i]["option_nodes"].items() for n in boxes if n in rank]
        majority[i] = min(opts)[1] if opts else None
    import random as _random

    shuffled_ids = ids[:]
    _random.Random(0).shuffle(shuffled_ids)
    shuffled = {i: engine_answer(gl, facts.get(j, {}), mapping[i]["option_nodes"], earlier.get(j))
                for i, j in zip(ids, shuffled_ids)} if facts else {}
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
