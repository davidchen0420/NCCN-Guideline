# NCCN Guidelines Navigator: UX observations used to design our dashboard

Scope: interaction design only. No NCCN guideline text, data payloads, API calls or code were copied.

## What REA could and could not reach
- REA 6.4.0 (`npx rea-agents`, MIT) drove a headless Chromium over CDP (`list-browser-targets`, `analyze-web-bundle`).
- The public Prostate "Guidelines Detail" page links to "NCCN Guidelines Navigator™ — Interactive Digital Guideline Tool" at `guidelines.nccn.org/guidelines/prostate`.
- That app redirects to an NCCN OAuth login (free account). We did **not** sign in or bypass it, so its runtime UI, bundle and network behaviour were **not** inspected.
- Findings below come from NCCN's public description (launch release, June 2025) and the public landing pages.

## Publicly described behaviour
- Same content as the PDF, as an interactive tool.
- Move through it with a table of contents or search; search autocompletes and has filters.
- Selecting an answer at a decision node highlights the matching pathway(s).
- Sections are colour-coded and linked; footnotes link from the pathways; zoom is supported.
- Direct links to patient guidelines and the PDF; built-in tutorial/FAQ; mobile friendly.

## What our dashboard copies (the interaction ideas)
| Navigator idea | Our version |
|---|---|
| Table of contents | Left sidebar grouped into algorithm pages, principles, discussion; filterable |
| Pick an answer to highlight a pathway | Guided walk: choose a child at each box; the path is highlighted on the chart and in a breadcrumb |
| Linked footnotes | Clickable footnote letters on a box open the footnote text in the side panel |
| Linked sections | "See PROS-x" boxes jump to that page; back/forward and deep links |
| Search with autocomplete | Client-side search over boxes, footnotes and principles/discussion chunks |
| Zoom | Wheel/drag/buttons on the flowchart |

Our addition: a patient-facts form that decides branches automatically from `predicates.json` and says where judgment is needed.
