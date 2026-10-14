"""Dev-split error analysis for the A5 engine: where does each walk leave the item's gold path,
and why (wrong entry, wrong predicate verdict, missing fact, no predicate)? Prints counts only,
plus node ids for inspection.

  python -m nccn_nav.diagnose private/<slug>
"""
import json
import sys
from collections import Counter
from pathlib import Path

from .facts import derive
from .mg import engine_answer
from .navigator import Guideline, walk
from .predicates import evaluate, facts_used


def main(root):
    root = Path(root)
    gl = Guideline(root)
    items = {x["id"]: x for x in json.loads((root / "medguide" / "items.json").read_text())}
    split = json.loads((root / "medguide" / "split.json").read_text())
    mapping = json.loads((root / "medguide" / "mapping.json").read_text())
    facts = json.loads((root / "medguide" / "facts_final.json").read_text())
    earlier_path = root / "medguide" / "facts_earlier.json"
    earlier = json.loads(earlier_path.read_text()) if earlier_path.exists() else {}
    causes, where = Counter(), Counter()
    for i, it in items.items():
        if split[i] != "dev" or not mapping[i]["valid"]:
            continue
        f = facts.get(i, {})
        ans = engine_answer(gl, f, mapping[i]["option_nodes"], earlier.get(i))
        if ans == it["answer"]:
            continue
        chain = mapping[i]["chain"]
        d = derive(f, gl.schema)
        walks = walk(gl, f, earlier=earlier.get(i))
        if not walks:
            v = evaluate(gl.predicates.get(chain[0]), d)
            cause = "entry: gold entry has no predicate" if chain[0] not in gl.predicates or gl.predicates[chain[0]] is None \
                else f"entry: gold entry predicate={v}"
            causes[cause] += 1
            where[chain[0]] += 1
            continue
        # The first gold step the engine did not take.
        path = set(n for w in walks for n in w["path"])
        miss = next((n for n in chain if n not in path), None)
        if miss is None:
            causes["walk passes gold path; answer " + ("wrong" if ans else "abstained/disagreed")] += 1
            continue
        pred = gl.predicates.get(miss)
        if pred is None:
            causes["missed branch has no predicate"] += 1
        else:
            v = evaluate(pred, d)
            missing = [x for x in facts_used(pred) if x not in d]
            causes[f"missed branch predicate={v}" + (" (facts missing)" if missing else "")] += 1
        where[miss] += 1
    for c, n in causes.most_common():
        print(f"{n:4}  {c}")
    print("most frequent divergence nodes:", where.most_common(6))


if __name__ == "__main__":
    main(sys.argv[1])
