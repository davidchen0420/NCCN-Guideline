# Prostate navigator: smoke-test results (NCCN Prostate v6.2026)

These are small checks that each strategy runs end to end. They are **not** the benchmark in `plans/Prostate NCCN navigator plan.md`, for three reasons:
- Every reference label was written by Claude, not by clinicians.
- n is tiny: 4 pages and 8 synthetic cases.
- All LLM work used Haiku, with one run per arm.

Licensed content and everything derived from it (graphs, footnotes, text chunks, cases, labels, model outputs) is kept in the gitignored `private/` folder. Code is in `src/nccn_nav/`.

## What was built (prototype level)

| Component | Module | Status |
|---|---|---|
| **E1:** reads boxes, arrows and brackets from the PDF's vector drawing layer (PyMuPDF), plus superscript footnote markers | `pdfvec.py` | Runs on all 18 flow pages. Clean on PROS-3 to 11; leaves orphan boxes on table-style pages (PROS-2, PROS-18) and some boxes on PROS-12 to 17. Recovered the text of 61 of the ~69 footnotes. |
| **E2:** Haiku reads each rendered page image and outputs nodes and edges | Haiku agents | Run on 4 pages |
| **E4:** cross-check of E1 against E2; agreed edges are kept, the rest go to a human review list | `consensus.py` | Run on 4 pages |
| **Text layer:** the PROS-A to N principles pages and the Discussion (MS-1 to 72), chunked by paragraph with reference lists removed, searched with BM25 | `textlayer.py`, `search.py` | 291 chunks |
| **Navigator (A4):** the program moves through the graph; the LLM picks one child box at each step, seeing that node's footnotes and related text | `navigator.py` | Works, including the PROS-3 → PROS-9 handoff |
| **Predicates (A5):** branch conditions written as JSON rules over a patient-fact schema, evaluated by code | `predicates.py` | Haiku drafted 23 conditions for PROS-3 and PROS-9; 22 kept after review (1 wrong one removed) |
| **Scorers:** node and edge precision/recall/F1; path overlap (Jaccard) and final-box match, as CancerGUIDE scores them | `scoring.py`, `bench_*.py` | — |

E3 (the hybrid with vision-model repair) and R2 (CQL export) were not tested.

## Encoding fidelity (4 pages, edges hand-checked)

| Page (number of arrows) | E1 vector | E2 Haiku vision | E4 consensus |
|---|---|---|---|
| PROS-3 (17) | 1.00 | 1.00 | 1.00 |
| PROS-7 (23) | 0.93 | 1.00 | 0.95 |
| PROS-9 (16) | 1.00 | 1.00 | 1.00 |
| PROS-13 (6) | 1.00 | 1.00 | 1.00 |
| **Mean edge F1** | **0.98** | **1.00** | **0.99** |

- **E1's errors on PROS-7** are a nested option box that it merged into one, and the arrows attached to it. E4 flagged them for human review.
- **Box text accuracy** against the reference: E1 0.93–0.97, E2 0.94–1.00. E1 copies the PDF text exactly but drops some footnote letters; E2 rewrites the text slightly.
- **Comparison with published work** (Guideline2Graph, v4.2024, edge P/R 69.0/87.5) is not like-for-like: different guideline version, different reference graph, and only 4 easy-to-moderate pages here.

## Traversal (8 synthetic vignettes covering PROS-3 and PROS-9)

| Arm | Final step correct | Mean path Jaccard |
|---|---|---|
| A0 Haiku, no guideline | 7/8 | n/a |
| A2 Haiku + BM25 search | 8/8 | n/a |
| A4 Haiku walking the graph | 8/8 | 0.96 |
| A5 predicates + facts extracted by Haiku | 5/8 | 0.74 |
| A5 predicates + correct facts (checks the engine only) | 8/8 | 1.00 |

