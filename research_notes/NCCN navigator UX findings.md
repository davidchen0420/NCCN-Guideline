# NCCN Guidelines Navigator: UX observations used to design our dashboard

Scope: interaction design only. No NCCN guideline text, data payloads, API calls, source code or image assets were copied.

## What was and wasn't observable
- REA 6.4.0 (`npx rea-agents`, MIT) drove a headless Chromium over CDP against NCCN's public pages (`nccn.org/navigator`, the Prostate "Guidelines Detail" page).
- The Navigator app itself (`guidelines.nccn.org/guidelines/prostate`) redirects to an NCCN login. Sign-in from the agent session was blocked by the session's permission system, so **the real app's runtime UI, layout, styling and network behaviour were not inspected**. This document is therefore built from NCCN's public feature description only; the dashboard approximates the behaviours, not the look.
- Follow-up if wanted: capture screenshots from a signed-in session (by the account holder) and refine the layout and styling from those.

## Publicly described features (NCCN's page and the June 2025 launch release)
1. Same content as the PDF in a digital format.
2. Move through a guideline with the table of contents or search.
3. Select answers in nodes to highlight relevant pathways.
4. Sections are colour-coded and linked.
5. A **Clear** button resets selected answers.
6. Footnotes are viewable directly from the pathways.
7. Search auto-completes typed prompts; filters highlight content of interest.
8. Zoom, including zooming out to see the whole algorithm.
9. Built-in tutorial and FAQ; links to the PDF and to patient guidelines; mobile friendly.
10. Chemotherapy order template links (subscribers only) and AI search for a limited set of diseases are mentioned as available/planned. Not replicated.

## How the dashboard implements each
| Navigator feature | Dashboard |
|---|---|
| Table of contents | Left list: algorithm pages (blue), principles (teal), discussion (amber); filterable; drawer on mobile |
| Select answers → pathway highlight | Click a box: it becomes an answer; all pathways through the selected boxes (ancestors and descendants, across linked pages) are highlighted and the rest dim; chips in the Details tab remove one answer |
| Clear | Toolbar **Clear** button |
| Footnotes from pathways | Hover a box for a footnote preview; Details tab lists them and highlights every box using one |
| Colour-coded linked sections | Section colour on page list and link chips; "See PROS-x" boxes jump to the page; Back/Forward and deep links |
| Search auto-complete + filters | Word completions, filter chips (All, Algorithm, Footnotes, Principles, Discussion), arrow-key and Enter navigation |
| Zoom / whole algorithm | Wheel, +/−, Fit; **Whole guideline** map of all pages and their links |
| Tutorial and FAQ | **? Help** dialog, shown on first visit |
| PDF / patient guidelines | Toolbar links to NCCN's public pages |
| Mobile | Single column, page list in a drawer |

Our additions (not in NCCN's tool): guided walk with undo/export, and a patient-facts form that follows branches the encoded conditions can decide.
