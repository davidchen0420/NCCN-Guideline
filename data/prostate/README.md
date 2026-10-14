# Processed NCCN Prostate Cancer guideline (v6.2026)

Derived from the licensed NCCN PDF, which is not included. Rebuild everything with:
- `python -m nccn_nav.pipeline private/prostate`, then
- `python -m nccn_nav.consensus private/prostate`.

Page images and embedding caches are omitted.

| File | Contents | Status |
|---|---|---|
| `e1_graphs.json` | Vector-extracted decision graph per algorithm page (PROS-1 to 18). Boxes have text, bbox, footnote refs, page links and structural role. | Current. Box ids are position-based (`n<y>_<x>`) |
| `e2/` | Haiku vision transcription of each page | Current |
| `merged_graphs.json` | E1 boxes with consensus arrows. `support` is `agreed` (E1 and E2), `verified` (image check), `e1_only` or `e2_only`. This is the graph the navigator walks | Current |
| `review/edge_verdicts_*.json` | Image-check verdicts on disputed arrows | Current; migrated to position-based ids |
| `footnotes.json` | Footnotes per page code. Letters repeat across pages with different text | Current |
| `pages.json`, `chunks_full.json` | Full page store: every page in reading order, tables as Markdown, plus retrieval chunks | Current |
| `fact_schema.json` | Patient-fact schema: raw variables plus derived classifications computed by code | Current (round 1, Haiku-drafted; not clinician-reviewed) |
| `llm/` | Inputs and outputs of the Haiku predicate-drafting step | In progress (round 1) |
| `predicates.json`, `predicates_*draft*.json`, `predicates_status.json`, `nodes_for_predicates*` | **Old** predicates keyed by the old sequential box ids (`n0`, `n1`, …) | Superseded; do not use with the current graphs |
| `gold/` | Reference graphs for PROS-3, 7, 9 and 13, written by Claude | Not clinician-made |
| `medguide/` | Our outputs on MedGUIDE prostate_14: A0 answers, extracted facts, label checks, mapping, dev/test split, scores. The MedGUIDE items themselves are not copied; see HF `MedGUIDE/MedGUIDE-MCQA-8K` | Old facts and predicates are superseded |
| `redflags.json` | E1 pages flagged for the vision cross-check | Current |
| `viz/` | HTML graph viewer | Built from the old merged graph |
| `runs/`, `vignettes/`, `e4/`, `chunks.json`, `chunks_all.json` | Earlier smoke tests and older chunkings | Historical |