- **A0's miss (V2):** it recommended active surveillance where the guideline gives observation, because life expectancy was under 10 years.
- **A5's three misses all came from fact extraction**, not from the graph or the predicates. Haiku got 23 of 26 reference facts right but added 10 facts that weren't in the reference:
  - V3: life expectancy given as ">20 y" was left out (it's a range, not a number), so the engine stopped at the first branch.
  - V2: initial management wasn't stated, so the engine stopped at the therapy choice.
  - V5: a PSA recurrence was coded as "progression = true", which wrongly moved the patient past Observation.
- **How A0 and A2 were graded:** their free-text answers were graded by Claude against the reference final box.

## What this tells us (direction only, not evidence)

1. Both extraction routes work on typical NCCN flow pages. Cross-checking E1 against E2 (E4) is cheap and caught E1's errors. Pages that are really tables (PROS-2, PROS-18) need a separate table parser.
2. These 8 cases are too easy to separate the arms: Haiku with search scored 8/8. The real benchmark needs harder cases, as the plan says:
   - edge thresholds;
   - missing data;
   - ones that depend on footnote definitions;
   - multi-page paths (PROS-10 and beyond);
   - clinician labels.
3. Only A4 and A5 produce a checkable path through the guideline (path Jaccard plus node citations). A0 and A2 have to be graded by hand.
4. A5 is only as good as fact extraction. Before A5 can beat A4 it needs:
   - clear fact definitions in the schema ("progression" vs "recurrence", temporal state);
   - support for ranges such as ">20 y";
   - a fallback: when a fact is missing, hand the branch to the LLM (A4) instead of stopping.

## Reproduce

All of these need the PDF at `private/pdf/prostate.pdf`; scoring uses no LLM.

```
cd src
python -m nccn_nav.bench_encoding ../private
NAV_PAGES=PROS-3,PROS-9 python -m nccn_nav.bench_traversal ../private
```

---

# Update: audit fixes and MedGUIDE prostate benchmark

## Fixes found by the audit (in code, no LLM cost)

Checking E1's graph against the MedGUIDE tree for PROS-16 turned up three extraction bugs:
1. All-caps condition boxes inside the flow (e.g. "PSADT >10 mo") were classed as column headers and dropped. Now only all-caps text *above* the flow counts as a header.
2. Arrows that leave a shared closing bracket (two boxes feeding one arrow) were attributed to only one box. They now come from every box inside the bracket.
3. Arrows entering a box from above or below were not attached to it.

E1 now recovers all 15 arrows on PROS-16, and the 4 reference pages score the same as before.

Two engine (navigator) changes:
- **Continue past a recommendation box** when the case's facts settle a branch shortly after it. The case is describing what happened next.
- **When a branch can't be decided but its arms rejoin**, jump to where they rejoin and record the skipped step (e.g. PSADT is missing, but both PSADT branches lead to the same assessment box).

The 8 earlier test cases still reach the correct final step with the correct facts.

## MedGUIDE prostate (HF `MedGUIDE/MedGUIDE-MCQA-8K`, `prostate_14`)

- 166 three-option questions, all built from the NCCN M0 CRPC tree (PROS-16 in v6.2026; MedGUIDE used an older version). The three options are the tree's three end boxes, always in the same order. Chance is 0.333.
- The dataset declares no license, so it is stored only in `private/`.

| Arm (all Haiku) | Items | Accuracy |
|---|---|---|
| A0: no guideline | 166 | **0.645** |
| A5: Haiku extracts 3 facts, code walks PROS-16 | 166 | **0.873** (abstained on 3, coverage 0.98) |
| A5 + A0 fallback when the engine abstains | 166 | **0.873** |
| A0, on a random 30-question subset | 30 | 0.733 |
| A2: BM25 search, same subset | 30 | 0.733 |
| A5 + A0, same subset | 30 | 0.867 |

The best published MedGUIDE result is 0.644, but that is GPT-4.1 averaged over all 17 cancers. It is context, not a like-for-like comparison.

**Error analysis:**
- **A0** mostly confused "maintain" with "change" treatment (45 of its 59 errors): it doesn't apply the PSADT and progression branch logic consistently.
- **A5's 21 errors:**
  - 13 are labelled "M1 workup", and the engine answered something else.
  - In the 3 such profiles inspected, the text says imaging shows *no* distant metastases. These look like **label noise in MedGUIDE**: its profiles are LLM-generated from the tree path and sometimes contradict it. The engine's answer follows the stated facts.
- **Caveat:** a clinician should adjudicate those items before reporting MedGUIDE numbers. Corrected labels would raise A5's score and lower A0's on those items.

## Audit: where each strategy stands

| Strategy | Evidence so far | Main gap |
|---|---|---|
| E1 vector extraction | 0.98 arrow F1 on 4 pages; PROS-16 fixed | Table pages (PROS-2, PROS-18); geometry rules keep needing case-by-case fixes |
| E2 Haiku vision | 1.00 on 4 pages | Only 4 pages; one run each; no variance |
| E4 cross-check | 0.99; flagged E1's error | Needs E2 on every page |
| A2 retrieval only | No better than A0 on MedGUIDE (0.733 vs 0.733, n=30) | Flattened flowchart text loses the branch structure |
| A4 LLM walks graph | 8/8 on easy test cases | Not yet run on MedGUIDE (costly per item) |
| A5 facts + engine | 0.873 on MedGUIDE vs 0.645 for A0 | Quality of fact extraction and fact definitions; predicates cover only PROS-3, 9 and 16 so far |

**Recommended architecture (unchanged, now with better support):** E1 + E2 cross-check for encoding; then A5 with an LLM fallback for walking the graph:
- facts extracted once per patient;
- the engine decides every branch it can;
- the LLM decides only the rest;
- every answer comes with a path through the guideline.

To reproduce: `cd src && NAV_PAGES=PROS-16 python -m nccn_nav.bench_medguide ../private`.

---

# Update 2: whole-guideline encoding, and do OCR/layout models help?

## What is encoded now (all 222 pages of v6.2026)

| Layer | Content | Module | Output (private/) |
|---|---|---|---|
| Decision graphs | All 18 flow pages (PROS-1 to 18): E1 vector extraction merged with E2 Haiku vision; every arrow labelled by which method found it | `pdfvec.py`, `consensus.merge_all` | `merged_graphs.json` |
| Footnotes | 64 of ~69 algorithm footnotes, linked to the boxes that cite them | `pdfvec.py` | `footnotes.json` |
| Branch conditions | 140 conditions across all 18 pages, over a patient-fact schema of 30 facts. 28 reviewed (PROS-3, 9, 16); 112 are unreviewed Haiku drafts | `predicates.py` | `predicates.json`, `predicates_status.json` |
| Full text | Every page in reading order: update log, algorithm, footnote pages, principles PROS-A to N, staging, Discussion MS-1 to 72. Reference lists are tagged but left out of search | `fulltext.py` | `pages.json`, `chunks_full.json` (544 chunks) |
| Tables | 13 line-ruled tables kept as Markdown grids (PROS-2 risk groups, PROS-18 therapy lines, principles tables) | `fulltext.py` | in `pages.json` |

**Graph merge, all 18 pages:** 255 arrows. 204 (80%) were found by both extractors. The other 51 are kept but flagged for human review:
- 41 found only by vision, mostly on the table-like pages PROS-2 and PROS-18, where E1 finds no arrows;
- 10 found only by vector extraction.

**Branch-condition check (no LLM):** random patient facts were tested against 43 branch points. At 5 of them more than one branch can be true at once; these go to review. The engine only auto-decides when exactly one branch is true, so overlapping branches go to the LLM rather than being chosen silently.

**Coverage check** (`coverage.py`): share of each page's words that appear in the encoding.
- Principles pages: 0.90–0.94. Discussion: 0.92. Staging: 0.88. Footnote pages: 0.86–0.93.
- Flow pages: 0.71–0.92. Most of the gap is the per-page header and footer boilerplate, which is deliberately excluded.

**Regression:** the 8 vignettes still score 8/8 with the correct facts, and MedGUIDE is unchanged at 0.873 on the merged graph.

## Do OCR or layout models help?

**OCR is not needed for this PDF.** It is born-digital: every word is in the text layer, exactly. OCR would only add recognition errors. What matters is structure (arrows, boxes, tables, reading order), not reading characters.

**Layout and table models were tested.** Docling's open-source layout and table-structure model (MIT licence, run locally on CPU; about 25 s for 4 pages, no Claude credit) was compared with PyMuPDF's free table finders (`compare_tables.py`). Values are the share of page words recovered inside extracted tables:

| Page | PyMuPDF (ruled lines) | PyMuPDF (text alignment) | Docling |
|---|---|---|---|
| PROS-2 (risk groups) | 0.96 | 0.67 | 0.96 |
| PROS-18 (therapy lines) | 0.75 | 0.72 | 0.62 |
| ST-1 (staging, no ruled lines) | 0.00 | 0.69 | 0.00 |
| PROS-H table | 0.77 | 0.67 | 0.78 |

Docling matched PyMuPDF and added nothing. Neither recovers the unruled staging tables as tables, though their text is fully captured in the page store.

**Where image-based models do help** is the flowchart arrows. Haiku vision (E2) scored 1.00 arrow F1 on the 4 reference pages and supplied the arrows for the table-like pages. Use it as a cross-check against the vector extraction, not on its own.

## What would still improve performance

1. **Human review:** the 51 flagged arrows and the 112 unreviewed branch conditions. This is the biggest remaining quality lever, and it is human time, not credits.
2. **MedGUIDE:** most of the remaining A5 errors look like dataset label noise. Adjudicate before reporting.
3. **Retrieval:** BM25 sometimes misses definitions. A local medical embedding model such as MedCPT, now installable since PyTorch came with Docling, would give hybrid search with no Claude cost.
4. **Staging tables:** a Haiku vision pass over the 2 ST pages would rebuild them as structured grids.

---

# Update 3: suggested fixes applied, then MedGUIDE re-tested

## Fixes

Items 1 and 3 were LLM review by Haiku, not clinician review.

1. **Flagged arrows (51).**
   - Haiku compared each against the page image: 43 confirmed, 6 rejected and removed, 2 unsure and left flagged.
   - The merged graph now has 249 arrows: 204 found by both extractors and 43 confirmed by the image check.
2. **Unreviewed branch conditions (112).**
   - Haiku audited each against its box text: 101 OK, 3 fixed (e.g. a missing "or positive DRE" alternative), 8 removed (treatment or referral boxes, not conditions).
   - 132 conditions remain.
3. **Staging tables.** Haiku vision rebuilt the unruled ST-1 and ST-2 pages as 6 Markdown tables (the T, N, M, prognostic-group and Grade Group tables). The page store now has 19 tables and 550 search chunks.
4. **Hybrid retrieval.**
   - MedCPT query and article encoders, run locally on CPU, are fused with BM25 by reciprocal rank fusion (`NAV_DENSE=1`).
   - Example: for "definition of high-volume metastatic disease", hybrid search returns the defining footnote first (PROS-15A ccc: CHAARTED criteria); BM25 alone did not.
5. **MedGUIDE label check.**
   - Haiku checked each question's label against its patient description: 144 consistent, 20 contradicting, 2 unclear.
   - In most contradictions the label says M1, but the description says imaging showed no distant metastases.

**Regression after all fixes:** the 8 vignettes still get 8/8 with the correct facts.

## MedGUIDE prostate results

All arms use Haiku. "Clean labels" means the 144 items whose label is consistent with the case text.

| Arm | All 166 | Clean labels (144) |
|---|---|---|
| A0: no guideline | 0.645 | 0.708 |
| A5: fact extraction + graph engine, A0 as fallback | **0.873** | **0.986** |

Same random 30-question subset (25 of them have clean labels):

| Arm | All 30 | Clean 25 |
|---|---|---|
| A0: no guideline | 0.733 | — |
| A2: BM25 search | 0.733 | 0.760 |
| A2: hybrid BM25 + MedCPT search | 0.633 | 0.720 |
| A5 + A0 fallback | 0.867 | 1.000 |

## What this shows

- **Explicit branch logic beats better retrieval on this task.**
  - The graph engine (A5) scored 0.87 on all 166 items and 0.99 on the 144 clean ones.
  - Better retrieval did not help the search-only arm: hybrid scored 0.63 vs 0.73 for BM25 on 30 items, a gap within single-run noise. The search agent itself reported that the flattened PROS-16 flowchart text was hard to read.
  - Hybrid search remains useful for definitions and footnotes, as the high-volume example shows.
- **Caveat on the clean-label numbers:** the label check and A5's fact extraction were both done by Haiku reading the same descriptions, so they may agree for shared reasons. That could inflate the 0.986. Report both numbers, and have a clinician adjudicate the 22 flagged items before publishing.
- **Remaining limits:**
  - MedGUIDE prostate covers only one tree (PROS-16).
  - One run per arm.
  - All reviews so far are by an LLM, not a clinician.

---

# Benchmark policy: validated items only

From now on, benchmark numbers are computed **only on validated items**. `bench_medguide.py` now scores just the MedGUIDE items whose label passed the consistency check against the case text: 144 of 166. The 22 items whose label contradicts the case, or is unclear, are excluded. The script refuses to run without the label-check files.

| Arm (validated MedGUIDE items) | n | Accuracy |
|---|---|---|
| A0: no guideline | 144 | 0.708 |
| A5: fact extraction + graph engine, A0 fallback | 144 | **0.986** (engine abstained on 1) |
| A0, on the 30-question subset | 25 | 0.760 |
| A2: BM25 search, 30-question subset | 25 | 0.760 |
| A2: hybrid BM25 + MedCPT, 30-question subset | 25 | 0.720 |
| A5 + A0, 30-question subset | 25 | 1.000 |

What "validated" means here, and what is not counted:
- **The labels were validated by an LLM (Haiku), not a clinician.** The same model family also extracted A5's facts, so that check may favour A5. Clinician adjudication of the 22 excluded items, and of a sample of the included ones, is still needed before external reporting.
- **The 8 synthetic vignettes and the 4 hand-checked encoding pages** were labelled by Claude and never independently validated. They stay as smoke tests only and are **not** benchmark results.
- **The search arm (A2)** has only 25 validated items, too few to compare it reliably with A0 or A5. Running it on all 144 would cost about 2–3 more Haiku agent runs.
