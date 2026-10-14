"""Unit tests for the deterministic layer and the vector extractor. No NCCN content: the graph
and the PDF are synthetic.

  python -m pytest tests/
"""
import sys
from pathlib import Path

import pymupdf
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nccn_nav import pdfvec  # noqa: E402
from nccn_nav.facts import _convert, _to_number, derive, schema_problems, validate  # noqa: E402
from nccn_nav.navigator import _auto_step  # noqa: E402
from nccn_nav.predicates import compare, evaluate  # noqa: E402


# --- numbers, bounds, intervals -------------------------------------------------------------

def num(v, unit="ng/ml", target="ng/ml"):
    return _convert(_to_number(v), unit, target)


def test_strict_bound_survives_unit_conversion():
    x = num(">10")
    assert compare(x, ">", 10) is True
    assert compare(x, "<=", 10) is False
    assert compare(x, ">", 12) is None


def test_inclusive_and_open_bounds():
    assert compare(num(">=10"), ">=", 10) is True
    assert compare(num(">=10"), ">", 10) is None
    assert compare(num({"gt": 50}, "count", "count"), ">", 50) is True
    assert compare(num({"lt": 6}, "mm", "mm"), "<", 6) is True


def test_range_and_conversion():
    x = num({"min": 6, "max": 8}, "mm", "mm")
    assert compare(x, ">=", 6) is True and compare(x, "<", 6) is False and compare(x, ">", 7) is None
    two_years = num({"max": 2}, "years", "months")
    assert compare(two_years, "<=", 24) is True and compare(two_years, "<", 24) is None
    assert num(5, "cm", "mm") == 50


def test_unknown_unit_is_dropped():
    assert num(5, "furlongs", "cm") is None


def test_three_valued_logic():
    facts = {"a": 1}
    assert evaluate({"all": [{"fact": "a", "op": "==", "value": 1}, {"fact": "b", "op": "==", "value": 1}]}, facts) is None
    assert evaluate({"any": [{"fact": "a", "op": "==", "value": 1}, {"fact": "b", "op": "==", "value": 1}]}, facts) is True
    assert evaluate({"not": {"fact": "b", "op": "==", "value": 1}}, facts) is None


# --- schema, validation, derivation ---------------------------------------------------------

SCHEMA = {
    "variables": {
        "age_years": {"type": "number", "unit": "years"},
        "m_category": {"type": "enum", "values": ["M0", "M1"]},
        "high_risk_stated": {"type": "bool"},
    },
    "derived": {
        "high_risk": {"type": "bool", "rules": [
            {"if": {"fact": "high_risk_stated", "op": "==", "value": True}, "then": True},
            {"if": {"fact": "age_years", "op": ">=", "value": 70}, "then": True}], "else": False},
    },
}


def test_schema_checker_flags_judgments():
    bad = {"variables": {"psa_high": {"type": "bool"}, "x": {"type": "bool", "definition": "PSA > 10 ng/mL"}}}
    names = {n for n, _ in schema_problems(bad)}
    assert names == {"psa_high", "x"}
    assert schema_problems(SCHEMA) == []


def test_validate_requires_quotes_and_allowed_values():
    case = "A 72-year-old man. Imaging shows new bone metastases."
    facts, rejected = validate({
        "age_years": {"value": 72, "unit": "years", "quote": "72-year-old"},
        "m_category": {"value": "M1", "quote": "new bone metastases"},
        "high_risk_stated": {"value": True, "quote": "invented text"},
    }, SCHEMA, case)
    assert facts == {"age_years": 72, "m_category": "M1"}
    assert [n for n, _ in rejected] == ["high_risk_stated"]


def test_stated_flags_default_to_false_in_derivation():
    assert derive({"age_years": 60}, SCHEMA)["high_risk"] is False
    assert derive({"age_years": 75}, SCHEMA)["high_risk"] is True
    assert "high_risk" not in derive({}, SCHEMA)  # age unknown: undecidable, never guessed


# --- engine ---------------------------------------------------------------------------------

