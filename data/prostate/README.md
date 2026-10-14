# Processed NCCN Prostate Cancer guideline (v6.2026)

Derived from the licensed NCCN PDF, which is not included. Page images and embedding caches are omitted.

## Use `guideline.json`

`guideline.json` is the one canonical file. It is built by code (`python -m nccn_nav.bundle private/prostate`) from the intermediate files below, and resolves everything a viewer or engine needs:

| Key | Contents |
|---|---|
| `guideline` | Slug, title, version and date printed on the cover (6.2026, July 28, 2026), SHA-256 of the source PDF and its page count. Check the hash before overlaying boxes on a PDF. |
| `pages[]` | Every PDF page. `id` is unique: a multi-page code gets `"PROS-F 2 of 5"`. Also the printed `code` and `part`, 1-based `pdf_page`, `kind` (algorithm, principles, footnotes, discussion, ...), running `title`, `heading`, `size` [w, h] in PDF points, `content_band` [top, bottom], full `text`, `tables` (Markdown) and `footnotes`. |
| `nodes[]` | Every box. `id` is `PAGE:n<y>_<x>`; table cells are `PAGE:t<table>_<row>_<col>`. Each node has `text`, `lines`, `bbox` and `line_bboxes` (PDF points, origin top-left) and `bbox_matches_pdf` (code found the box's text at that position in the PDF: 243/244). |
| `nodes[].role` | Structural role: `entry`, `decision`, `step`, `leaf`, `page_heading`, `column_header`, `note`, `link`, or a table role (`table_root`, `table_condition`, `table_rec`, `table_ref`, `table_value`, `table_title`). |
| `nodes[].decision_type` | `condition` (describes the patient), `option` (one of several treatment choices) or `other`. |
| `nodes[].predicate`, `predicate_status` | The condition over `schema`, and its status. Statuses are `model_reviewed`, `inherited_from_link`, `section_only`, `rejected` and `none`; see "What the condition statuses mean" below. |
| `nodes[].received_predicate` | For an option, the condition meaning "the patient already received this option", e.g. `definitive_treatment_received == "radical_prostatectomy"`. |
| `nodes[].footnotes[]` | `{mark, page, text, resolved_by}`. `page` is the page that defines the letter. `resolved_by` is `own_page`, `printed_pointer` (the page prints "Footnotes on PROS-7A"), `footnote_page` or `nearest_same_prefix`. |
| `nodes[].links[]` | `{type, code, part, page, pdf_page}` with `type` `page`, `discussion` or `external_guideline` (with the other guideline's `slug`). Links are taken from the box text as well, so bare "PROS-3" cells have them. |
| `edges[]` | Arrows with `evidence`: `two_methods` (vector and vision extraction agree), `image_checked`, `table_text_checked` (table rows whose cells were matched word by word against the page text) or `single_source`. |
| `continuations[]`, `entries[]` | Leaf → entry boxes of the page it links to; all entry boxes. |
| `schema` | Patient-fact schema. Variables carry `time` (`current`, `at_diagnosis`, `history`). Derived variables carry `criteria_source`, and judgement variables carry `judgment` and `criteria`. |
| `quality` | Counts for completeness and checking. `clinician_validated` is false. |

### What the condition statuses mean
- **model_reviewed:** drafted by Haiku and accepted by a second Haiku review. No clinician has reviewed it.
- **inherited_from_link:** an entry box with no condition of its own takes the conditions of the boxes on other pages that link to it (`reached_from`). PROS-13, 14 and 15 work this way.
- **section_only:** the box only requires the patient to be in the page's guideline section (multi-disease guidelines).
- **rejected:** the review rejected the draft (`review_note` says why). The box needs clinician judgement.
- **none:** no condition. Mostly options and workup lists.

### Changes since the front-end review
- **PROS-2** is an explicit chain: risk group → criteria → subgroup → subgroup criteria → evaluation → next page. The duplicate loose boxes are gone, and "Intermediate" is one shared node.
- **Rejected conditions:** 15 → 4. Rejected drafts were redrafted with the reviewer's reason and re-reviewed. The remaining 4 are on PROS-11, 12, 14 and 18.
- **Treatment options:** boxes such as RP and RT on PROS-3 are typed `option` and carry `received_predicate`.
- **Entry boxes:** 24 of 25 now have a condition (own, inherited or section).
- **Arrows:** no single-source arrows remain on prostate pages.

## Older intermediate files (snapshots, not updated)

The files below are earlier snapshots of the intermediate files `guideline.json` is built from. They predate the structured tables, the extra vision and image-check rounds and the condition repair. Read everything from `guideline.json`; these are kept only for provenance.

| File | Contents |
|---|---|
| `e1_graphs.json`, `e2/`, `review/` | Vector extraction, vision extraction, image-check verdicts on disputed arrows |
| `merged_graphs.json` | Consensus graph per page, with structured tables merged in |
| `tables_v2/` | Column-structured table extraction (cells verbatim, checked against the page text) |
| `pages.json`, `chunks_full.json`, `footnotes.json` | Full page store, retrieval chunks, footnotes per page code |
| `fact_schema.json`, `fact_schema_v1.json` | Current schema and the round-1 schema it extends (nothing removed) |
| `predicates.json`, `predicates_status.json`, `node_types.json`, `received_predicates.json` | Raw conditions (no section or inheritance applied), review status, decision types, option conditions |
| `llm/` | Raw model inputs and outputs. **Do not read conditions from here**: drafts in `pred_out_*` include ones the review rejected |
| `gold/`, `medguide/`, `redflags.json` | Hand-made reference graphs (by Claude, not clinicians), MedGUIDE outputs, vision cross-check flags |
| `archive/`, `runs/`, `vignettes/`, `e4/`, `viz/`, `chunks.json`, `chunks_all.json` | Superseded or historical |
