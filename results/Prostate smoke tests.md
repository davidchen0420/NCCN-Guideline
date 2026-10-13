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
