"""Edge predicates over a structured patient-fact schema (strategy A5), evaluated by code.

A predicate is JSON: {"all": [...]}, {"any": [...]}, {"not": p}, or a comparison
{"fact": "psa_ng_ml", "op": ">=", "value": 10}. Ops: == != > >= < <= in not_in.

Facts are raw values (numbers in the schema's unit, enum strings, booleans), never
LLM-made threshold judgments. A number may also be an interval {"min": a, "max": b}
(either bound optional) when the source gives a range such as "life expectancy >20 y";
a comparison whose threshold falls inside the interval is undecidable.

`evaluate` returns True/False, or None when a needed fact is missing/unknown, the
comparison is undecidable, or the predicate is absent (the branch then needs LLM or
clinician judgment).
"""
import operator

OPS = {"==": operator.eq, "!=": operator.ne, ">": operator.gt, ">=": operator.ge,
       "<": operator.lt, "<=": operator.le}


def _compare_interval(lo, hi, op, v):
    """Three-valued comparison of an unknown number x in [lo, hi] (None = unbounded)."""
    lo = float("-inf") if lo is None else lo
    hi = float("inf") if hi is None else hi
    if op in (">", ">="):
        if OPS[op](lo, v):
            return True
        if not OPS[op](hi, v):
            return False
        return None
    if op in ("<", "<="):
        if OPS[op](hi, v):
            return True
        if not OPS[op](lo, v):
            return False
        return None
    if op == "==":
        return True if lo == hi == v else (False if v < lo or v > hi else None)
    if op == "!=":
        r = _compare_interval(lo, hi, "==", v)
        return None if r is None else not r
    return None


def compare(x, op, v):
    if x is None or x == "unknown":
        return None
    if op == "in":
        return x in v
    if op == "not_in":
        return x not in v
    if isinstance(x, dict):  # interval
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            return None
        return _compare_interval(x.get("min"), x.get("max"), op, v)
    try:
        return OPS[op](x, v)
    except TypeError:
        return None  # type mismatch (e.g. string vs number): treat as undecidable


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
    return compare(facts.get(pred["fact"]), pred["op"], pred["value"])


def facts_used(pred, out=None):
    out = set() if out is None else out
    if not pred:
        return out
    for key in ("all", "any"):
        for p in pred.get(key, []):
            facts_used(p, out)
    if "not" in pred:
        facts_used(pred["not"], out)
    if "fact" in pred:
        out.add(pred["fact"])
    return out