class TinyGraph:
    """root -> {a, b}; a -> a1 -> {x, y}; b is a leaf."""

    def __init__(self, preds):
        self.children = {"root": ["a", "b"], "a": ["a1"], "a1": ["x", "y"], "b": [], "x": [], "y": []}
        self.nodes = {n: {"text": n, "page": "P-1"} for n in self.children}
        self.predicates = preds


def walk_from(gl, facts, initial=None):
    state = {"at": "root", "path": [{"node": "root", "by": "entry"}], "facts": facts, "initial": initial}
    _auto_step(gl, state)
    return [p["node"] for p in state["path"]]


def test_engine_follows_decided_branches():
    gl = TinyGraph({"a": {"fact": "m", "op": "==", "value": "M0"}, "b": {"fact": "m", "op": "==", "value": "M1"},
                    "x": {"fact": "k", "op": ">", "value": 5}, "y": {"fact": "k", "op": "<=", "value": 5}})
    assert walk_from(gl, {"m": "M0", "k": 7}) == ["root", "a", "a1", "x"]
    assert walk_from(gl, {"m": "M1"}) == ["root", "b"]
    assert walk_from(gl, {"m": "M0"}) == ["root", "a", "a1"]  # k unknown: stops, never guesses


def test_otherwise_branch():
    gl = TinyGraph({"a": {"fact": "m", "op": "==", "value": "M0"}, "b": None})
    assert walk_from(gl, {"m": "M1"}) == ["root", "b"]


def test_earlier_state_never_overrides_current():
    gl = TinyGraph({"a": {"fact": "m", "op": "==", "value": "M0"}, "b": {"fact": "m", "op": "==", "value": "M1"}})
    assert walk_from(gl, {"m": "M1"}, initial={"m": "M0"}) == ["root", "b"]
    # Current state undecided: the earlier state decides.
    assert walk_from(gl, {}, initial={"m": "M0"})[:2] == ["root", "a"]


# --- vector extractor on a synthetic page ---------------------------------------------------

def arrow(page, a, b):
    page.draw_line(a, b, width=1.0)
    x, y = b
    if a[1] == b[1]:  # horizontal, pointing right
        page.draw_polyline([(x, y - 3), (x + 5, y), (x, y + 3), (x, y - 3)], fill=(0, 0, 0), width=0)
    else:  # vertical, pointing down
        page.draw_polyline([(x - 3, y), (x, y + 5), (x + 3, y), (x - 3, y)], fill=(0, 0, 0), width=0)


@pytest.fixture()
def synthetic_doc(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page(width=792, height=612)
    page.insert_text((60, 200), "Entry box", fontsize=10)
    page.insert_text((300, 160), "Upper branch", fontsize=10)
    page.insert_text((300, 260), "Lower branch", fontsize=10)
    page.insert_text((300, 360), "Below lower", fontsize=10)
    page.insert_text((520, 160), "Target", fontsize=10)
    # Fan-out: entry -> stem -> two branches.
    page.draw_line((120, 197), (150, 197), width=1.0)
    page.draw_line((150, 157), (150, 257), width=1.0)
    arrow(page, (150, 157), (292, 157))
    arrow(page, (150, 257), (292, 257))
    # Upper branch -> bracket of Target, touching the bracket mid-way.
    page.draw_line((515, 140), (515, 175), width=1.0)
    arrow(page, (380, 157), (510, 157))
    # Vertical arrow from Lower branch down to Below lower.
    arrow(page, (320, 268), (320, 345))
    return doc


def test_extractor_on_synthetic_page(synthetic_doc):
    g = pdfvec.extract_page_graph(synthetic_doc, 0)
    text = {n["id"]: n["text"] for n in g["nodes"]}
    edges = {(text[e["src"]], text[e["dst"]]) for e in g["edges"]}
    assert ("Entry box", "Upper branch") in edges
    assert ("Entry box", "Lower branch") in edges
    assert ("Upper branch", "Target") in edges
    assert ("Lower branch", "Below lower") in edges
    assert g["n_unattached"] == 0
