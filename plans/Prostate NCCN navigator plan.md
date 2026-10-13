# Plan: a validated, machine-readable NCCN Prostate navigator for LLM agents

Scope: NCCN Guidelines, Prostate Cancer, **v6.2026 (28 Jul 2026)**. This plan only describes the work; it contains no code or pipelines.

Goal: turn the prostate guideline into a machine-readable form that does two things:
- an LLM agent can step through it node by node, following the diagrams (PROS-1 to PROS-18);
- every node links to the text that supports it (footnotes, the principles pages PROS-A to PROS-N, and the Discussion).

Then measure every strategy against published reference standards and an expert-labelled reference set that we build ourselves.

Evidence base: `reports/Computable NCCN guideline tools.md` and `research_notes/Prostate benchmark planning/gold_standards_and_tools.md`.

---

## 0. Before any work: approvals and data handling

| # | Action | Why |
|---|---|---|
| 0.1 | Confirm the data use agreement (DUA) explicitly allows four things: (a) machine conversion of the guideline, (b) using it as input to an LLM (retrieval, prompting, testing), (c) storing derived graphs and labels, and (d) publishing metrics. | Every page footer of v6.2026 restates the NCCN license term that bars use with AI without written permission. |
| 0.2 | Choose where the LLM runs. Options: an API with zero data retention and a data processing agreement (DPA), or open-weight models run locally (Llama/Qwen class). | The DUA may forbid sending content to third parties. Local models also serve as one comparison arm. |
| 0.3 | Split storage in two. **This public repo** holds code, schema, evaluation harness, aggregate metrics and the protocol. A **private store** holds the PDFs, the extracted graph, text chunks, model outputs and gold labels. | The repo is public. The `.gitignore` already excludes `*.pdf` and the local profile of the PDF. |
| 0.4 | Recruit 2–3 clinicians as annotators (urology, radiation oncology, medical oncology) and one adjudicator. Get an IRB exemption or determination if real cases will be used (step 4.3). | No public expert reference standard exists for NCCN prostate. |
| 0.5 | Pre-register the protocol before testing on held-out data (OSF or a dated commit): primary endpoints, case splits, statistics. Report under TRIPOD-LLM, plus CHART for any chat-style output. | Protects the comparison from tuning to the test set. |

---

## 1. Target representation (what "machine-readable" means here)

Use a typed decision graph (JSON, with optional JSON-LD context) as the canonical store, with two layers. Exporting to HL7 FHIR PlanDefinition + CQL (Clinical Quality Language) is an optional extra layer for interoperability (variant R2 below), not the core.

**Layer A: decision graph, mirroring the diagrams.**
- Node types: `entry`, `decision`, `condition`, `action/recommendation`, `terminal`, `page_link` (for "See PROS-x"), `table_criterion` (for grid pages such as PROS-2 and PROS-18).
- Stable IDs that include the version, e.g. `v6.2026:PROS-4:n07`.
- Provenance on every node: page code, sub-page ("2 of 5"), bounding box, and the exact text span (kept privately).
- Recommendation attributes: NCCN evidence category (2A by default, with 1/2B/3 exceptions), preference tier (Preferred / Other recommended / Useful in certain circumstances), and the drug or regimen normalized to RxNorm/NCIt where possible.
- Edges carry a **condition predicate** stated over a patient-fact schema. Examples: PSA ≥ 20; Grade Group ∈ {4,5}; cT3a; life expectancy > 10 years; PSMA-PET positive; germline BRCA2 positive; time since prior ADT; PSA doubling time (PSADT) < 10 months.
  - Each predicate is either **evaluable** (structured facts are enough) or **judgment** (needs LLM or clinician interpretation).
  - Compound logic ("and/or", "±", OR between options, "all of" / "one or more of") is represented explicitly, not left as free text.

