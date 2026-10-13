# Gold standards, benchmarks and reusable tools for an NCCN Prostate decision-graph LLM benchmark

Compiled 2026-10-13. Every item below was checked against a primary source: arXiv full text, PubMed abstract via NCBI E-utilities, PMC, GitHub raw files and commit Atom feeds, PyPI, npm, or the Hugging Face API.
Status tags:
- **[V]** verified from a primary source.
- **[P]** partially verified. The source was reachable but a detail was missing or behind a paywall.
- **[U]** unverified.

`api.github.com` and direct `github.com` HTML were blocked through the session proxy. Licenses therefore come from `raw.githubusercontent.com` LICENSE files, and "last commit" dates come from `github.com/<repo>/commits/<branch>.atom` fetched with WebFetch.

---

## A. Gold standards and benchmarks relevant to prostate

### A1. Guideline2Graph (arXiv 2604.02477, v1, 2 Apr 2026). Preprint, not peer-reviewed. [V]
- **Authors and affiliations:** Kilic, Gurbuz, Yaldiz, Nawar, Haxholli, Can, Waxman. Affiliations are Georgia Tech, MetaDialog and Infuse Inc.
- **What it is:** a decomposition-first pipeline that turns a guideline PDF into an executable decision graph. The steps are topology-aware chunking, interface-constrained chunk graph generation, and provenance-preserving global aggregation. All methods share "the same underlying VLM backbone", which is **not named**.
- **Guideline:** NCCN Prostate Cancer **v4.2024** (ref 18).
- **Reference graph:** described only as "manually curated and adjudicated by human reviewers". The paper gives **no** annotator count, expertise, adjudication protocol or inter-annotator agreement.
  - The complete reference graph is small: **32 nodes and 56 edges**, inferred from the S/T counts.
  - It is evaluated as 5 chunk graphs (G1 to G5) plus the merged "Complete" graph. The page ranges of G1 to G5 are not stated.
- **Matching rule:** "supported" predictions over total predictions. The paper does **not** specify how a predicted node is matched to the gold one (human, string match or LLM). This gap matters if we reuse the metric.
- **Baselines:** Doc2KG and AutoKG.
- **Results, Complete graph (P/R %, with S/T counts):**

| Method | Node P | Node R | Edge P | Edge R | Triplet P | Triplet R |
|---|---|---|---|---|---|---|
| Doc2KG | 27.5 (14/51) | 43.8 (14/32) | 1.1 (1/88) | 1.8 (1/56) | 1.1 | 1.8 |
| AutoKG | 56.8 (25/44) | 78.1 (25/32) | 19.6 (9/46) | 16.1 (9/56) | 19.6 | 16.1 |
| Ours | 57.7 (30/52) | 93.8 (30/32) | 69.0 (49/71) | 87.5 (49/56) | 69.0 | 87.5 |

- **Per-chunk results for "Ours" (Node P/R, Edge P/R, Triplet P/R):**
  - G1: 80/80, 100/75, 100/75
  - G2: 83.3/100, 73.3/84.6, 66.7/76.9
  - G3: 75/90, 100/100, 92.9/92.9
  - G4: 53.3/100, 66.7/83.3, 40/50
  - G5: 55/100, 50/92.3, 45.8/84.6
- **Release:** no code, reference graph or data release is mentioned. A web search for "Guideline2Graph" code found nothing. **Treat it as not available.**
- **Limitations the authors state:** a single guideline, and limited availability of adjudicated ground truth.

### A2. Chen S, …, Bitterman DS. "Use of Artificial Intelligence Chatbots for Cancer Treatment Information." JAMA Oncol 2023 (published online 2023-08-24). Peer-reviewed. [V/P]
- **Identifiers:** DOI 10.1001/jamaoncol.2023.2954, PMID 37615976, PMC10450584. Open access under **CC-BY**.
- **Design:** 26 diagnosis descriptions × 4 prompt templates = 104 prompts, run on GPT-3.5-turbo-0301. Outputs were scored against the **2021 NCCN** guidelines; the version numbers per cancer are not given.
- **Rubric:** five scoring questions, reproduced in Table 1:
  1. Number of recommendations.
  2. Number concordant with 2021 NCCN.
  3. Number fully correct, if only some were concordant.
  4. Number hallucinated.
  5. Number of hallucinated items that appear in the current NCCN.
