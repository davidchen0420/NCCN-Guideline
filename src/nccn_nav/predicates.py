"""Edge predicates over a structured patient-fact schema (strategy A5).

A predicate is JSON: {"all": [...]}, {"any": [...]}, {"not": p}, or a comparison
{"fact": "life_expectancy_years", "op": ">=", "value": 10}. Ops: == != > >= < <= in.
`evaluate` returns True/False, or None when a needed fact is missing or the predicate is
absent (the branch then needs LLM or clinician judgment).
"""
import operator

OPS = {"==": operator.eq, "!=": operator.ne, ">": operator.gt, ">=": operator.ge,
       "<": operator.lt, "<=": operator.le, "in": lambda a, b: a in b}


def evaluate(pred, facts):
    if pred is None:
        return None
    if "all" in pred or "any" in pred:
        vals = [evaluate(p, facts) for p in pred.get("all", pred.get("any"))]
        if "all" in pred:
            return False if False in vals else (None if None in vals else True)
        return True if True in vals else (None if None in vals else False)
    if "not" in pred:
        v = evaluate(pred["not"], facts)
        return None if v is None else not v
    if facts.get(pred["fact"]) is None:
        return None
    return OPS[pred["op"]](facts[pred["fact"]], pred["value"])
