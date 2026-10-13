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