- **Raters:** 3 of 4 board-certified oncologists, majority rule, with tie-break by the oncologist who had not seen the output. All three agreed on 322/520 scores (61.9%).
- **Overall results:** at least one concordant recommendation in 102/104 (98%). 35/102 (34.3%) included a non-concordant recommendation. 13 (12.5%) contained hallucinations.
- **Prostate (n = 32 prompts, Table 1):**
  - At least 1 recommendation: 29 (90.6%).
  - All concordant: 19 (59.4%). Some concordant: 12 (37.5%). Not applicable: 1.
  - At least 1 fully correct: 11 (34.4%).
  - At least 1 hallucinated: 6 (18.8%).
- **Supplement:** Supplement 1 contains eMethods and the eFigure "Experimental Design", which the text says covers the prompt templates. Supplement 2 is the Data Sharing Statement.
  - The 4 templates are printed in Table 2 of the main text.
  - **I could not open the supplement PDFs** (PMC, medRxiv and JAMA all returned 403 or HTML through the proxy), so whether the 26 diagnosis strings, the raw outputs or the annotation guideline are included is **[U]**.
  - No GitHub release was found.
  - The medRxiv preprint is 10.1101/2023.03.16.23287316.

### A2b. Tsai CY et al. "ChatGPT v4 outperforming v3.5 on cancer treatment recommendations…" Digital Health 2024;10. Peer-reviewed. [V]
- **Identifiers:** DOI 10.1177/20552076241269538, PMC11325467.
- **Design:** 108 prompts covering prostate, kidney and bladder cancer, built on the Chen et al. templates. Three urologists rated the outputs. NCCN 2021 was used as the reference "to match GPT-3.5's cutoff".
- **Prostate results:** GPT-4 had 76.8% NCCN alignment versus 49.1% for GPT-3.5, and a rater-approved recommendation ratio of 96.1% versus 89.4%.
- **Data release:** this is the **most reusable public prompt set with prostate content**.
  - Supplementary files S1 to S7 contain the 108 query prompts (S6) and the rater scores (S7).
  - The 32-prompt prostate pilot is in S4 (responses) and S5 (scores).
  - License is CC BY-NC-ND 4.0.

### A3. MedGUIDE (arXiv 2505.11613, v1, 16 May 2025). Preprint; I did not verify a venue. [V]
- **Construction:** 55 NCCN decision trees across 17 cancers, prostate included. LLM-generated patient profiles produce multiple-choice "next step" questions. Samples were filtered on 10 criteria using reward models and an LLM-judge ensemble, leaving 7,747 samples.
  - The NCCN version is **not stated**; NCCN was accessed 2023-05-10.
- **Metrics:** accuracy and difficulty-weighted accuracy, with weight 1 − 1/#options. Best model was GPT-4.1 (acc 0.6439, weighted 0.6254). The paper evaluates 25 LLMs.
- **Dataset:** https://huggingface.co/datasets/MedGUIDE/MedGUIDE-MCQA-8K. It is public and ungated, 7,747 rows in a single train split.
  - **No license is declared** on the dataset card.
  - Fields: `disease`, `path` (the gold tree path), `profile`, `options`, `answer`, `generation_model`, and others.
- **Prostate content (checked with the HF datasets-server statistics):**
  - The released data has 53 tree IDs (the paper says 55).
  - **Only one prostate tree (`prostate_14`) appears, with 166 samples (2.1%).**
- **Code:** https://anonymous.4open.science/r/Submission-MedGUIDE-187A (anonymous link, no license).

