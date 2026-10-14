# All-guidelines encoding: results

**Date:** 2026-10-14
**Scope:** all 91 NCCN guideline PDFs, fully encoded. Each one has a canonical file at `data/<slug>/guideline.json`, listed in `data/index.json`; the format is described in `data/README.md` and `data/prostate/README.md`.
**Cost:** about $13 of Haiku (111M agent tokens) over all rounds, by the estimated ledger. The local steps cost nothing.
**Content:** numbers only.

## What each guideline file contains
- Every PDF page: unique ids for multi-page codes, size, content band, title, section, full text, tables and footnotes.
- Every flowchart and table box, with position and structural role.
- Arrows with their evidence.
- Conditions over a patient-fact schema, with their review status.
- Typed decision boxes (condition, option, other).
- Footnotes resolved to the page that defines them.
- Page, discussion and cross-guideline links.
- The PDF version and hash.
- Quality counts.

## Totals (91 guidelines)
| | Count |
|---|---|
| PDF pages | 11,189 |
| Algorithm pages | 1,473 |
| Boxes | 14,873 |
| Boxes whose text code found at their stored position in the PDF | 14,672 (98.6%) |
| Versions read from the cover | 91 / 91 |

## Arrows (15,400)
| Evidence | Count |
|---|---|
| Two methods agree (vector extraction and Haiku vision) | 11,359 |
| Image-checked by Haiku after a disagreement | 1,729 |
| Table rows (cells matched word by word to the page text) | 2,205 |
| Single source (image check "unsure") | 107 |

**What changed in this round:**
- **Vision on every page.** Haiku vision now covers every algorithm page with two or more boxes. Before, it covered only red-flagged pages.
- **Single-source arrows:** this cut them from 4,741 to 107.

**Gold pages:** 30 hand-made pages across 23 guidelines.
- Final-graph edge F1 is **0.965**, against 0.967 before this round; vector extraction alone scores 0.933.
- **Lowest pages:** REC-5 0.72, ME-10 0.83 and SUPRA-5 0.84.
  - ME-10 fell from 1.00. The new vision pass added two arrows there that the image check accepted.

## Tables (232 pages)
- **Structured format:** table pages are re-extracted with ordered cells per row under typed columns (condition, recommendation, reference, note).
- **Pathway tables** become chains. A cell spanning several rows becomes one shared node. For example, PROS-2 is now risk group → criteria → subgroup → subgroup criteria → evaluation → next page.
- **Lookup grids** become row → "column: value" nodes. For example, the CML-3 milestone grid is now captured.
- **Validation:** every cell must be found word by word in the page text. Unmatched cells are dropped.
- **Loose duplicates removed:** the flowchart extractor had read the same grid as loose boxes; those boxes are removed.

## Conditions (8,588 decision boxes)
| Status | Count |
|---|---|
| Model-reviewed (Haiku draft accepted by a Haiku review) | 6,468 |
| Inherited from the boxes that link to an entry page | 182 |
| Section only (multi-disease guidelines) | 66 |
| Rejected by the review (needs clinician judgement) | 113 |
| None (mostly options and workup lists) | 1,759 |

**Decision types:**
- 7,084 conditions;
- 763 treatment options (with "already received" conditions where the schema allows);
- 700 other.

**What changed in this round:**
- **Disease sections:** 29 multi-disease guidelines get a `guideline_section` variable. Entry boxes require the page's section.
- **Fact schemas extended additively for all 91:**
  - a time of each fact (current, at diagnosis, history);
  - treatment-history variables;
  - lumped findings split into raw findings;
  - the source of each classification's criteria;
  - criteria for judgement variables.
  - Nothing was removed; the guard restored 0 dropped names. 22 guidelines have 1–5 open schema warnings.
- **Repair pass:** the 2,954 boxes without a usable condition went through a typed pass that saw:
  - the page heading;
  - the section;
  - the footnotes;
  - any rejected draft, with the reviewer's reason.
- **Review of the new conditions:** of the 1,119 new conditions and option conditions, Haiku review accepted about 90%.

**Entry boxes:** 1,718 of 1,922 have a condition (their own, inherited or section).

## Footnote references (12,310)
| Resolved by | Count |
|---|---|
| The box's own page | 9,080 |
| The page named by a printed "Footnotes on X" pointer | 2,114 |
| The page's footnote page (`<code>A`) | 477 |
| Nearest page of the same prefix | 381 |
| Unresolved | 258 |

## Links
- 4,357 page links. Multi-page targets resolve to e.g. "PROS-F 2 of 5".
- 401 links to other NCCN guidelines, resolved to their slug.
- 6 Discussion links.

## MedGUIDE held-out test (engine = deterministic walk over the conditions; abstains when undecided)
| Guideline | n | Haiku alone (A0) | Engine (correct / answered) | Engine + Haiku fallback | Before this round |
|---|---|---|---|---|---|
| Prostate | 75 | 0.73 | 60/60 | **0.96** | 0.96 |
| NSCLC | 122 | 0.90 | 39/39 | **0.90** | 0.90 |
| Colon | 80 | 0.60 | 36/43 | **0.65** | 0.75 |
| AML | 8 | 1.00 | 0/0 | 1.00 | 1.00 |
| Bone | 17 | 0.76 | 0/0 | 0.76 | 0.76 |

**Colon regressed by 10 points.** Two new entry conditions on COL-11 ("previous FOLFOX/CAPEOX…") encode only prior chemotherapy, not the metastatic setting of the page. They therefore match cases that belong elsewhere.
- Nulling those two restores 0.75.
- Requiring every entry to also meet the condition of the boxes that link to it was tried and lowered accuracy further. MedGUIDE cases often start on a later page with earlier facts no longer true.
- The link condition is therefore stored in the bundle for display (`link_condition`), and the engine does not use it.

**AML and bone remain unanswered by the engine.**
- The section clause now identifies their disease (all AML items are APL, all bone items Ewing sarcoma).
- But the case facts do not settle the next branches.

## Known gaps
- **Not validated by clinicians:** no condition, schema or graph has been reviewed by a clinician. "Reviewed" means reviewed by a second Haiku pass.
- **Remaining uncertainty:**
  - 107 single-source arrows;
  - 113 rejected conditions;
  - 258 unresolved footnote letters;
  - 41 decision boxes the typed pass skipped;
  - 201 boxes not found at their stored position.
- **Benchmark coverage:**
  - MedGUIDE covers 5 of the 91 guidelines usefully.
  - Thyroid, CNS, esophageal and pancreatic items do not map onto the current guideline versions.
- **Earlier problems still open:**
  - Prose reference notes on a few pages are still boxes.
  - Discussion links only resolve to the first Discussion page.