**Layer B: links to the supporting text.**
- The ~69 algorithm footnotes (labelled a…qqq) are stored once as nodes and linked from every place they are used.
- The PROS-A to PROS-N principles pages (including their tables), staging (ST) and the Discussion (MS-*) are chunked **by section, not by fixed token windows**, and each chunk is linked to the graph nodes it supports.
- Retrieval at a node is scoped to that node: its own footnotes and principles sections first, global search only as a fallback.

**Patient-fact schema.** Aligned with mCODE (FHIR) element names so it can map to EHR data later. Fields include:
- PSA history and PSA density
- Grade Group per core and % positive cores
- cT/cN/cM stage, imaging type, and conventional vs PSMA-PET findings
- life expectancy and comorbidity
- germline/somatic results (BRCA/HRR, MSI-H, TMB)
- treatment history (radical prostatectomy (RP), radiation (RT), ADT, ARPI, docetaxel and others)
- castration status and symptoms

**Why this design.** Two published results point here:
- In OncoDoc, compliance was 94.2% when clinicians navigated the tree correctly vs 80.0% when they did not.
- In CancerGUIDE, paths are scored as sequences of page-node IDs.

Both show that explicit node IDs and logged paths are what make traversal measurable and auditable.

---

## 2. Encoding strategies to build and compare (extraction)

There is no ready-made open-source tool that recovers arrows from vector PDFs, so the plan builds on published methods using open-source parts:

| ID | Strategy | Published basis | Open-source parts |
|---|---|---|---|
| **E1** | Vector-geometry parse: read text boxes, lines and arrowheads straight from the PDF's drawing operators, rebuild the boxes-and-arrows graph, then have an LLM do only semantic typing and predicate formalization. | IIT Madras (EMBC 2024): NCCN Prostate v1.2023, 276 nodes, **98.9% node-formation accuracy**, 10 connection errors (PDFBox → JSON-LD; code not released). | pdfplumber / pdfminer.six (MIT); PyMuPDF `get_drawings()` (AGPL, fine for internal research use) |
| **E2** | Vision-language model page by page, then merge across pages (Guideline2Graph style). | Guideline2Graph (preprint), NCCN Prostate v4.2024: node P/R **57.7/93.8**, edge P/R **69.0/87.5**; baselines below 20% on edges. | Page rendering with PyMuPDF / pdf2image; a VLM (Claude / GPT / Qwen-VL) |
| **E3** | Hybrid: E1's geometry is the skeleton; the VLM checks and repairs each page through a text-graph intermediate (Mermaid) rather than free text. | TEXTUALIZER / TextFlow: converting flowcharts to text graphs before reasoning gave about 81–83% on FlowVQA/FlowLearn, vs about 0.22–0.30 link F1 for plain VLMs. | TextFlow (MIT) |
| **E4** | E3 plus cross-checking: run E1 and E2 independently, accept edges they agree on, and send disagreements to a human queue. | Ensemble / verification idea; the human-in-the-loop design follows the NICE→ASP study (κ 0.72–0.86, F1 0.825, mostly omission errors). | — |

Text layer (all strategies):
- Layout-aware extraction of the principles pages and the Discussion with **Docling** (MIT) or **Marker** (Apache code; check the RAIL-M terms on its model weights).
- Table recovery for PROS-2, PROS-18, PROS-H and PROS-J.
- Splitting into sections at headings.
- Indexing with BM25 (rank_bm25 / Pyserini) plus dense embeddings (MedCPT, or a general model).

**Known hazards to plan for** (from the PDF profile):
- The extracted text scrambles multi-column layouts.
- Footnote letters are glued onto words.
- Continuation pages ("x of n", plus an inserted "8A").
- Pages that are really tables (PROS-2, PROS-18).
- About 40 "and/or" constructs.
- Many numeric thresholds.
- The Drive text extraction cut off around page 80, so the Discussion and PROS-K to PROS-N must be checked from the full PDF.