### A4. CPGPrompt (arXiv 2601.03475, v1, 7 Jan 2026). Preprint. [V]
- **Authors:** Deng, …, Weng, Wang, Rousseau, Peng (Cornell, Columbia, Pitt and UTSW group).
- **Prostate guideline:** **neither NCCN nor NICE.** It is Young et al. 2015, "Guideline for referral of patients with suspected prostate cancer by family physicians and other primary care providers", *Can Fam Physician*. It is a primary-care referral guideline, not a treatment algorithm.
- **Vignettes:** synthetic, generated by an LLM from the tree.
  - Prostate: 96 total (27 single-criteria, 64 contrastive, 5 exclusion).
  - Three clinicians quality-reviewed 10 vignettes per domain.
- **Evaluation:** GPT-4o at temperature 0.2, 5 runs.
- **Prostate metrics:**
  - Binary referral: P/R/F1 = 1.00.
  - Multi-class pathway: P 0.84±0.06, R 0.80±0.04, macro-F1 0.77±0.04.
  - By category (macro-F1): single 0.76, contrastive 0.73, exclusion 1.00 (n = 5).
- **Code and data:** https://github.com/bionlplab/CPGPrompt, **MIT** license.
  - `prostate_cancer/` contains `text_prostrate_cancer_guideline.txt`, `text2tree_pc.py`, `traverse_tree_pc.py`, the decision-tree JSONs, `vignettes_data_pc.csv`, and `vignettes_with_diagnosis_pc(_test).csv`.
  - The repo has 2 commits, both on 2025-11-01, so it is a frozen snapshot.
  - It is reusable as a pipeline pattern (text → tree → per-node LLM traversal). It is **not** an NCCN gold standard.

### A5. CancerGUIDE (arXiv 2509.07325). [V]
- **Venue:** published at **ML4H 2025** (PMLR vol. 297; proceedings.mlr.press/v297/unell26a). A NeurIPS 2025 virtual listing also exists. Treat it as peer-reviewed at ML4H.
- **Prostate component:** none. It covers only **NSCLC**, NCCN NSCLC v1.2025.
- **Data:** 121 real de-identified NSCLC cases with trajectories annotated by 13 oncologists.
- **Reusable methodology:**
  - Each trajectory is an ordered list of NCCN page-node IDs (e.g., `NSCL-1-1 → NSCL-2-1 → …`).
  - **Path Overlap** is a Jaccard score over node sets; it ignores order.
  - **Treatment Match** is an exact match on the terminal treatment.
  - Scoring is deterministic, with no LLM judge.
  - Proxy benchmarks use synthetic notes (GPT-4.1/GPT-5) and self- or cross-model consistency pseudo-labels. These correlate with expert labels at Spearman r = 0.88 (RMSE 0.08).
  - A meta-classifier for verification reaches AUROC 0.804.
  - Example results: o3 scored 0.477 path overlap and 0.364 treatment match.
- **Code:** https://github.com/microsoft/CancerGUIDE (aka.ms/CancerGUIDE), **MIT**, last commit 2026-08-05.
  - **The expert annotations are not licensed for public release.** The repo includes code and synthetic benchmark generation.

### A6. Other prostate LLM-vs-guideline/MDT concordance studies (2023 to 2026)
All are peer-reviewed unless noted, and abstracts were verified through PubMed E-utilities.
**None released its case-level data publicly** as far as the abstracts show. "On request" or no statement is the norm.

