"""MedGUIDE prostate benchmark (HF MedGUIDE/MedGUIDE-MCQA-8K, disease prostate_14: 166
three-option items built from the NCCN M0 CRPC decision tree, PROS-16 in v6.2026).

  NAV_PAGES=PROS-16 python -m nccn_nav.bench_medguide <private>

Arms:
  A0      Haiku answers from the profile alone.
  A2      Haiku with BM25 search (30-item random subset).
  A5      Haiku extracts facts; the graph engine walks PROS-16 deterministically. If it does
          not reach one of the option leaves, it abstains.
  A5+A0   A5, falling back to the A0 answer when the engine abstains.
Prints accuracy only.
"""
import json
import sys
from pathlib import Path

from .navigator import Guideline, _auto_step


def engine_answers(private, facts, gold):
    gl = Guideline(private)
    page = "PROS-16"
    out = {}
    for g in gold:
        state = {"at": gl.roots[page][0], "path": [{"node": gl.roots[page][0], "by": "entry"}],
                 "facts": facts.get(g["id"], {})}
        _auto_step(gl, state)
        letter = [k for k, node in g["option_nodes"].items() if node == state["at"]]
        out[g["id"]] = letter[0] if letter else None
    return out


def acc(pred, gold_ids, answers):
    scored = [i for i in gold_ids if pred.get(i) is not None]
    right = sum(pred[i] == answers[i] for i in scored)
    return right, len(scored), len(gold_ids)


def main(private):
    root = Path(private) / "medguide"
    gold = json.loads((root / "gold.json").read_text())
    answers = {g["id"]: g["answer"] for g in gold}
    all_ids = [g["id"] for g in gold]
    sub_ids = [x["id"] for x in json.loads((root / "items_sub30.json").read_text())]

    def load(*names):
        merged = {}
        for n in names:
            p = root / n
            if p.exists():
                merged.update(json.loads(p.read_text()))
        return merged

    a0 = load("A0_a.json", "A0_b.json")
    a2 = load("A2_sub30.json")
    facts = load("facts_a.json", "facts_b.json")
    a5 = engine_answers(private, facts, gold) if facts else {}
    hybrid = {i: a5.get(i) or a0.get(i) for i in all_ids}

    a2h = load("A2_hybrid_sub30.json")
    # Items whose label an independent LLM check found consistent with the case text.
    checks = load("label_check_a.json", "label_check_b.json")
    clean_ids = [i for i in all_ids if checks.get(i, {}).get("verdict") == "consistent"]
    clean_sub = [i for i in sub_ids if i in clean_ids]
    rows = [("A0 no context", a0, all_ids), ("A5 engine (abstains)", a5, all_ids),
            ("A5 + A0 fallback", hybrid, all_ids),
            ("A0 [clean labels]", a0, clean_ids), ("A5 + A0 [clean labels]", hybrid, clean_ids),
            ("A0 on 30-subset", a0, sub_ids), ("A2 BM25 on 30-subset", a2, sub_ids),
            ("A2 hybrid on 30-subset", a2h, sub_ids), ("A5+A0 on 30-subset", hybrid, sub_ids),
            ("A2 BM25 [clean 30]", a2, clean_sub), ("A2 hybrid [clean 30]", a2h, clean_sub),
            ("A5+A0 [clean 30]", hybrid, clean_sub)]
    if checks:
        print(f"label check: {len(clean_ids)}/{len(all_ids)} items consistent with their case text")
    print(f"{'arm':26} {'correct/answered':>17} {'coverage':>9} {'accuracy (all)':>15}")
    for name, pred, ids in rows:
        if not pred:
            continue
        right, answered, total = acc(pred, ids, answers)
        print(f"{name:26} {right:>8}/{answered:<8} {answered / total:9.2f} {right / total:15.3f}")
    print("chance = 0.333; best published MedGUIDE overall (all cancers, GPT-4.1) = 0.644")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "private")