**Representation variants (secondary):**
- **R1:** the JSON graph only.
- **R2:** the JSON graph plus a CQL/PlanDefinition export of the evaluable predicates, executed with cql-execution (Apache-2.0). This tests whether a standards-based executable layer adds correctness over predicates evaluated in Python.

---

## 3. Traversal strategies (how the LLM uses the encoding)

All arms get the same patient-fact input and the same output format:
- recommended options with node IDs and evidence category;
- the path taken;
- supporting citations (node, footnote, principles section);
- a confidence score or an abstention.

| Arm | Description | Role |
|---|---|---|
| **A0** | LLM alone, no guideline context | Floor; replicates Chen 2023 / Tsai 2024 |
| **A1** | Long context: the full text plus page images of the guideline in the prompt | Strong simple baseline |
| **A2** | Standard RAG: hybrid BM25 + dense retrieval over section chunks | Replicates the Ferber / gynecologic-oncology RAG designs (RAG beat the LLM alone: about 84% vs 57%) |
| **A3** | Graph RAG over the text (Microsoft GraphRAG, LightRAG or HippoRAG, all open source) | Tests whether a generic knowledge graph is enough |
| **A4** | **Graph-guided traversal agent.** A LangGraph state machine walks Layer A. At each node the LLM makes one local decision using structured output, with only that node's linked context (Layer B). The engine, not the LLM, moves along edges. | Core proposal; the CPGPrompt / CancerGUIDE / HemaGuide pattern |
| **A5** | A4 + **neurosymbolic predicates**: evaluable conditions are computed deterministically from the facts; the LLM decides only judgment predicates and missing facts | Removes the LLM from arithmetic and threshold checks (PSA, PSADT, Grade Group, life expectancy) |
| **A6** | A5 + **safety layer**: three things together. (1) Self-consistency and cross-model agreement used to abstain (CancerGUIDE: AUROC about 0.80 for flagging errors). (2) A verifier agent that re-checks each step against its node's citations. (3) A fallback to A2 retrieval when the case falls off the pathway. | HemaGuide-style mode routing; no single component was enough on its own |

**Variations to test within the arms:**
- Facts extracted once at the start vs on demand at each node.
- Footnotes and principles included vs not (ablation).
- Context at the node only vs the whole page.
- Retrieval depth k.
- With vs without a reflection step.
- Model family: a frontier API model vs a local open-weight model (and tool-calling reliability, since open-weight models scored 39% or less in Ferber et al.).
- Temperature, and the number of samples for self-consistency.
- Structured-output enforcement on vs off.

Only the dev split is used to tune variants. The test split is run once per frozen configuration.

---

## 4. Reference standards and datasets

### 4.1 Encoding fidelity: build our own expert reference graph (required)

- **No public NCCN prostate reference graph exists.** Guideline2Graph's and IIT Madras's were never released.
- Two clinicians independently annotate PROS-1 to PROS-18 from the PDF: nodes, edges, predicates, footnote links and cross-page links. They work from a short annotation guide and a simple annotation sheet (no tooling needed).
- The adjudicator resolves conflicts.
- **Report agreement between annotators** (node/edge F1 and κ on predicates). No published NCCN graph reports this, so it is a contribution in itself.
- Budget: about 25 flow pages at roughly 1–2 hours each per annotator, plus adjudication, so on the order of 60–100 clinician-hours.

### 4.2 Traversal and recommendation sets