| Study | Design / n | Reference standard | Key result | Case availability |
|---|---|---|---|---|
| Kaiser P et al., *World J Urol* 2025;43:67 (doi 10.1007/s00345-024-05423-1) | 171 consecutive newly diagnosed PCa (real); GPT-4 and Claude-3-Opus with structured data and **EAU pocket guidelines** | Actual MDT recommendation | 93% adherence for both LLMs; 15 discrepancies (9%), mostly missing info; 5 (3%) non-EAU-concordant | Not public [P] |
| Koc A et al., *Int Urol Nephrol* 2026;58:4131 (doi 10.1007/s11255-026-05178-1) | 48 consecutive PCa tumor-board cases (real, retrospective); 5 LLMs | MDT decision; 4 urologists, 5-pt Likert | Perplexity and GPT-4o median 4.75; Copilot 3.00; ICC 0.82 | Not public |
| Huang C et al., *Sci Rep* 2026 (doi 10.1038/s41598-026-61013-8) | 480 real PCa cases (120 each: localized, post-treatment, mHSPC, mCRPC); DeepSeek-V3.2 vs ChatGPT-5.2, Chinese and English | Central MDT consensus plan; 3 blinded clinicians, 5 domains | Composite 4.40 vs 4.25 (Chinese), 4.20 vs 4.33 (English); lowest in mCRPC | Not stated |
| Chen Y et al., *Eur J Cancer* 2026;238:116667 (doi 10.1016/j.ejca.2026.116667) | 238 real mPCa cases, 3 centers; 5 LLMs | MDT safety gate, then 3 oncologists rating guideline concordance (Likert) | Safety pass 79.0–84.9%; about 15–21% unsafe | Not stated |
| Rinderknecht E et al., CONCORDIA, *Eur Urol Oncol* 2026;9:589 (doi 10.1016/j.euo.2025.11.016; DRKS00034797) | 110 **synthetic** locally advanced or metastatic GU scenarios (PCa share not in abstract); GPT-4 and Claude 3.5 Sonnet | MTB; modified System Causability Scale | MTB 0.849; Claude 0.731; GPT-4 0.660; both failed non-inferiority | Not stated |
| Lombardo R et al., UroMDT Advisor, *Int Urol Nephrol* 2026 (doi 10.1007/s11255-026-05389-6) | 180 real cases, 8 centers, 123 (68.3%) prostate; ChatGPT-based tool aligned with EAU, ESMO and NCCN | Final MDT decision | Exact agreement 66.7%, κ 0.482 vs final MDT | Protocol on request |
| De la Torre-Trillo J et al., *Clin Transl Oncol* 2026 (doi 10.1007/s12094-026-04548-6) | Prospective; 106 urological MTB discussions (92 patients); GPT-4o | MTB; 7 raters | Recommendation concordance 79.2% (95% CI 70.6–85.9); 3.8% potentially harmful errors | Not stated |
| De la Torre-Trillo J et al., *J Clin Med* 2026;15:2130 (PMC13027246) | 98 real urologic MTB cases; GPT-4o | MTB | Full agreement 56.1%; κ 0.61; worst in metastatic PCa | Open access; data statement not checked |
| Gabriel A et al., *Cureus* 2026 (doi 10.7759/cureus.103457) | 40 PCa **brachytherapy** MDM patients; custom GPT with RAG over local Royal Surrey guidelines | Real MDM | 40/40 concordant | Says "custom GPT available on GitHub" (URL not checked) [P] |
| Ivashchuk O et al., *Front Oncol* 2026 (doi 10.3389/fonc.2026.1785951) | Prospective, 728 cases across 8 tumor groups, including prostate; **NCCN used for all groups** | MTB; outcomes are times and plan-change rates | No prostate-specific concordance in abstract | Not stated |
| Tung JYM et al., *JMIR* 2025;27:e78393 | 44 fictional PSA-screening scenarios; RAG over EAU and AUA | Guideline answer | RAG-LLM 95.5% vs juniors 62.3% (closed book) and 74.1% (open book) | Open access; scenarios possibly in supplement [U] |
| Lombardo R et al., *Prostate Cancer Prostatic Dis* 2025;28:229 (doi 10.1038/s41391-024-00789-0) | 195 questions from **EAU 2023** PCa recommendations; ChatGPT | 2 urologists, 4-point scale | 26% completely correct; 24% incorrect | Not public |
| Li R et al., *Ann Surg Oncol* 2026;33:1858 | 98 PCa multiple-choice questions plus 3 real cases | Exam keys and urologists | DeepSeek-R1 96.6% MCQ accuracy | MCQs from MedQA and MedMCQA |
| Ayub U et al. (Mayo), ASCO 2025 poster 5108 (**abstract, not peer-reviewed**) | GPT-4 extraction plus rule-based **NCCN risk** stratification; multi-agent treatment recommendation; about 858 Mayo patients per a secondary summary | Expert-annotated | A "94% full accuracy" figure appears in a secondary review; **not verified** against the abstract | Not public [U] |
| Ferber D et al., *Nature Cancer* 2025;6:1337 (doi 10.1038/s43018-025-00991-6) | 20 simulated GI cases (no prostate); GPT-4 agent with tools and RAG | Expert review | 91.0% correct statements (223/245); 87.2% completeness vs 30.3% for GPT-4 alone; 75.5% citations accurate; tool use 87.5% | Code: github.com/Dyke-F/LLM_RAG_Agent, **MIT** (LICENSE.txt, © 2024 Dyke Ferber), last commit 2026-09-05; tasks in Supplementary Notes |

