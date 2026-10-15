# OncoCarta (interactive viewer)

OncoCarta is a React + TypeScript app (in `web/`) that turns the encoded guidelines into an NCCN-Navigator-style reader with a patient-driven pathway finder. It reads the canonical `data/<slug>/guideline.json` files directly (`web/src/lib/adapt.ts`), so every one of the 91 encoded guidelines works without a per-guideline build.

```
cd web && npm install && npm run build && cd ..                     # app -> src/nccn_nav/dashboard.html
PYTHONPATH=src python -m nccn_nav.dashboard --library               # all guidelines -> built/oncocarta.html (serve the repo over http)
PYTHONPATH=src python -m nccn_nav.dashboard data/<slug> [out_dir]   # one guideline, offline -> <out_dir>/<slug>-oncocarta.html
PYTHONPATH=src python -m nccn_nav.dashboard --sample out            # synthetic demo data (older format), safe to share
```

## Atlas (home page)
The library opens on a map of every guideline (`web/src/atlas/`). Built from `build_atlas()` in `dashboard.py` (about 190 KB, embedded in `built/oncocarta.html` as `window.__ATLAS__`); the grouping into sites is front-end owned, in `src/nccn_nav/atlas_sites.json` (sites in ring order, plus search aliases such as CLL, GIST, RCC).
- **The map.** A search hub at the centre; 15 site sectors around it; the 91 guidelines on the outer ring, sized by algorithm pages, shaped by category (disc treatment, ring supportive care, diamond detection/prevention/risk, rounded square specific populations), with an outer arc for the share of decision boxes that have an encoded condition. The 175 references between guidelines are drawn as bundled curves through the middle (hierarchical edge bundling); pointing at a guideline lights its references with particles running from the citing to the cited guideline.
- **Levels.** Site → guideline → page → reader. A guideline opens in a "lens": its algorithm pages as a radial tree grown from its start pages (later links as dashed chords), section arcs on the rim, and its citations of other guidelines as pills on the side where those guidelines lie on the map. A page unfolds into a card with its boxes where they are printed on the PDF page, edges drawn on left to right, and chips for links to other pages; clicking a box grows a sheet from it into the reader at that box.
- **Search** at the hub (docked at the top once you go in): guidelines (title, abbreviations, aliases), sites, sections and pages (titles and codes, e.g. `PROS-3`). The highlighted result lights up on the map before you choose it.
- **Patients.** In a guideline, example patients (and the patient entered in the reader this session) show their most likely route: drawn page to page in the lens, travelled by particles, and highlighted box by box on the page cards; "Open in the reader with this patient" carries the patient over (`sessionStorage`, key `oc-patient:<slug>`).
- **Getting around.** The hash records the place (`#atlas`, `#atlas/@gi`, `#atlas/prostate`, `#atlas/prostate/PROS-3`), so Back climbs a level; Esc, clicking empty space or zooming far out does the same. The reader's "All guidelines" button returns to the atlas at the page being read. `/` focuses search; `+`, `−`, `0` zoom and refit. A keyboard tree (Tab to the map) walks sites, guidelines and pages with the arrow keys and lights each on the map. The List view (`#list`) keeps the plain list.
- **Motion.** A one-time intro per session draws the rings, sends each guideline out along its spoke and draws the references; the camera flies between levels (d3 `interpolateZoom`); lenses and cards grow with springs. Drawing happens only while something moves. With reduced motion the map is drawn at once and the camera jumps.
- **Small screens.** Search docked at the top, details as a bottom sheet, labels shown where they fit; pinch and drag to move.