| Set | Source | Size | Labels | Use |
|---|---|---|---|---|
| **P1** | Tsai et al., *Digital Health* 2024 (CC BY-NC-ND), prostate prompts with published rater scores | ~36 prostate items | Rater alignment (labelled to older NCCN versions) | Direct comparison with a published external result; must be re-rated against v6.2026 |
| **P2** | Chen et al., *JAMA Oncol* 2023, prompt templates and 5-item rubric (CC-BY) | 32 prostate prompts | Rubric (re-scored by our clinicians) | Head-to-head with published GPT-3.5 figures: 59.4% all-concordant, 18.8% hallucination |
| **P3** | MedGUIDE `prostate_14` (Hugging Face, no license stated, so check before use) | 166 MCQs | Built from one NCCN prostate tree (version not stated) | Tree-reasoning sanity check; best published overall score is 0.644 (GPT-4.1) |
| **P4** | **Our expert-labelled vignettes (primary).** Generated from the patient-fact schema with stratified sampling, so every PROS page and every risk group is covered, including edge thresholds, missing data and off-pathway cases. Clinicians review them for realism. | ~240 (dev 80 / test 160) | Two clinicians independently label the **gold path** (sequence of node IDs) and the **acceptable recommendation set**; adjudicated; agreement reported | Primary endpoint set; CancerGUIDE-style scoring |
| **P5** (optional) | Real de-identified institutional cases with tumor-board decisions (IRB) | 100–200 | Actual decision plus retrospective NCCN path | External validity; like the Kaiser 2025 study (n=171) |

Synthea's prostate module has no Gleason, PSA or risk-group variables, so it cannot generate P4 cases directly. A custom generator over the fact schema is used instead. CPGPrompt's prostate vignettes come from a Canadian primary-care referral guideline, not NCCN, so they are excluded.

---

## 5. Metrics and comparison to published reference standards

**Encoding (Section 2 strategies vs the 4.1 reference graph):**
- Node and edge precision / recall / F1.
  - The matching protocol is pre-specified: same page, then semantic equivalence judged by an LLM judge that is first validated against clinicians on a sample.
- Predicate correctness (exact; then clinically equivalent).
- Footnote-link and cross-page-link recall.
- Per-page error taxonomy: omission vs spurious vs mis-wired.
- **Comparison:** Guideline2Graph (v4.2024: node 57.7/93.8, edge 69.0/87.5) and IIT Madras (v1.2023: 98.9% node formation).
  - Report this side by side but flag it as **not like-for-like**: different versions and unreleased references.
  - If NCCN archive access allows, also run E1–E4 on v4.2024 for a closer comparison with Guideline2Graph.

**Traversal (arms A0–A6 on P1–P5):**
- **Primary:** on P4-test, an exact match of the final recommendation to the acceptable set, plus path Jaccard against the gold node sequence (CancerGUIDE metrics; code is MIT, so reuse its scorer).
- **Secondary:**
  - The Chen rubric: any concordant / any non-concordant / hallucinated regimen.
  - Rate of potentially harmful recommendations, judged by clinicians.
  - Completeness and citation accuracy (Ferber: 75.5% correct citations).
  - Abstention calibration: AUROC, and coverage vs accuracy.
  - Run-to-run stability over 5 seeds.
  - Cost and latency.
- **Ceiling:** report each metric against the clinicians' own agreement with each other (CancerGUIDE oncologists: 0.64–0.69).

**Statistics:**
- Paired design: every arm runs on every case.
- McNemar's test for exact match, and a paired bootstrap for 95% CIs on F1 and Jaccard.
- Mixed-effects logistic regression with case as a random effect and PROS section as a covariate.
- Holm correction across the pre-specified comparisons: A4 vs A2, A5 vs A4, A6 vs A5, and best vs A0.
- About 160 test vignettes gives roughly 80% power to detect a 10-point paired difference when about 20% of pairs disagree. Recheck this after the pilot.

---

## 6. Phases, outputs and go/no-go gates