**Implication for our benchmark:** no publicly downloadable, expert-labelled set of prostate cases mapped to NCCN nodes exists.
- Closest public assets are Tsai 2024 (prompts and scores, NCCN 2021, CC BY-NC-ND), MedGUIDE `prostate_14` (166 MCQs, no license), and CPGPrompt (non-NCCN referral).
- Most MDT studies benchmark against EAU, not NCCN.

Related non-prostate work with reusable methods:
- Xu, Dumontier & Sun, SeWebMeDa-2025 (CEUR Vol-4001 paper 3, CC BY 4.0): NCCN ALL v1.2024 converted to a graph linked to an ontology, scored on guideline adherence, completeness, path alignment and relevancy. Code at https://github.com/MaastrichtU-IDS/guideline_graph_chatbot (license not checked).
- Sheng et al., arXiv 2608.28592 (ODBB, Jun 2026): 1,586 NCCN items plus 419 colorectal cases, a deterministic 14-class failure taxonomy, no prostate content, no code link.

### A7. IIT Madras / HTIC NCCN parsing (Ta, Gupta, Ram, Sivaprakasam). [V]
- **Ta P et al., "Automated Knowledge Modeling for Cancer Clinical Practice Guidelines"** (arXiv 2307.10231). Accepted to **IEEE EMBC 2023**.
  - Covers NSCLC only (v1.2022 and another version).
  - Uses **Apache PDFBox 2.0.25** to read PDF objects, including the directed-arrow vector graphics, and outputs **JSON-LD**.
  - Enrichment with UMLS/NCIt and staging. SVM node classification accuracy 0.81 (10-fold).
- **Ta P et al., "Knowledge Models for Cancer CPGs: Construction, Management and Usage in QA"** (arXiv 2407.21053). Accepted to **IEEE EMBC 2024**. **This one has prostate results.**
  - Manual evaluation of extraction (Table I), by guideline:

| Guideline | Version | Nodes | Node formation errors | Connection errors | Node formation accuracy |
|---|---|---|---|---|---|
| **Prostate** | **v1.2023** | 276 | 3 | 10 | 98.9% |
| Breast | v4.2022 | 680 | 3 | 15 | 99.5% |
| Ovarian | v1.2023 | 459 | 12 | 13 | 97.4% |
| NSCLC | v3.2022 | 914 | 7 | 6 | 99.2% |

  - Also does version diffing using a node hash and edit-distance score: 40 or below means added/removed, 95 or above means same.
  - QA covers NSCLC only: 54.5% from the algorithm section and 81.8% from the discussion section. Uses BGE, FAISS, rank_bm25 and RRF with Llama-2-70B.
  - **Released:** only the QA pairs, at https://github.com/pralaypati/cancer_treatment_qa (**Apache-2.0**, 2 commits, folders `cancer.gov/` and `cancer.net/`).
  - **The extraction code and the prostate graph are not released.**
- **Gupta B et al., "Comprehensive Modeling and QA of Cancer CPGs using LLMs"** (arXiv 2501.13984, Jan 2025). Related IEEE CIBCB 2024 DOI 10.1109/CIBCB58642.2024.10702112.
  - Covers NSCLC v2.2024 and uses Neo4j 4.4.5.
  - LLM node classification: 80.86% zero-shot and 88.47% few-shot.
  - Text-to-Cypher QA: 73.9% on query set A and 61.1% on set B.
  - No prostate results and no code.