## Library
- **List view:** every guideline in `data/index.json`, grouped by category, with search, version and date, and how much of each is encoded (algorithm pages, boxes with an encoded condition). Recently opened guidelines come first.
- **Loading:** a guideline is fetched when opened; the URL hash names it (`#prostate/flow/PROS-3`), so links, Back/Forward and bookmarks work. Example patients load from `<slug>/vignettes/examples.json` when present.
- **Between guidelines:** links typed `external_guideline` in the data, and page codes of another guideline's prefix (`DIS-A`, `LCS-11`), open that guideline at that page. Details lists the other guidelines a box cites.
- **Multi-disease guidelines** (29 of 91, `sections` in the data): the patient form asks for the disease or subtype first; entry boxes carry the section condition.
- **Starting points:** in auto mode, routes start from the algorithm pages that have entry boxes and that no other page leads to (one per disease), plus entry boxes elsewhere that the entries select (own condition, else the linking boxes' `link_condition`).
- **From the data, not heuristics:** options' `received_predicate` ("already received") marks the route taken; `decision_type: condition` without a condition, and `predicate_status: rejected`, are flagged "not encoded"; structured tables pass through row by row; footnotes carry the page that defines each letter; page sizes and content bands drive the layout and previews; the connected PDF is checked against `pdf_sha256`. The older heuristics remain only for bundles without these fields (the synthetic sample).
- **Patient form:** labels are Title Case from the variable names, with abbreviations in capitals (ECOG, PSA, FLT3, hCG, COVID-19): a built-in list plus the words each guideline's own text writes in capitals; unit words already shown beside the input are dropped (`psa_ng_ml` → "PSA"); `lt/le/gt/ge` become < ≤ > ≥ (`web/src/lib/factMeta.ts`). Fields carry their `time` (at diagnosis, history) and judgment flag; long forms (up to 142 fields) have a filter, and fields that match no clinical group are grouped by time.

## What it does
- **Readable cards.** Each box's flat PDF text is parsed into a lead-in, bulleted and nested lists, tier headings (Preferred / Other Recommended / Useful in Certain Circumstances), "or" dividers between alternative regimens, and category tags (`web/src/lib/parseBox.ts`).
- **Linked everywhere.** Page references such as `PROS-A`, `PROS-F 2 of 5`, `ST-1`, `MS-12` and "See Discussion" become links in cards, footnotes, principles pages and the discussion. A principles page lists every box and footnote that cites it.
- **Answer selection.** Click a card to light up every pathway through it (across linked pages); other paths hide until "Non-active paths" is on.
- **Footnote dock** (`*`), **evidence** (`E`) and **preference** (`P`) tabs; footnotes step through "i of N instances".
- **Search** in a side panel: exact phrases in quotes, filter chips that gray out cards that do not apply, counts by type.
- **Patient details.** A form built from `fact_schema.json`, with plain labels and units (`web/src/lib/factMeta.ts`), one-tap choices, numbers that accept bounds and ranges (`>10`, `5-10`), an age field with a life-expectancy helper that applies the PROS-A health-quartile adjustment, "stated classifications" (e.g. a record that only says "low-risk"), the values worked out from the entries, and example patients from `vignettes/examples.json`.
- **Start screen.** First visit offers three ways in (enter a patient, try an example, browse the guideline) and the optional PDF; the help text stays behind the "?" button.
- **Recommendation first.** Each route's detail opens with "Recommended at this point": the box after the route's last decision that carries recommendation tags (Preferred, category), else the last box that is not just a page reference, rendered with its tiers and tags; then what follows ("Then: … Open PROS-8"), and the options offered at the route's last treatment branch with the one this route takes. The step trail follows, with workup and pass-through steps collapsed to one line and per-step links shown on hover or focus.
- **Route summary.** One page to copy as text or print: entered and worked-out details, the recommendation with its structure, fit, open questions, every step with its page code and PDF page, and the caveat.
- **Ranked pathways** (`web/src/lib/pathways.ts`). Every route through the graph that the entries leave open, ranked:
  - *relative likelihood* — 100% shared across open routes; at each branch, arms whose condition is met share it, undecided arms share it equally (and keep a 15% residual share once a sibling is met), contradicted arms are pruned. Not a clinical probability.
  - *criteria met* — encoded conditions on the route the entries satisfy vs. still open. Treatment options without a condition are not counted.
  - *patient data* (Complete / Partial / Sparse) and *extraction* (High / Good / Mixed) are shown separately rather than as one confidence number: coverage of the route's criteria, and the mean reliability of its steps (arrow found by both extractors 1.0, image-verified 0.95, one extractor 0.7; condition not confirmed in review 0.85). Fit is shown as a word ("Most likely", "Possible") with the share of open routes secondary.
  - *not encoded* — a branch box with no condition is flagged "condition not encoded — your judgment" (counted as an open criterion, never as met) when review rejected its drafted condition (`predicates_status.json`) or when its sibling arms have conditions; boxes the guideline lists as side-by-side options stay plain options.
  - "Most useful next" names the missing fact that is open on the largest share of likelihood, and every open criterion links to its field.
  - Auto start: the algorithm pages with entry boxes that no other page leads to (one per disease), plus entry boxes elsewhere that the facts select directly (e.g. PSA recurrence) when the walk did not already pass a page leading there; initial-diagnosis routes give way once a later-state page applies. Routes stop after a recommendation when the next arms are later events (as in `navigator._auto_step`).
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
node e2e/library.mjs                                  # library test: serves the repo, drives built/oncocarta.html
node e2e/atlas.mjs                                    # atlas test: search, levels, patients, keyboard, mobile, reduced motion
node e2e/shoot.mjs <dir> [width height light|dark]    # screenshots of the atlas for design review
```
`web/test/parity.json` is generated by `python tests/make_parity_fixture.py` from the Python predicate code; `tests/test_dashboard.py` fails if it goes stale. Python tests: `python -m unittest discover -s tests -t .`

Design sources and what is not replicated: `research_notes/NCCN navigator UX findings.md`.
