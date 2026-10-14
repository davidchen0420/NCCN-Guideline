# NCCN Guidelines Navigator: UX observations used to design our dashboard

Scope: interaction design only. No NCCN guideline text, data payloads, API calls, source code or image assets were copied or are stored in this repo.

## Sources
- NCCN's own public pages: `nccn.org/navigator` (feature list) and the public **Guidelines Navigator FAQ** on `nccnusersupport.freshservice.com` (8 short articles with screenshots). Read with REA's headless-browser tooling and Playwright; the FAQ screenshots were viewed in the scratchpad only and are not committed.
- The signed-in app itself was not inspected (login blocked by the session's permission system). Everything below is what the public FAQ and its screenshots show.

## What the screenshots show (own description)
Layout
- A narrow dark-navy **icon rail** on the left: Home, Table of Contents, Search, History (and a few utility icons at the bottom).
- A white **title bar** floating above the canvas: back and forward arrows, the current section title with a coloured left bar, a **Non-active paths** toggle, a **reset** icon (clears pathways) and **collapse/expand** icons.
- A grey **canvas** of rounded cards joined by orthogonal connector lines. A vertical **zoom control** at the left of the canvas: a locate/fit button, a fit-to-screen icon, +, a slider, and −.
- A teal-blue **bottom dock** with tabs: `*` Footnotes, an Rx icon (order templates, subscribers only), `E` Categories of evidence and consensus, `P` Categories of preference. The dock opens upward.

Cards and nodes
- Entry/question cards are saturated blue with white title and a white inner list of radio options (for example the three disease-extent choices). Workup cards are white with a pink or navy outline and a checklist with a Submit/Continue button. Treatment cards list options with small tags: Preferred (pink), Other recommended / Useful in certain circumstances (muted teal), a grey Category tag, a page-reference pill, and footnote letter badges.
- Footnote letters are tiny round badges under the text; the active one turns pink.

Behaviours (from the FAQ text)
- Select answers in nodes to highlight the relevant pathways; non-active paths are hidden unless the **Non-active paths** toggle is on; the reset icon clears the pathways.
- **Footnotes**: click the `*` tab or a badge on a card; the dock lists footnotes, the selected one shows "1 of N instances" with previous/next arrows that jump between where it applies in the algorithm.
- **E** and **P** tabs (or clicking a Category/Preference tag) show the definitions.
- **Search** opens in a left panel with Keyword and AI search tabs. Quotes find an exact match. Filter chips (for example Category 1, Preferred) gray out algorithm content that does not apply; search and filters combine; results not meeting the filter still appear but grayed. A "Show results for non-active paths" toggle and counts by type are shown above the results. Clicking a result navigates to that spot.
- Table of contents lists sections with coloured group markers; zoom out shows the whole algorithm; tutorial and FAQ are built in; PDF and patient-guideline links.

## How the dashboard implements it
| Navigator | Dashboard |
|---|---|
| Icon rail | Navy rail: ⌂ whole guideline, ☰ contents, ⌕ search, ⟲ walk history |
| Title bar | Back/forward, page title, Non-active paths toggle, ↺ clear, ⤡ whole-guideline map, confidence toggle |
| Cards | Boxes drawn as cards at original PDF positions; entry boxes blue; footnote letter badges; "See PROS-x" boxes link |
| Answer selection | Click a card: pathway (ancestors and descendants across linked pages) highlighted; other paths hidden or dimmed per the toggle |
| Zoom control | Fit button, +, slider, − and wheel/drag |
| Dock * / E / P | Footnotes with "i of N instances" stepping; E and P summaries in our own words |
| Search panel | Left panel: keyword search, suggestions, exact-match quotes, filter chips that gray out, non-active toggle, counts; AI tab shown but disabled |
| Tutorial and FAQ | ? Help dialog on first visit |

Not replicated: Rx order templates (subscriber content), AI search, true checklist/radio controls inside cards (our graph stores box text, not option lists), NCCN's exact colours and fonts.

Our additions: guided walk with undo/export and a patient-facts form that follows branches the encoded conditions can decide.