### Licensing caveat (NCCN content) [U]
A third-party copy of the NCCN EULA (tostracker.app) says NCCN content may not be used as input to developing, **testing** or training AI without written agreement. nccn.org returned 403, so **verify on nccn.org before publishing any benchmark that embeds NCCN text or graphs.** This may explain why no group has released an NCCN-derived reference graph.

---

## B. Open-source tools
Latest release and last commit are as of 2026-10-13 (PyPI or npm release date; GitHub Atom feed for commits).

### PDF vector and layout parsing
| Tool | Repo | License | Status | Relevance |
|---|---|---|---|---|
| PyMuPDF | github.com/pymupdf/PyMuPDF | **AGPL-3.0** or commercial (Artifex) | 1.28.2, 2026-08-06 | `Page.get_drawings()` returns vector paths (lines, curves, rects, fill), which is the best route to arrows and connectors in NCCN PDFs. AGPL matters if we distribute or serve it. |
| pdfplumber | github.com/jsvine/pdfplumber | MIT | 0.11.10, 2026-06-15 | Exposes `.lines`, `.curves`, `.rects`, `.chars` with coordinates; permissive license, so a viable connector-extraction alternative |
| pdfminer.six | github.com/pdfminer/pdfminer.six | MIT | 20260107 | `LTLine`, `LTCurve`, `LTRect` layout objects; the backend of pdfplumber |
| pypdfium2 | github.com/pypdfium2-team/pypdfium2 | BSD-3 / Apache-2.0 | 5.14.0, 2026-10-04 | Rendering and text; page-object access for paths |
| Apache PDFBox (Java) | pdfbox.apache.org | Apache-2.0 | (not checked) | Used by the IIT Madras pipeline for arrow and edge extraction |
| Docling | github.com/docling-project/docling | MIT | 2.138.0, 2026-10-12 | Layout, tables and reading order; **does not reconstruct flowchart edges** (my understanding; not verified for vector arrows) |
| Marker | github.com/datalab-to/marker | Code **Apache-2.0**; **weights modified AI Pubs Open RAIL-M** (free for research and for orgs under $5M) | 2.0.0, 2026-07-20 | PDF to Markdown; no edge extraction |
| MinerU | github.com/opendatalab/MinerU | "MinerU Open Source License" = Apache-2.0 plus terms (commercial license above 100M MAU or $20M monthly revenue; attribution for online services). Old `magic-pdf` package was AGPL-3.0. | 4.0.12, 2026-10-11 | Layout and tables |
| GROBID | github.com/kermitt2/grobid | Apache-2.0 | last commit 2026-10-11 | Built for scholarly articles (header, refs). Low relevance to NCCN algorithm pages; possibly useful for the Discussion section. |
| camelot-py | github.com/camelot-dev/camelot | MIT | 2.0.0, 2026-06-04 | Table extraction (e.g., the PSMA, risk-group and systemic-therapy tables) |

No turnkey open tool that converts vector-PDF arrows into graph edges was found. The IIT Madras PDFBox heuristics and Guideline2Graph are both unreleased. Plan on custom code over `get_drawings()` or pdfplumber curves.

### Flowchart-to-graph
- **TextFlow / "Vision Textualizer"** (Ye et al., NAACL 2025, arXiv 2412.16420): github.com/JunyiYe/TextFlow, **MIT**, last commit 2025-08-23. A VLM converts the image to Mermaid, Graphviz or PlantUML, then a reasoner works on the text. This is raster-based.
- **FlowVQA** (Singh et al., arXiv 2406.19237; venue believed ACL Findings 2024, not verified): github.com/flowvqa/flowvqa, **MIT**, last commit 2024-03-26 (stale). 2,272 flowcharts and 22,413 QA pairs with Mermaid ground truth.
- **FlowLearn** (Pan et al., ECAI 2024, arXiv 2407.05183): code at github.com/Jo-Pan/FlowLearn has **no LICENSE file**, last commit 2024-09-25. Data at huggingface.co/datasets/jopan/FlowLearn is **CC-BY-NC-SA-4.0** (3,858 scientific and 10,000 simulated flowcharts, with Mermaid).
- **Arrow detectors:**
  - Arrow R-CNN (Schäfer et al., IJDAR 2021): Faster R-CNN plus arrow keypoints, for handwritten diagrams.
  - arXiv 2401.03742 extends it with a Detectron2 model.
  - DrawnNet (Entropy 2022).
  - **No official code repo was verified for any of these [U].** All are raster methods.