| Phase | Work | Output | Gate |
|---|---|---|---|
| **0** Governance (wk 0–2) | Section 0 items | Signed DUA scope, chosen LLM hosting, clinician team, pre-registration | No go without 0.1 |
| **1** Schema and annotation guide (wk 1–3) | Patient-fact schema (mCODE-aligned), graph schema, predicate grammar, annotation guide; pilot on PROS-1 to PROS-3 | Schema v1; agreement on the pilot pages | Pilot κ ≥ 0.6, else revise the guide |
| **2** Reference graph (wk 3–7) | Double annotation of PROS-1 to PROS-18, adjudication | Reference graph v6.2026 (private) + agreement report | — |
| **3** Encoders E1–E4 + text layer (wk 3–8) | Build them; tune on PROS-1 to PROS-6, report on PROS-7 to PROS-18 (page-level held out) | Graphs from each strategy + fidelity metrics | Best encoder edge F1 ≥ 0.90 before clinician QA; residual errors fixed by humans and logged |
| **4** Vignettes P4 (wk 5–9) | Generate, review, double-label, adjudicate; obtain P1–P3 | Datasets + label agreement | — |
| **5** Traversal arms A0–A6 (wk 8–12) | Build with LangGraph; tune variations on P4-dev only | Frozen configurations | — |
| **6** Benchmark (wk 12–14) | One-shot test runs; clinician harm review of failures | Results tables, error analysis | — |
| **7** Write-up (wk 14–16) | TRIPOD-LLM / CHART checklists; reproducibility package (public: code + schema + metrics; private: content) | Manuscript-ready report | — |
| **8** Maintenance (ongoing) | When v7.2026 or later is released, diff it against the current encoding, re-annotate only changed nodes, and re-run regression vignettes | Versioned graph and changelog | — |

A silent shadow deployment alongside clinicians (like HemaGuide's one-month silent run) is a later step, after this benchmark.

---

## 7. Open-source components (verified license and status, Oct 2026)

| Purpose | Tool | License / notes |
|---|---|---|
| PDF vector geometry | pdfplumber, pdfminer.six; PyMuPDF | MIT; AGPL-3.0 |
| Layout text and tables | Docling; Marker | MIT; Apache code with RAIL-M model weights |
| Flowchart → text graph | TextFlow | MIT |
| Agent / state machine | LangGraph; DSPy (prompt optimization for variants) | MIT |
| Graph RAG baselines | Microsoft GraphRAG, LightRAG, HippoRAG | MIT |
| Retrieval | rank_bm25 / Pyserini; MedCPT | Apache / MIT; MedCPT model weights under an "other" license |
| Executable standard (R2) | cql-execution, CQL tooling | Apache-2.0 |
| Evaluation | inspect_ai, promptfoo; CancerGUIDE scorer | MIT |
| Baseline agent reference | Dyke-F/LLM_RAG_Agent (Ferber 2025) | MIT |
| Graph store (optional) | NetworkX (default); Neo4j Community | BSD; GPL-3.0 |

Not used:
- MITRE Camino: inactive since 2022.
- QuickUMLS: stale, and needs a UMLS license.
- Synthea: too coarse for prostate.

---

## 8. Main risks

1. **The DUA does not cover AI use.** This blocks the whole project. Resolve it in Phase 0. Fallback: a written research license from NCCN.
2. **Clinician time** is the critical-path resource: about 150–250 hours in total. Mitigate with the LLM-assisted pre-annotation that clinicians correct, but measure its bias by keeping a slice annotated fully by hand.
3. **Weak like-for-like comparison with published work**, because of version differences and unreleased reference sets. Mitigate by stating it openly, by also running v4.2024 if available, and by releasing our own metrics protocol.
4. **Overfitting variants to the dev set.** Mitigate with pre-registration and a single test run.
5. **Guideline churn** (six releases in 2026 so far). Mitigate with version-scoped IDs and diff-driven re-validation.

---

## Decisions needed from you

1. Does the DUA cover LLM processing, and which LLM hosting is allowed (API with zero retention vs local only)?
2. Who will be the clinician annotators, and how much time can they give (this sets the size of P4 and whether P5 is included)?
3. Should we also get archived versions (v4.2024 / v1.2023) for closer comparison with Guideline2Graph and IIT Madras?
4. Are real institutional cases (P5, IRB) in scope for this round?
