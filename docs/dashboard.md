# Guideline navigator (interactive viewer)

A React + TypeScript app (in `web/`) that turns the encoded decision graph into an NCCN-Navigator-style reader. Python bundles the guideline data into one self-contained HTML file that works offline, on a phone or a laptop.

```
# build the viewer from the processed guideline (output is gitignored: it embeds licensed text)
PYTHONPATH=src python -m nccn_nav.dashboard data/prostate        # -> private/viz/dashboard.html
PYTHONPATH=src python -m nccn_nav.dashboard --sample out         # synthetic demo data, safe to share
```

## What it does
- **Readable cards.** Each box's flat PDF text is parsed into a lead-in, bulleted and nested lists, tier headings (Preferred / Other Recommended / Useful in Certain Circumstances), "or" dividers between alternative regimens, and category tags (`web/src/lib/parseBox.ts`).
- **Linked everywhere.** Page references such as `PROS-A`, `PROS-F 2 of 5`, `ST-1`, `MS-12` and "See Discussion" become links in cards, footnotes, principles pages and the discussion. A principles page lists every box and footnote that cites it.
- **Answer selection.** Click a card to light up every pathway through it (across linked pages); other paths hide until "Non-active paths" is on.
- **Footnote dock** (`*`), **evidence** (`E`) and **preference** (`P`) tabs; footnotes step through "i of N instances".
- **Search** in a side panel: exact phrases in quotes, filter chips that gray out cards that do not apply, counts by type.
- **Patient details.** A form built from `fact_schema.json`, with plain labels and units (`web/src/lib/factMeta.ts`), one-tap choices, numbers that accept bounds and ranges (`>10`, `5-10`), an age field with a life-expectancy helper that applies the PROS-A health-quartile adjustment, "stated classifications" (e.g. a record that only says "low-risk"), the values worked out from the entries, and example patients from `vignettes/examples.json`.
- **Ranked pathways** (`web/src/lib/pathways.ts`). Every route through the graph that the entries leave open, ranked:
  - *relative likelihood* — 100% shared across open routes; at each branch, arms whose condition is met share it, undecided arms share it equally (and keep a 15% residual share once a sibling is met), contradicted arms are pruned. Not a clinical probability.
  - *criteria met* — encoded conditions on the route the entries satisfy vs. still open. Treatment options without a condition are not counted.
  - *confidence* (0–100) — criteria coverage × encoding reliability (arrow found by both extractors 1.0, image-verified 0.95, one extractor 0.7; condition not confirmed in review 0.85).
  - "Most useful next" names the missing fact that is open on the largest share of likelihood, and every open criterion links to its field.
  - Auto start: the first algorithm page, plus entry boxes elsewhere that the facts select directly (e.g. PSA recurrence) when the walk did not already pass a page leading there; initial-diagnosis routes give way once a later-state page applies. Routes stop after a recommendation when the next arms are later events (as in `navigator._auto_step`). Table pages (PROS-2) are flattened into one box per cell, so row criteria are attached to the row's continuing cell.
- **Source previews.** Hover a step, card, footnote or principles page to preview the PDF page it came from with the box outlined; click to open a floating page viewer (drag, resize, zoom, page through, pop out with the Document Picture-in-Picture API where the browser supports it). The PDF is licensed and never bundled: connect it once with the title-bar button or by dropping it on the page (kept in this browser's IndexedDB), or serve the folder over http with the PDF at `pdf/<slug>.pdf` next to the data. Without it, previews show the page reconstructed from the extracted box positions. pdf.js is bundled so this works offline.
- **Guided walk.** Step through the algorithm from any card; branches the entries decide are followed automatically.
- **Conditions.** `predicates.json` is authoritative: conditions rejected in review are left out (the raw drafts in `llm/pred_out_*.json` are used only when no `predicates.json` exists). Each condition shows whether review confirmed it, and every criterion shows the patient's value and whether it is met. Conditions were drafted and reviewed by a language model, not clinicians.
- **Phone layout.** Single column, contents drawer, details bottom sheet, readable default zoom.

## Data it reads
From the data folder: `merged_graphs.json` (or `e1_graphs.json`), `footnotes.json`, `pages.json` (principles, staging, discussion, and each page's PDF index), `fact_schema.json`, `predicates.json` with `predicates_status.json` (or the drafts in `llm/pred_out_*.json`), and `vignettes/examples.json`. The PDF's private-use glyphs and control characters are cleaned in `dashboard.py`; page titles come from the page text.

## Developing the front end
```
cd web
npm install
npm test            # vitest: parser, predicates (parity with Python), layout, walk
npm run build       # typecheck + single-file build, copied to src/nccn_nav/dashboard.html
node e2e/smoke.mjs <path-to-sample-dashboard.html>   # browser test (set CHROMIUM_PATH if needed)
```
`web/test/parity.json` is generated by `python tests/make_parity_fixture.py` from the Python predicate code; `tests/test_dashboard.py` fails if it goes stale. Python tests: `python -m unittest discover -s tests -t .`

Design sources and what is not replicated: `research_notes/NCCN navigator UX findings.md`.