### Graph storage and traversal / agent frameworks
| Tool | License | Status |
|---|---|---|
| NetworkX (github.com/networkx/networkx) | BSD-3 | 3.7, 2026-09-21 |
| Neo4j Community (github.com/neo4j/neo4j) | **GPL-3.0** (server); Python driver Apache-2.0 | driver 6.4.0, 2026-10-05; branch 2026.09 |
| JSON-LD 1.1 (W3C Rec) / pyld (github.com/digitalbazaar/pyld) | BSD-3 | 3.3.0, 2026-09-02 |
| LangGraph (github.com/langchain-ai/langgraph) | MIT | 1.2.15, 2026-10-12 |
| DSPy (github.com/stanfordnlp/dspy) | MIT | 3.4.1, 2026-10-12 |
| Microsoft GraphRAG (github.com/microsoft/graphrag) | MIT | 3.3.0, 2026-10-08 |
| LightRAG (github.com/HKUDS/LightRAG) | MIT | 1.5.7, 2026-09-02 |
| HippoRAG (github.com/OSU-NLP-Group/HippoRAG) | MIT | PyPI 2.0.0a4 (2025-06); repo last commit 2026-10-06 |

### Guideline execution standards
| Standard or tool | License | Status |
|---|---|---|
| HL7 CQL reference tooling (github.com/cqframework/clinical_quality_language) | Apache-2.0 | last commit 2026-10-08 |
| cql-execution, JavaScript (github.com/cqframework/cql-execution) | Apache-2.0 | npm 3.3.2 (2026-06-03); last commit 2026-10-09 |
| cql-exec-fhir | Apache-2.0 | npm 2.2.0 (2026-09-19) |
| CQF Clinical Reasoning on FHIR for Java (github.com/cqframework/clinical-reasoning) | Apache-2.0 | Provides CQL and Measure evaluation for HAPI. PlanDefinition `$apply` support **not confirmed from the README [P]**. |
| cqf-tooling | Apache-2.0 | (not checked) |
| HL7 FHIR Clinical Practice Guidelines IG (hl7.org/fhir/uv/cpg) | (not checked) | 2.0.0 (STU2), 2024-11-26. Defines the PlanDefinition and ActivityDefinition patterns for computable guidelines. |
| CDS Hooks (cds-hooks.hl7.org; github.com/cds-hooks/docs and /sandbox) | Apache-2.0 | Spec 2.0.1 (2025-03-12); 3.0.0-ballot (2025-12-15) |
| **MITRE/ASCO Camino** (github.com/mcode/pathways) | Apache-2.0 (© MITRE 2020) | SMART on FHIR app; CQL-defined pathways over mCODE. **Inactive: last commit 2022-01-03.** No prostate pathway seen in the README. |
| mCODE IG (hl7.org/fhir/us/mcode) | (not checked) | STU4 = 4.0.0 (2025-02-16). Has a Gleason grade group value set and example `Observation-gleason-grade-group-4`. |

