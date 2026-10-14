# Processed NCCN guidelines: one canonical file per guideline

- `index.json` lists all 91 guidelines: slug, title, category, version and date, the SHA-256 of the source PDF, the path to the bundle and its quality counts.
- `<slug>/guideline.json` is the canonical, self-contained representation of one guideline, built by `python -m nccn_nav.bundle private/<slug>` and copied here by `python -m nccn_nav.publish private data`.
- The source PDFs are not included. Check `pdf_sha256` before overlaying boxes on a PDF.

`data/prostate/README.md` documents the format field by field (pages, nodes, roles, decision types, conditions and their status, footnotes with source pages, links, edge evidence, schema, quality). Every guideline uses the same format.

## How the data was made, and how far to trust it
| Field | How it was made | Checks |
|---|---|---|
| Boxes, positions | Vector extraction from the PDF | `bbox_matches_pdf`: code found the box's text at its position (98.6% of all boxes) |
| Arrows | Vector extraction and Haiku vision on every algorithm page | Disputes image-checked by Haiku. `evidence` gives the basis per arrow; 107 of 15,400 remain `single_source` (verdict "unsure") |
| Tables | Haiku copies cells verbatim | Every cell is matched word by word against the page text; unmatched cells are dropped |
| Conditions | Haiku-drafted over a Haiku-drafted fact schema, then Haiku-reviewed | `predicate_status` |
| Footnotes and links | Code | `resolved_by` per footnote; link `type` |

No clinician has validated any of it (`quality.clinician_validated` is false).

## What the condition statuses mean
- **model_reviewed:** drafted by Haiku and accepted by a second Haiku review.
- **section_only:** the box only requires the patient to be in the page's guideline section.
- **inherited_from_link:** an entry box with no condition of its own takes the conditions of the boxes that link to it.
- **rejected:** the review rejected the draft (`review_note`). The box needs clinician judgement.
- **none:** no condition, mostly options and workup lists.
