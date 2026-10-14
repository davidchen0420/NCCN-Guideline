"""Patient facts: schema checks, validation of LLM-extracted raw values, unit conversion and
deterministic derived variables. The LLM only reads values off the case text; every
threshold, category and classification is decided here or in predicates.evaluate.

Schema (private/<slug>/fact_schema.json):
  {"variables": {name: {"type": "number"|"enum"|"bool", "unit": ..., "values": [...],
                        "definition": ...}},
   "derived":   {name: {"type": "enum"|"bool", "definition": ...,
                        "rules": [{"if": predicate, "then": value}, ...], "else": value?}}}
Derived rules are tried in order: the first rule that is True gives the value; a rule that
is undecidable before any True one makes the derived value unknown (never a guess).

Extraction format (one case): {name: {"value": v, "unit": u?, "quote": "..."}}.
"""
import re

from .predicates import evaluate

# Words that mark a threshold or judgment baked into a variable name ("psa_over_10",
# "high_volume", "life_expectancy_gt_10y"): such variables must be raw measurements instead.
JUDGMENT_RE = re.compile(
    r"(^|_)(over|under|gt|lt|ge|le|gte|lte|above|below|greater|less|exceeds?|at_least|at_most|"
    r"high|low|elevated|large|small|long|short|more_than|fewer_than|judges?_\w+_volume)(_|$)")

UNITS = {
    # canonical unit -> {alias: factor to canonical}
    "years": {"years": 1, "year": 1, "y": 1, "yr": 1, "months": 1 / 12, "month": 1 / 12, "mo": 1 / 12,
              "weeks": 1 / 52.18, "week": 1 / 52.18, "days": 1 / 365.25, "day": 1 / 365.25},
    "months": {"months": 1, "month": 1, "mo": 1, "years": 12, "year": 12, "y": 12, "yr": 12,
               "weeks": 12 / 52.18, "week": 12 / 52.18, "wk": 12 / 52.18, "days": 12 / 365.25, "day": 12 / 365.25},
    "weeks": {"weeks": 1, "week": 1, "wk": 1, "days": 1 / 7, "day": 1 / 7, "months": 52.18 / 12,
              "month": 52.18 / 12, "mo": 52.18 / 12, "years": 52.18, "year": 52.18},
    "cm": {"cm": 1, "mm": 0.1, "m": 100},
    "mm": {"mm": 1, "cm": 10},
    "ng/ml": {"ng/ml": 1, "ng/dl": 0.01, "ug/l": 1, "µg/l": 1},
    "ng/dl": {"ng/dl": 1, "ng/ml": 100, "nmol/l": 28.84},
    "percent": {"percent": 1, "%": 1, "pct": 1},
}


def schema_problems(schema):
    """Variables that encode a judgment or threshold instead of a raw value."""
    out = []
    for name, var in schema.get("variables", {}).items():
        if JUDGMENT_RE.search(name) and not name.endswith("_stated"):  # "_stated": explicit statement
            out.append((name, "name encodes a threshold/judgment; store the raw measurement"))
        if var.get("type") == "bool" and re.search(r"[<>≤≥]\s*\d|\b\d+(\.\d+)?\s*(mo|months|years|cm|mm|ng)",
                                                   var.get("definition", "")):
            out.append((name, "boolean defined by a numeric threshold; use a number variable"))
        if var.get("type") == "enum" and not var.get("values"):
            out.append((name, "enum without allowed values"))
        if var.get("type") == "number" and var.get("unit", "").lower() not in UNITS and var.get("unit") not in (None, "", "count", "score", "grade"):
            out.append((name, f"unit {var.get('unit')!r} has no converter"))
    return out


def _norm(text):
    return re.sub(r"\s+", " ", re.sub(r"[^\w<>≤≥=.%/+-]+", " ", text.lower())).strip()


def _to_number(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, dict):
        lo, hi = _to_number(v.get("min")), _to_number(v.get("max"))
        if lo is None and hi is None:
            return None
        return {"min": lo, "max": hi}
    if isinstance(v, str):
        m = re.fullmatch(r"\s*([<>]=?|≤|≥)?\s*(-?\d+(?:\.\d+)?)\s*", v)
        if m:
            x = float(m.group(2))
            op = m.group(1)
            if not op:
                return x
            return {"min": x} if op in (">", ">=", "≥") else {"max": x}
    return None


def _convert(x, unit, target):
    if x is None:
        return None
    if not target or target.lower() not in UNITS:
        return x
    table = UNITS[target.lower()]
    factor = table.get((unit or target).lower().strip())
    if factor is None:
        return None  # unknown or incompatible unit: drop rather than guess
    if isinstance(x, dict):
        return {k: (None if b is None else round(b * factor, 4)) for k, b in x.items()}
    return round(x * factor, 4)


def validate(extracted, schema, case_text):
    """Typed facts from one LLM extraction. Values must cite a quote found in the case text.
    Returns (facts, rejected) where rejected lists (name, reason)."""
    facts, rejected = {}, []
    text = _norm(case_text)
    variables = schema["variables"]
    for name, item in (extracted or {}).items():
        derived = schema.get("derived", {})
        if name not in variables and name not in derived:
            rejected.append((name, "not in schema"))
            continue
        if not isinstance(item, dict):
            item = {"value": item}
        value, quote = item.get("value"), item.get("quote") or ""
        if value is None or value == "unknown":
            continue
        if not quote or _norm(quote) not in text:
            rejected.append((name, "quote not found in case text"))
            continue
        if name in derived:
            # A classification the case states outright ("high-risk", "stage IIIA"); otherwise
            # derived values are computed by code from the raw facts.
            allowed = {r["then"] for r in derived[name]["rules"]} | {derived[name].get("else")}
            if value in allowed:
                facts[name] = value
            else:
                rejected.append((name, "stated classification outside rule values"))
            continue
        var = variables[name]
        if var["type"] == "number":
            x = _convert(_to_number(value), item.get("unit"), var.get("unit"))
            if x is None:
                rejected.append((name, "not a number in a known unit"))
                continue
            facts[name] = x
        elif var["type"] == "enum":
            allowed = var.get("values", [])
            if value not in allowed:
                rejected.append((name, "value outside allowed list"))
                continue
            facts[name] = value
        elif var["type"] == "bool":
            if not isinstance(value, bool):
                rejected.append((name, "not a boolean"))
                continue
            facts[name] = value
    return facts, rejected


def derive(facts, schema):
    """Add derived variables (risk group, stage group, ...) computed by rule tables."""
    out = dict(facts)
    for _ in range(3):  # derived variables may depend on other derived variables
        for name, spec in schema.get("derived", {}).items():
            if name in facts:
                continue  # an explicitly stated value wins (e.g. "stage IIIA" in the text)
            value = None
            for rule in spec["rules"]:
                verdict = evaluate(rule["if"], out)
                if verdict is None:
                    break
                if verdict:
                    value = rule["then"]
                    break
            else:
                value = spec.get("else")
            if value is not None:
                out[name] = value
    return out


def agreement(run_a, run_b):
    """Per-variable agreement between two extraction runs: facts kept only when both agree."""
    keep, disagree = {}, []
    for name in set(run_a) | set(run_b):
        a, b = run_a.get(name), run_b.get(name)
        if a == b:
            keep[name] = a
        else:
            disagree.append(name)
    return keep, disagree
