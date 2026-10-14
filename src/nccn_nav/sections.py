"""Guideline sections: the disease or subtype a page belongs to, read from its running header.

Many guidelines cover several diseases (Bone Cancer: Chondrosarcoma, Chordoma, Ewing Sarcoma,
...) and name the disease only in the page title, never in the decision boxes. Without it an
entry box such as "Workup" has no condition and the engine cannot tell which section a
patient belongs to. Here code reads every page title; for a guideline with two or more
specific sections it

  - writes sections.json  {"variable", "values", "pages": {page: section or null}},
  - adds an enum variable `guideline_section` to fact_schema.json (fact extraction reads it
    off the case like any other variable),

and Guideline (navigator.py) ANDs `guideline_section == <page section>` into the predicate of
each entry box (see entry_predicates). A general title (the guideline's own name, or one whose
words all occur in another title, e.g. "Colon Cancer" next to "pMMR/MSS Colon Cancer")
constrains nothing.

  python -m nccn_nav.sections private/<slug> [...]
"""
import csv
import json
import re
import sys
from pathlib import Path

VAR = "guideline_section"
DEFINITION = ("Which disease or subtype section of this guideline the case belongs to: the disease named "
              "in the guideline's page headings that the patient has (e.g. the tumor type or subtype).")


def _words(t):
    return set(re.findall(r"[a-z0-9]+", t.lower()))


def clean(title):
    title = re.sub(r"\s+", " ", title).strip()
    return re.sub(r"^(.+?) \1\b", r"\1", title)  # "Breast Cancer Breast Cancer During Pregnancy"


def guideline_name(root):
    manifest = Path(__file__).resolve().parents[2] / "NCCN Guidelines" / "manifest.csv"
    if manifest.exists():
        for row in csv.DictReader(manifest.open()):
            if row["slug"] == Path(root).name:
                return row["title"]
    return ""


def specific(titles, name=""):
    """Titles that name a section: not empty, not the guideline's own name and not a title whose
    words all occur in another title."""
    ws = {t: _words(t) for t in titles if _words(t)}
    out = []
    for t, w in ws.items():
        if name and w == _words(name):
            continue
        if any(w < o for u, o in ws.items() if u != t):
            continue
        out.append(t)
    return sorted(out)


def build(root):
    from .guideline import Spec
    from .layout import page_title

    root = Path(root)
    merged = json.loads((root / "merged_graphs.json").read_text())
    spec = Spec(root)
    titles = {p: clean(page_title(spec.doc[spec.index_of(p)])) for p in merged}
    values = specific(set(titles.values()), guideline_name(root))
    path, schema_path = root / "sections.json", root / "fact_schema.json"
    schema = json.loads(schema_path.read_text()) if schema_path.exists() else None
    if len(values) < 2:
        path.unlink(missing_ok=True)
        if schema and schema["variables"].pop(VAR, None) is not None:
            schema_path.write_text(json.dumps(schema, indent=1))
        print(f"{root.name}: single section")
        return None
    data = {"variable": VAR, "values": values, "pages": {p: (t if t in values else None) for p, t in titles.items()}}
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    if schema:
        schema["variables"][VAR] = {"type": "enum", "values": values, "definition": DEFINITION}
        schema_path.write_text(json.dumps(schema, indent=1, ensure_ascii=False))
    print(f"{root.name}: {len(values)} sections, {sum(v is not None for v in data['pages'].values())}/{len(titles)} pages")
    return data


def entry_predicates(predicates, roots, sections, linked_pages):
    """Predicates with the section clause ANDed into each entry box. An entry box without a
    predicate gets the section clause alone only when it is the single entry of a page that no
    other page links to (a section's first page, e.g. its workup); otherwise it stays without one."""
    if not sections:
        return predicates
    out = dict(predicates)
    for page, rs in roots.items():
        sec = sections["pages"].get(page)
        if not sec:
            continue
        clause = {"fact": sections["variable"], "op": "==", "value": sec}
        for r in rs:
            p = predicates.get(r)
            if p is not None:
                out[r] = {"all": [clause, p]}
            elif len(rs) == 1 and page not in linked_pages:
                out[r] = clause
    return out


def load(root):
    p = Path(root) / "sections.json"
    return json.loads(p.read_text()) if p.exists() else None


if __name__ == "__main__":
    for r in sys.argv[1:]:
        build(r)