### RAG and retrieval evaluation
| Tool | License | Status |
|---|---|---|
| RAGAS (github.com/vibrantlabsai/ragas, formerly explodinggradients) | Apache-2.0 | 0.4.3, 2026-01-13; last commit 2026-02-24 (slowing) |
| rank_bm25 | Apache-2.0 | 0.2.2 (2022); last commit 2024-10 (stale but stable) |
| pyserini | Apache-2.0 | 2.4.0, 2026-08-27 |
| ColBERT (stanford-futuredata) | MIT | colbert-ai 0.2.22 (2025-08); last commit 2025-10-14 |
| RAGatouille | Apache-2.0 | 0.0.9.post2 (2025-05; stale) |
| MedCPT (github.com/ncbi/MedCPT) | US Gov public domain | Repo last commit 2024-03-24. HF models `ncbi/MedCPT-{Query,Article,Cross}-Encoder` are marked license "other", updated 2023-12. |

### LLM evaluation harnesses
| Tool | License | Status |
|---|---|---|
| inspect_ai (github.com/UKGovernmentBEIS/inspect_ai) | MIT | 0.3.279, 2026-10-13; very active |
| promptfoo (github.com/promptfoo/promptfoo) | MIT | npm 0.124.1, 2026-10-08. README: "Promptfoo is now part of OpenAI" and remains MIT. |
| lm-evaluation-harness (EleutherAI) | MIT | 0.4.13, 2026-08-31 |
| Ferber et al. agent (github.com/Dyke-F/LLM_RAG_Agent) | **MIT** | last commit 2026-09-05 |
| CancerGUIDE (github.com/microsoft/CancerGUIDE) | MIT | last commit 2026-08-05; path-overlap and treatment-match scorers worth reusing |
| CPGPrompt (github.com/bionlplab/CPGPrompt) | MIT | frozen since 2025-11-01 |

### Patient and case synthesis
- **Synthea** (github.com/synthetichealth/synthea): Apache-2.0, last commit 2026-08-18.
  - **Has `veteran_prostate_cancer.json`.** It has 41 states, and its "remarks" field says "A blank module". It covers DRE, biopsy, In situ vs Stage 4, aggressive therapy vs watchful waiting, prostatectomy and chemo/hormone.
  - It has **no NCCN risk-group variables** (Gleason grade group, PSA density, cores, PSMA), so it is too coarse for NCCN traversal.
  - The repo also has breast, lung and colorectal cancer modules. A dedicated `prostate_cancer.json` returns 404.
- **mCODE test data:** the mCODE STU4 IG ships example resources, including prostate Gleason grade group observations. No pre-generated "Synthea-mCODE prostate" cohort was found **[U]**.

### Medical NLP for patient-fact extraction and concept mapping
| Tool | License | Status |
|---|---|---|
| medspaCy (github.com/medspacy/medspacy) | MIT | release 1.3.1 (2024-11); last commit 2026-06-03 |
| scispaCy (github.com/allenai/scispacy) | Apache-2.0 | 0.6.2, 2025-10-01. Its UMLS linker covers NCIt through UMLS; a UMLS license is needed for full use. |
| Apache cTAKES (github.com/apache/ctakes) | Apache-2.0 | 6.0.0 on the Apache CDN; last commit 2026-08-12 |
| QuickUMLS (github.com/Georgetown-IR-Lab/QuickUMLS) | MIT | 1.4.2; **last commit 2023-10-16 (stale)**; needs a local UMLS install (UMLS license) |

---

## Items I could not verify
1. **Chen 2023 JAMA Oncol:** the contents of Supplements 1 and 2 (full 26 diagnosis strings, raw outputs, annotation guide). The PDFs could not be fetched.
2. **Guideline2Graph:** the node-matching procedure, the VLM backbone, the annotator details, and any future release.
3. **ASCO 2025 Mayo poster:** the "94%" figure and cohort details.
4. **Ivashchuk 2026:** prostate-specific numbers.
5. **Gabriel 2026:** the GitHub URL.
6. **Tung 2025:** whether the scenarios are in the supplement.
7. **CONCORDIA:** the prostate share of the 110 cases.
8. Official code for Arrow R-CNN and its derivatives.
9. Whether the HAPI/CQF clinical-reasoning module implements PlanDefinition `$apply`.
10. The NCCN AI-use clause on nccn.org itself.
11. Whether MedGUIDE's single prostate tree corresponds to a specific NCCN PROS page.
