# Guideline dashboard

An interactive, NCCN-Navigator-style viewer for the encoded decision graph: page list, original-layout flowchart (pan/zoom), clickable page links, footnote and principles panel, search, a guided walk with undo/export, and a patient-facts form that follows branches the encoded conditions can decide.

```
cd <repo root>
PYTHONPATH=src python -m nccn_nav.dashboard data/prostate   # -> private/viz/dashboard.html (gitignored)
PYTHONPATH=src python -m nccn_nav.dashboard --sample out    # synthetic demo data
```

Inputs from the data folder: `merged_graphs.json` (or `e1_graphs.json`), `footnotes.json`, `fact_schema.json`, `chunks_full.json`, and the predicate drafts in `llm/pred_out_*.json` (the old `predicates.json` is ignored where its ids match no box). The output embeds guideline text: keep it in `private/`, do not commit or publish it.

- The facts form is built from `fact_schema.json` raw variables; derived classes (risk group, life-expectancy band, ...) are computed in the page by `predicates.js` (a port of `predicates.py` and `facts.derive`; interval facts and `not_in` supported).
- Branch conditions are machine-drafted and not clinician-reviewed; the panel says so. Boxes without a condition (null drafts) need a manual choice, which is common at entry boxes.
- Navigator-style features: click a box to select it as an answer (pathways through it light up, Clear resets), search with completions and filters, a whole-guideline map, help dialog, and a mobile page drawer. See the UX notes for the source of each.
- The walk mirrors `navigator.py` (`_auto_step`, reconvergence).

Tests: `python -m unittest discover -s tests -t .`
UX notes: `research_notes/NCCN navigator UX findings.md`.
