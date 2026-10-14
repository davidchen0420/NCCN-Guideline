# All-guidelines survey: does the pipeline generalize?

**Date:** 2026-10-14
**Scope:** all 91 NCCN guideline PDFs, run through the local, no-LLM stage of the pipeline (`python -m nccn_nav.survey private`). This stage covers layout detection, vector graph extraction (E1), footnotes, full text and red flags.
**Cost:** about $0.40 of Haiku to download the PDFs; the survey itself is local and free.
**Content:** numbers only, no guideline text.
**Follow-up:** the full Haiku encoding of all 91 guidelines is reported in [All guidelines encoding.md](All%20guidelines%20encoding.md).

## Answer in brief
- **What generalizes:** the local stage runs on every guideline with no per-guideline code or settings. All 91 PDFs processed without errors.
- **Totals:** 1,473 algorithm pages, 18,577 boxes and 12,514 arrows.
- **Graph coverage:** on algorithm pages, a mean of 0.96 of each page's words end up in the graph (boxes plus footnotes).
- **Benchmarks:** gold-page edge F1 is unchanged on all 7 benchmarked guidelines (prostate 0.98, NSCLC 0.98, SCLC 0.92, colon 0.96, rectal 0.85, breast 1.00, AML 0.94).
- **What does not generalize yet:** about 15 guidelines (group C below) are mostly lists and tables rather than arrows.
  - The extractor captures their text, but not their decision logic.
  - They need a table-to-decision encoder.
- **Vision step:** the Haiku image step (E2) is generic but has only been run on 8 guidelines.
- **Not validated:** MedGUIDE vignettes exist for only a few cancers. No clinician has validated any encoding.

## Layout assumptions removed in this round
Each item below was a hidden assumption that held for prostate and lung but failed elsewhere. Each was found by the survey and fixed with a general rule.

| Problem found | Affected | Fix |
|---|---|---|
| Fixed header/footer coordinates (85/555/560/575 pt) | all | The header rule and the footer line are detected on each page (`layout.page_bands`); other limits are page-relative |
| Page codes with non-breaking hyphens, slashes, underscores, prefixes over 6 letters, or split across text spans (THYR‑1, WM/LPL-1, ICI_DERM-3A, EXTSARC-1) | thyroid 5→46 algorithm pages, ICI toxicity 5→46, soft tissue sarcoma 5→23, Waldenström 1→4; 1–7 missing pages recovered in 30 others (e.g. COL-6, NSCL-11, REC-8, BINV-10) | General page-code pattern, read per line, hyphens normalized |
| Pages with no arrows lost all text below the title to the footnote parser | list and prose pages (e.g. PREV-1 coverage 0.07→1.00) | A page without connectors has no flow bottom |
| Footnote letters printed as plain text ("e Advanced…"), four-letter markers ("bbbb"), or columns not split at the page midline | prostate 134→142 footnotes, rectal 113→148, breast 195→251, and many others; previously merged or dropped | Plain markers accepted only in letter order and at a hanging indent; columns found from marker positions |
| Unit converter knew only prostate/lung/colon units | every non-GU/thoracic guideline | Added cell counts, g/dL, mg/dL, mL/min, Gy, kg, kg/m², pack-years, days/hours, U/mL, pg/mL; analyte-specific conversions are never guessed |
| Prostate-only scripts, cancer names in the coverage check, a prostate ID quirk in MedGUIDE | — | Removed; MedGUIDE IDs are `<tree>:<row>` everywhere |

## Guideline groups (from the survey metrics)
- **A. Flowchart (30 guidelines):** fewer than 20% orphan boxes and few arrows left unattached. E1 alone should be close to the gold-page quality seen for prostate/NSCLC.
- **B. Mixed (46):** flowcharts plus more orphan boxes or unattached arrows. This is the group where the E2 image check and edge review already used for NSCLC, colon, breast and AML apply. Those four sit here and reach 0.94–1.00 gold edge F1 after review.
- **C. List or table-style (15):** at least 25% of algorithm pages have no arrows, or more than half of the boxes are orphans.
  - **Members:** AYA, antiemesis, CML, cutaneous lymphomas, both genetic/familial risk guidelines, Hodgkin, HIV, CAR-T toxicity, MDS, older adult, infections, prostate early detection, fatigue, survivorship.
  - **Category mix:** mostly supportive care, specific populations and screening guidelines.
  - **What breaks:** their decisions sit in tables ("if X then regimen Y"). The graph keeps the text (coverage ≥0.97) but not the conditions.
  - **What's needed:** a table-to-decision encoder, the remaining piece of pipeline work.

