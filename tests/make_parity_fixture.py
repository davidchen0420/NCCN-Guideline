"""Write web/test/parity.json: predicate and derive cases with the answers from the Python code.

The TypeScript port (web/src/lib/predicates.ts) is tested against this file, and
tests/test_dashboard.py checks it still matches the Python implementation.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from nccn_nav.facts import derive  # noqa: E402
from nccn_nav.predicates import evaluate  # noqa: E402

SAMPLE = ROOT / "src" / "nccn_nav" / "sample"
FACTS = [
    {"score": 12, "age": 70}, {"score": 3}, {}, {"score": 10, "age": 64}, {"age": None},
    {"score": {"min": 8}, "age": {"min": 60, "max": 70}}, {"score": "x", "age": "unknown"}, {"stage": "late"},
    {"score": {"max": 9}}, {"score": {"min": 10, "max": 10}, "stage": "early"},
    {"score": {"min": 10, "max": None, "min_open": True, "max_open": False}},
    {"score": {"min": None, "max": 10, "min_open": False, "max_open": True}, "age": {"min": 65, "max": 65}},
]
PREDS = {
    "ge": {"fact": "score", "op": ">=", "value": 10},
    "lt": {"fact": "score", "op": "<", "value": 10},
    "eq": {"fact": "score", "op": "==", "value": 10},
    "ne": {"fact": "score", "op": "!=", "value": 3},
    "in": {"fact": "stage", "op": "in", "value": ["early", "mid"]},
    "not_in": {"fact": "stage", "op": "not_in", "value": ["early"]},
    "all": {"all": [{"fact": "score", "op": ">=", "value": 5}, {"not": {"fact": "age", "op": "in", "value": [1, 2]}}]},
    "any": {"any": [{"fact": "score", "op": "==", "value": 3}, {"fact": "age", "op": "!=", "value": 70}]},
    "interval": {"all": [{"fact": "score", "op": ">=", "value": 10}, {"fact": "age", "op": "<", "value": 65}]},
}


def build():
    schema = json.loads((SAMPLE / "fact_schema.json").read_text())
    return {
        "preds": PREDS, "facts": FACTS, "schema": schema,
        "evaluate": {k: [evaluate(p, f) for f in FACTS] for k, p in PREDS.items()},
        "derive": [derive(f, schema) for f in FACTS],
    }


if __name__ == "__main__":
    out = ROOT / "web" / "test" / "parity.json"
    out.write_text(json.dumps(build(), indent=1, sort_keys=True) + "\n")
    print("wrote", out)
