"""Smoke benchmark: traversal arms on the labelled vignettes.

  python -m nccn_nav.bench_traversal <private>

Graph arms (A4 LLM-walked, A5 predicate engine on extracted facts) are scored
CancerGUIDE-style: final-node match against the acceptable set and path Jaccard against the
gold node sequence. Free-text arms (A0, A2) are scored from a manual grading file
runs/manual_grades.json ({arm: {case: true|false}}), since their answers are not node IDs.
Also reports fact-extraction accuracy for A5. Prints numbers only (no guideline text).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

from .scoring import path_jaccard


def run_a5(private, cases, facts, pages="PROS-3,PROS-9"):
    env = {**os.environ, "NAV_PAGES": pages}
    out = {}
    for case in cases:
        fpath = Path(private) / "runs" / f"facts_{case['id']}.json"
        fpath.write_text(json.dumps(facts.get(case["id"], {})))
        session = f"A5_{case['id']}"
        nav = [sys.executable, "-m", "nccn_nav.navigator", str(private)]
        subprocess.run(nav + ["start", session, case["start"], "--facts", str(fpath)], env=env, check=True,
                       capture_output=True)
        res = subprocess.run(nav + ["finish", session], env=env, check=True, capture_output=True, text=True)
        out[case["id"]] = json.loads(res.stdout)
    return out


def score_graph_arm(results, cases):
    rows = []
    for case in cases:
        r = results.get(case["id"])
        if not r:
            rows.append((case["id"], False, 0.0))
            continue
        path = [p for p in r["path"] if not p.endswith(":START")]
        rows.append((case["id"], r["final"] in case["acceptable_final"], path_jaccard(path, case["gold_path"])))
    return rows


def fact_accuracy(extracted, cases):
    right = total = extra = 0
    for case in cases:
        got = extracted.get(case["id"], {})
        for k, v in case["gold_facts"].items():
            total += 1
            right += got.get(k) == v
        extra += sum(1 for k in got if k not in case["gold_facts"])
    return right, total, extra


def main(private):
    private = Path(private)
    cases = json.loads((private / "vignettes" / "cases.json").read_text())
    runs = private / "runs"
    table = {}

    a4 = runs / "A4.json"
    if a4.exists():
        table["A4 graph walk (Haiku)"] = score_graph_arm({r["id"]: r["finish"] for r in json.loads(a4.read_text())}, cases)
    facts = runs / "facts_haiku.json"
    if facts.exists():
        extracted = json.loads(facts.read_text())
        right, total, extra = fact_accuracy(extracted, cases)
        print(f"A5 fact extraction (Haiku): {right}/{total} gold facts correct, {extra} extra facts")
        table["A5 predicates+facts"] = score_graph_arm(run_a5(private, cases, extracted), cases)
        gold_facts = {c["id"]: c["gold_facts"] for c in cases}
        table["A5 w/ gold facts"] = score_graph_arm(run_a5(private, cases, gold_facts), cases)
    grades = runs / "manual_grades.json"
    if grades.exists():
        for arm, g in json.loads(grades.read_text()).items():
            table[arm] = [(c["id"], bool(g.get(c["id"])), None) for c in cases]

    print(f"{'arm':26} {'final correct':>13} {'mean path Jaccard':>18}  per-case")
    for arm, rows in table.items():
        n_ok = sum(ok for _, ok, _ in rows)
        jac = [j for _, _, j in rows if j is not None]
        mean_j = f"{sum(jac) / len(jac):.2f}" if jac else "n/a"
        per = " ".join(f"{cid}:{'Y' if ok else 'N'}" for cid, ok, _ in rows)
        print(f"{arm:26} {n_ok:>6}/{len(rows):<6} {mean_j:>18}  {per}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "private")