## How to read the columns
- **Labelled %:** share of pages with a bottom-right page code (unlabelled pages are mostly the cover, panel list, update pages and "Continued" pages).
- **Flagged %:** algorithm pages with any red flag, which go to the Haiku image check.
- **Orphan %:** boxes with no arrow in or out. High values mean list or table layout, or missed arrows.
- **Graph coverage:** share of an algorithm page's words (in its content band, superscripts removed) that appear in the extracted boxes and footnotes.
- **Group:** A, B or C as defined above.

## Per-guideline results
| Guideline | Pages | Labelled % | Algorithm pages | Boxes | Arrows | Unattached | Flagged % | No-arrow pages | Orphan % | Graph coverage (mean / min) | Group |
|---|---|---|---|---|---|---|---|---|---|---|---|
| acute_lymphoblastic_leukemia | 170 | 95 | 8 | 75 | 72 | 2 | 25 | 1 | 9 | 0.99 / 0.97 | A |
| adolescent_and_young_adult_aya_oncology | 113 | 91 | 12 | 164 | 21 | 0 | 58 | 4 | 80 | 1.00 / 0.99 | C |
| adult_pain | 128 | 92 | 7 | 109 | 62 | 0 | 57 | 1 | 38 | 1.00 / 1.00 | B |
| aml | 213 | 35 | 23 | 282 | 179 | 2 | 43 | 3 | 35 | 1.00 / 0.97 | B |
| ampullary_adenocarcinoma | 81 | 93 | 7 | 63 | 61 | 2 | 29 | 0 | 0 | 1.00 / 1.00 | A |
| anal_carcinoma | 69 | 91 | 4 | 62 | 53 | 1 | 75 | 0 | 10 | 1.00 / 1.00 | A |
| antiemesis | 111 | 89 | 31 | 355 | 69 | 2 | 77 | 17 | 77 | 1.00 / 1.00 | C |
| appendiceal_neoplasms_and | 76 | 95 | 9 | 107 | 94 | 2 | 44 | 0 | 7 | 1.00 / 1.00 | A |
| associated_venous_thromboembolic_disease | 147 | 97 | 13 | 200 | 106 | 6 | 62 | 3 | 38 | 1.00 / 0.97 | B |
| b_cell_lymphomas | 369 | 96 | 54 | 646 | 582 | 19 | 56 | 0 | 9 | 1.00 / 1.00 | B |
| basal_cell_skin | 59 | 92 | 6 | 66 | 38 | 11 | 67 | 1 | 35 | 1.00 / 0.98 | B |
| biliary_tract | 108 | 94 | 8 | 89 | 63 | 0 | 62 | 0 | 25 | 0.99 / 0.96 | B |
| bladder | 142 | 95 | 19 | 260 | 201 | 2 | 53 | 2 | 21 | 0.99 / 0.81 | B |
| bone | 129 | 97 | 19 | 200 | 174 | 0 | 37 | 1 | 6 | 1.00 / 1.00 | A |
| breast | 278 | 96 | 37 | 444 | 337 | 3 | 51 | 2 | 22 | 0.99 / 0.95 | B |
| breast_risk_reduction | 63 | 92 | 8 | 67 | 51 | 2 | 38 | 0 | 3 | 1.00 / 1.00 | A |
| breast_screening_and_diagnosis | 100 | 94 | 18 | 274 | 247 | 8 | 44 | 0 | 6 | 0.99 / 0.96 | B |
| castleman_disease | 35 | 86 | 5 | 48 | 47 | 3 | 40 | 0 | 2 | 1.00 / 1.00 | B |
| central_nervous_system | 246 | 89 | 45 | 504 | 458 | 9 | 36 | 0 | 7 | 0.99 / 0.73 | A |
| cervical | 138 | 93 | 14 | 194 | 183 | 7 | 36 | 0 | 2 | 1.00 / 0.99 | B |
| chronic_lymphocytic_leukemia_small_lymphocytic_l | 118 | 93 | 9 | 108 | 81 | 3 | 67 | 0 | 23 | 0.95 / 0.58 | B |
| chronic_myeloid_leukemia | 118 | 95 | 6 | 101 | 39 | 1 | 67 | 2 | 58 | 0.99 / 0.98 | C |
| colon | 249 | 97 | 16 | 202 | 166 | 5 | 44 | 0 | 14 | 1.00 / 1.00 | B |
| colorectal_screening | 106 | 92 | 17 | 172 | 138 | 2 | 41 | 0 | 8 | 0.94 / 0.54 | A |
| cutaneous_lymphomas | 148 | 96 | 30 | 451 | 207 | 12 | 87 | 11 | 55 | 1.00 / 0.97 | C |
| dermatofibrosarcoma_protuberans | 23 | 78 | 3 | 19 | 17 | 1 | 33 | 0 | 0 | 1.00 / 1.00 | B |
| distress_management | 85 | 94 | 26 | 290 | 212 | 2 | 38 | 3 | 23 | 0.98 / 0.91 | B |
| esophageal_and_esophagogastric_junction | 172 | 95 | 21 | 268 | 234 | 2 | 24 | 0 | 6 | 1.00 / 0.99 | A |
| gastric | 140 | 94 | 10 | 119 | 105 | 1 | 10 | 0 | 5 | 1.00 / 1.00 | A |
| gastrointestinal_stromal_tumors | 54 | 91 | 5 | 61 | 53 | 0 | 40 | 0 | 10 | 1.00 / 1.00 | A |
| genetic_familial_high_risk_assessment_breast_ova | 178 | 94 | 16 | 276 | 35 | 0 | 94 | 10 | 85 | 1.00 / 0.97 | C |
| genetic_familial_high_risk_assessment_colorectal | 213 | 93 | 46 | 758 | 78 | 0 | 83 | 36 | 88 | 0.99 / 0.92 | C |
| gestational_trophoblastic_neoplasia | 56 | 89 | 7 | 83 | 65 | 5 | 71 | 0 | 12 | 1.00 / 1.00 | B |
| hairy_cell_leukemia | 34 | 88 | 2 | 20 | 16 | 1 | 100 | 0 | 10 | 1.00 / 1.00 | B |
| head_and_neck | 276 | 96 | 57 | 921 | 904 | 31 | 65 | 1 | 8 | 1.00 / 1.00 | B |
| hematopoietic_cell_transplantation | 114 | 93 | 8 | 78 | 43 | 1 | 75 | 1 | 35 | 1.00 / 1.00 | B |
| hematopoietic_growth_factors | 105 | 94 | 15 | 189 | 88 | 1 | 60 | 3 | 45 | 0.99 / 0.90 | B |
| hepatocellular_carcinoma | 115 | 95 | 6 | 43 | 39 | 0 | 0 | 0 | 0 | 1.00 / 1.00 | A |
| histiocytic_neoplasms | 95 | 91 | 16 | 116 | 112 | 0 | 12 | 0 | 4 | 1.00 / 1.00 | A |
| hodgkin_lymphoma | 124 | 94 | 17 | 304 | 137 | 6 | 88 | 7 | 57 | 0.96 / 0.73 | C |
| in_people_with_hiv | 66 | 92 | 5 | 133 | 6 | 0 | 100 | 4 | 94 | 1.00 / 1.00 | C |
| kaposi_sarcoma | 52 | 88 | 5 | 65 | 44 | 2 | 100 | 1 | 32 | 0.98 / 0.91 | B |
| kidney | 100 | 86 | 5 | 69 | 58 | 1 | 60 | 0 | 6 | 1.00 / 1.00 | A |
| lung_screening | 90 | 94 | 11 | 195 | 196 | 6 | 18 | 0 | 2 | 0.99 / 0.88 | B |
| management_of_car_t_cell_and_lymphocyte_engager | 54 | 89 | 17 | 223 | 32 | 0 | 82 | 12 | 83 | 1.00 / 0.99 | C |
| management_of_immune_checkpoint_inhibitor_relate | 139 | 91 | 46 | 488 | 290 | 0 | 22 | 5 | 31 | 1.00 / 0.98 | B |
| melanoma_cutaneous | 260 | 85 | 17 | 232 | 147 | 8 | 53 | 3 | 32 | 0.99 / 0.97 | B |
| melanoma_uveal | 96 | 92 | 6 | 68 | 47 | 2 | 50 | 0 | 28 | 1.00 / 0.99 | B |
| merkel_cell_carcinoma | 72 | 92 | 6 | 66 | 64 | 3 | 67 | 0 | 2 | 1.00 / 1.00 | B |
| mesothelioma_peritoneal | 42 | 90 | 2 | 22 | 21 | 0 | 0 | 0 | 0 | 1.00 / 1.00 | A |
| mesothelioma_pleural | 58 | 93 | 3 | 37 | 34 | 1 | 33 | 0 | 0 | 1.00 / 1.00 | B |
| multiple_myeloma | 141 | 94 | 15 | 124 | 69 | 3 | 47 | 2 | 35 | 0.99 / 0.96 | B |
| myelodysplastic_syndromes | 123 | 96 | 8 | 152 | 94 | 3 | 62 | 2 | 33 | 1.00 / 0.98 | C |
| myeloid_lymphoid_neoplasms_with_eosinophilia_and | 51 | 92 | 11 | 172 | 84 | 6 | 91 | 2 | 44 | 1.00 / 1.00 | B |
| myeloproliferative_neoplasms | 125 | 95 | 9 | 93 | 73 | 6 | 56 | 0 | 8 | 1.00 / 1.00 | B |
| neuroblastoma | 93 | 95 | 12 | 195 | 95 | 3 | 67 | 2 | 46 | 0.99 / 0.86 | B |
| neuroendocrine_and_adrenal_tumors | 237 | 88 | 35 | 356 | 275 | 3 | 43 | 3 | 18 | 1.00 / 0.97 | A |
| nsclc | 302 | 94 | 43 | 682 | 604 | 13 | 56 | 2 | 8 | 0.99 / 0.97 | B |
| occult_primary | 86 | 93 | 15 | 173 | 159 | 0 | 20 | 1 | 3 | 1.00 / 1.00 | A |
| older_adult_oncology | 109 | 94 | 10 | 124 | 31 | 4 | 90 | 5 | 68 | 1.00 / 1.00 | C |
| ovarian_cancer_fallopian_tube_cancer_primary_per | 130 | 95 | 23 | 285 | 269 | 6 | 43 | 0 | 5 | 1.00 / 1.00 | A |
| palliative_care | 117 | 93 | 34 | 397 | 223 | 2 | 74 | 4 | 34 | 1.00 / 0.98 | B |
| pancreatic_adenocarcinoma | 171 | 95 | 12 | 139 | 122 | 0 | 17 | 0 | 4 | 0.99 / 0.98 | A |
| pediatric_acute_lymphoblastic_leukemia | 172 | 94 | 11 | 139 | 110 | 0 | 18 | 0 | 14 | 0.99 / 0.97 | A |
| pediatric_aggressive_mature_b_cell_lymphomas | 90 | 94 | 17 | 187 | 112 | 1 | 71 | 2 | 27 | 0.98 / 0.64 | B |
| pediatric_central_nervous_system | 89 | 89 | 8 | 69 | 64 | 2 | 38 | 0 | 7 | 1.00 / 1.00 | A |
| pediatric_hodgkin_lymphoma | 86 | 91 | 10 | 241 | 123 | 3 | 100 | 1 | 49 | 1.00 / 1.00 | B |
| pediatric_soft_tissue_sarcoma | 51 | 92 | 15 | 152 | 142 | 3 | 20 | 1 | 6 | 1.00 / 1.00 | A |
| penile | 59 | 93 | 10 | 140 | 129 | 5 | 40 | 0 | 5 | 1.00 / 1.00 | B |
| prevention_and_treatment_of_related_infections | 179 | 97 | 26 | 312 | 117 | 2 | 73 | 11 | 54 | 1.00 / 0.99 | C |
| prostate | 222 | 95 | 18 | 282 | 220 | 3 | 28 | 2 | 17 | 1.00 / 0.98 | A |
| prostate_early_detection | 81 | 94 | 4 | 37 | 29 | 0 | 75 | 1 | 11 | 1.00 / 1.00 | C |
| rectal | 166 | 95 | 18 | 248 | 173 | 3 | 56 | 1 | 22 | 1.00 / 0.99 | B |
| related_fatigue | 73 | 95 | 8 | 66 | 25 | 0 | 88 | 2 | 56 | 1.00 / 1.00 | C |
| sclc | 93 | 95 | 8 | 88 | 85 | 4 | 38 | 0 | 2 | 1.00 / 0.99 | B |
| small_bowel_adenocarcinoma | 68 | 91 | 8 | 83 | 76 | 0 | 38 | 0 | 2 | 0.90 / 0.57 | A |
| smoking_cessation | 93 | 88 | 6 | 59 | 41 | 3 | 67 | 0 | 19 | 1.00 / 1.00 | B |
| soft_tissue_sarcoma | 144 | 95 | 23 | 207 | 188 | 4 | 43 | 0 | 3 | 0.99 / 0.88 | A |
| squamous_cell_skin | 103 | 93 | 11 | 162 | 121 | 4 | 45 | 1 | 31 | 1.00 / 0.98 | B |
| survivorship | 329 | 93 | 74 | 781 | 216 | 8 | 69 | 29 | 67 | 1.00 / 0.95 | C |
| systemic_light_chain_amyloidosis | 42 | 90 | 4 | 56 | 35 | 0 | 25 | 0 | 29 | 0.98 / 0.92 | B |
| systemic_mastocytosis | 82 | 94 | 9 | 102 | 83 | 0 | 44 | 0 | 14 | 1.00 / 0.97 | A |
| t_cell_lymphomas | 209 | 95 | 28 | 314 | 203 | 8 | 64 | 3 | 30 | 1.00 / 0.98 | B |
| testicular | 95 | 94 | 19 | 263 | 235 | 4 | 68 | 0 | 9 | 1.00 / 1.00 | A |
| thymomas_and_thymic_carcinomas | 56 | 91 | 4 | 57 | 53 | 0 | 25 | 0 | 5 | 1.00 / 1.00 | A |
| thyroid_carcinoma | 159 | 94 | 46 | 465 | 387 | 21 | 39 | 0 | 5 | 1.00 / 0.96 | B |
| uterine_neoplasms | 151 | 94 | 20 | 296 | 241 | 8 | 65 | 0 | 17 | 1.00 / 0.99 | B |
| vaginal | 67 | 91 | 6 | 41 | 38 | 1 | 17 | 0 | 0 | 1.00 / 1.00 | A |
| vulvar | 88 | 94 | 13 | 133 | 124 | 9 | 38 | 0 | 2 | 1.00 / 0.98 | B |
| waldenstrom_macroglobulinemia_lymphoplasmacytic | 40 | 90 | 4 | 31 | 26 | 0 | 75 | 0 | 13 | 1.00 / 0.99 | A |
| wilms_tumor_nephroblastoma | 90 | 93 | 15 | 288 | 214 | 2 | 67 | 3 | 23 | 1.00 / 1.00 | B |
## Next steps for full coverage
1. **E2 and consensus on groups A and B.** Run the Haiku image check on flagged pages plus a 20% audit sample, as already done for 8 guidelines. Then generate fact schemas and predicates. Estimated Haiku cost is $0.10–0.30 per guideline, about $15–25 for all.
2. **Gold pages.** Hand-check 1–2 gold pages for a sample of new guidelines (one per group, plus heme and pediatric) to measure accuracy rather than assume it.
3. **Table-to-decision encoder for group C.** Its input is the page's ruled tables and list items. Its output is predicate-labelled rows, built with the same fact-schema and predicate machinery.
