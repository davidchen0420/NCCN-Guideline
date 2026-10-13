# Guideline dashboard

An interactive, NCCN-Navigator-style viewer for the encoded decision graph: page list, original-layout flowchart (pan/zoom), clickable page links, footnote and principles panel, search, a guided walk with undo/export, and a patient-facts form that follows branches the encoded conditions can decide.

```
cd src
python -m nccn_nav.dashboard ../private   # real guideline -> ../private/viz/dashboard.html (gitignored)
python -m nccn_nav.dashboard --sample out # synthetic demo data, safe to share
```

Inputs read from `<private>`: `merged_graphs.json` (or `e1_graphs.json`), `footnotes.json`, `predicates.json`, `chunks_full.json` (or `chunks.json`). The output embeds licensed guideline text: keep it in `private/`, never commit or publish it.

The facts form is generated from `predicates.json`, so it follows whatever conditions are encoded (currently PROS-3, 9, 16); other pages fall back to manual choices. The walk logic mirrors `navigator.py` (`_auto_step`, reconvergence); `predicates.js` mirrors `predicates.py`.

Tests: `python -m unittest discover -s tests -t .`
UX notes: `research_notes/NCCN navigator UX findings.md`.
