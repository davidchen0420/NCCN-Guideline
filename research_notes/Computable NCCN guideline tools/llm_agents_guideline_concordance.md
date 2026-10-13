# LLM-based systems for oncology-guideline-concordant recommendations (plain LLM vs RAG vs agents vs structured traversal)

Status labels used below: **[PR]** = peer-reviewed journal; **[PP]** = preprint (arXiv/medRxiv); **[ABS]** = conference abstract; **[PRESS]** = press release or secondary coverage only. Research cut-off: 2026-10-13.

## Baseline evidence: plain LLMs vs NCCN guidelines and tumor boards

### Takeaway
Plain LLMs almost always name at least one guideline-concordant option, but they often mix in nonconcordant or hallucinated treatments. In the landmark JAMA Oncology study, only 62% of responses were fully concordant and 13% of recommended treatments were hallucinated. Agreement with tumor boards ranges from about 50% to 90%. It is high for coarse decisions such as curative vs palliative intent and drops sharply for the full first-line regimen.

### Cited Findings
- **Chen et al., JAMA Oncology 2023 [PR]**
  - Design: GPT-3.5 (ChatGPT). 26 diagnosis descriptions × 4 prompt templates = 104 prompts. Benchmarked against the 2021 NCCN guidelines to match the model's training cutoff. Three of four oncologists scored each output, with majority rule — [JAMA Oncol](https://jamanetwork.com/journals/jamaoncology/fullarticle/2808731); [ScienceDaily/MGB release](https://www.sciencedaily.com/releases/2023/08/230824111917.htm)
  - Results: 98% of prompts had at least one NCCN-concordant treatment. 34% also contained at least one nonconcordant treatment. Only 62% were fully concordant. About 13% of recommended treatments were hallucinated, meaning they appeared nowhere in the recommended options — [MDedge/The Hospitalist](https://mdedge.com/content/do-ai-chatbots-give-reliable-answers-cancer-yes-and-no); [ScienceDaily](https://www.sciencedaily.com/releases/2023/08/230824111917.htm)
  - Source caveat: these figures come from secondary coverage; I did not re-read the full text.
- **Head & neck tumor board study, 2025 [PR, Eur Arch Otorhinolaryngol]**
  - Design: 25 simulated tumor board cases.
  - Curative vs palliative strategy: ChatGPT-4o matched the MDT in 21/25 (84%) and locally run Llama 3 in 23/25 (92%).
  - Full set of MDT first-line therapies: ChatGPT-4o 13/25 (52%), Llama 3 12/25 (48%) — [PMC11890241](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11890241/)
- **Head & neck RAG study, Oral Oncology 2026 [PR]**
  - Design: 14 synthetic cases. Compared GPT-4 and GPT-5, each with and without RAG, against a human expert.
  - Results: the RAG-based models had the highest mean scores, but absolute differences were modest — (reported via search summary of [PMC/Springer results](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11890241/). Primary URL not retrieved.)
- **Concordance range across tumor types (review, secondary):**
  - LLM–MDT concordance ranges from about 50% to 90%. Values above 80% come mainly from domains with structured decision spaces.
  - Renal cell carcinoma: schema-free LLM output agreed with the MDT in 62.1% of 103 cases.
  - Breast: GPT-4 at about 70.6%; an earlier ChatGPT study agreed in 7/10 cases (70%).
  - Source: secondary review cited in search results ([Springer s00405-024-09153-3 and related](https://link.springer.com/article/10.1007/s00405-024-09153-3)). I did not locate the primary studies, so treat these as secondhand.
- **Molecular tumor board, ChatGPT 4.0 vs human boards (Augsburg) [PR]**
  - Design: retrospective, 20 real cases.
  - Findings: the model reliably produced guideline-concordant recommendations in standard cases. It sometimes relied on lower-level evidence, and the authors call for human oversight — [PMC12557318](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12557318/)
- **Human boards are also not a perfect gold standard.** Indian MTBs disagreed with NGS reports in 49% of cases (24/49), mostly because of low-level evidence for the drug — [JCO Global Oncology via DOAJ](https://doaj.org/article/37ed3f1b16ae47f7873e6426b94d5ead)
- **HCC [PRESS]:** LLM recommendations matched physicians' actual decisions mainly in straightforward cases. Physicians weighted liver function more heavily than the LLMs did — [ASCO Post Jan 2026](https://ascopost.com/news/january-2026/hcc-llm-advice-and-treatment-concordance/)
- **Google AMIE, breast oncology**
  - arXiv 2411.03395 [PP]: 50 synthetic breast vignettes, released with the paper. No domain fine-tuning.
  - NEJM AI 2025 [PR]: 60 vignettes including rare histologies. Added web-search retrieval and a multistage self-critique pipeline.
  - Results: AMIE beat trainees and fellows but was overall inferior to attending oncologists. Few physician raters were used — [arXiv](https://www.arxiv.org/abs/2411.03395); [Google Research](https://research.google/pubs/exploring-large-language-models-for-specialist-level-oncology-care/)

### Inferences
- The dominant failure mode is extra or hallucinated nonconcordant regimens appearing alongside correct ones, rather than missing the right option. A navigator should therefore treat **recall of correct options** and **precision (no nonconcordant extras)** as separate metrics. The "at least one concordant" metric overstates safety.
- Coarse branch decisions (intent, modality) are much easier than fine-grained regimen selection. This argues for stepwise decision nodes, where each step is a constrained choice, over free-text regimen generation.
- Model cutoffs vs guideline versions are a confound. Every evaluation must pin an NCCN version.

### Gaps
- No primary-source lung-specific LLM vs tumor board concordance figure was retrieved in this pass.
- I did not verify the exact Oral Oncology 2026 citation or the 70.6% breast figure against primary papers.
- No head-to-head of Claude, Gemini and GPT on the same NCCN case set was found in this pass.

## RAG / tool-using agents grounded in guidelines: reported metrics

### Takeaway
Guideline-grounded RAG consistently beats the same model without retrieval. Kather-group GPT-4 RAG raised correct statements from about 57% to 84%. NCCN-anchored GPT-5 RAG scored 0.83 vs 0.65 in gynecologic oncology. A GPT-4 agent with tools and RAG raised completeness from 30.3% to 87.2%. Even so, retrieval alone is "insufficient in complex solid tumor settings," and citations are often irrelevant: only 75.5% were correct in the Ferber agent. Nearly all studies are small (14–60 cases).

### Cited Findings
- **Ferber et al., NEJM AI 2024 [PR]: GPT-4 + RAG over ASCO/ESMO guidelines**
  - Scope: pancreatic cancer, metastatic CRC and HCC.
  - With RAG: 184 of 218 statements (84%) were correct; 30 were inaccurate and 4 wrong.
  - Without RAG: about 57% (93/163) correct.
  - Source: [ctisus journal club summary](https://ctisus.com/learning/journalclub/340277); [Kather/OncoDaily](https://oncodaily.com/blog/67900.html). These figures are from secondary summaries and should be verified.
- **Ferber et al., Nature Cancer 2025, "Development and validation of an autonomous AI agent for clinical decision-making in oncology" [PR]**
  - Orchestration: GPT-4 (gpt-4-0125-preview).
  - Tools: GPT-4V for radiology reports, MedSAM segmentation, vision transformers predicting MSI and KRAS/BRAF from histology, OncoKB API, PubMed and Google search, and a calculator.
  - RAG corpus: about 6,800 documents from MDCalc, UpToDate, MEDITRON, ASCO, ESMO and Onkopedia. NCCN is not included.
  - Cases: 20 simulated multimodal cases, mostly GI oncology, rated by 4 clinicians.
  - Results:
    - Tool use: 87.5% correct (56/64).
    - Statements: 91.0% correct (223/245); 6.5% incorrect; 2.4% potentially harmful (6/245).
    - Completeness: 87.2% (95/109) vs 30.3% for GPT-4 alone.
    - Helpfulness: 94.0%.
    - Citations: 75.5% correct (194/257), 23.0% irrelevant, 1.6% contradicting the statement.
  - Open-weight models: Llama-3-70B reached only 39.1% required-tool success and Mixtral 8x7B 7.8%.
  - Limitations: single run per case; cloud model; silent model updates.
  - Code: [github.com/Dyke-F/LLM_RAG_Agent](https://github.com/Dyke-F/LLM_RAG_Agent)
  - Source: [PMC12380607](https://pmc.ncbi.nlm.nih.gov/articles/12380607/); [TU Dresden](https://tu-dresden.de/med/der-bereich/news/ki-agenten-fuer-die-krebsmedizin-dresdner-forschungsteam-entwickelt-system-zur-unterstuetzung-klinischer-entscheidungen)
- **Gynecologic oncology, NCCN-anchored RAG, JMIR AI 2026 [PR]**
  - Design: 50 de-identified cases (Oct–Nov 2025). Three gynecologic oncologists rated outputs.
  - Results (mGPS): GPT-5 + NCCN RAG 0.83 (SD 0.26); OpenEvidence 0.70 (0.27), which had no NCCN access at the time; baseline GPT-5 0.65 (0.31).
  - The authors stress this is benchmark performance, not clinical safety — [Creighton listing](https://researchworks.creighton.edu/esploro/outputs/journalArticle/Guideline-anchored-retrieval-augmented-generation-outperforms-baseline-and/991006292244502656); [JMIR AI e93239](https://ai.jmir.org/2026/1/e93239/PDF)
- **Multi-axis safety evaluation, JCO 2026 suppl. abstract 19 [ABS]**
  - Design: 186 solid-tumor vignettes across three configurations.
  - Conclusion: guideline-anchored retrieval improves safety but is insufficient in complex solid-tumor settings, and fluent presentation frequently masks safety-critical failures — [CiteDrive / JCO 44(19_suppl)](https://www.citedrive.com/en/discovery/disease-specific-safety-risks-in-oncology-large-language-models-a-multi-axis-evaluation-across-solid-tumor-subtypes/)
- **Breast cancer NCCN tool: ChatGPT-4 vs Graph-RAG vs Agentic-RAG (arXiv 2502.15698) [PP]**
  - v1 (24 questions): Agentic-RAG 100% (24/24), Graph-RAG 95.8%, ChatGPT-4 91.6%.
  - A later version (50 recommendations): Agentic-RAG 100%, Graph-RAG 92%, ChatGPT-4 94%. ChatGPT-4 missed two treatments and added one unnecessary recommendation.
  - Graph-RAG converted NCCN JSON into chunks, then extracted entities and relations. Its misses came from omitting nuanced or overlapping guideline information.
  - Sources: [arXiv v1](https://arxiv.org/abs/2502.15698v1); [arXiv pdf](https://arxiv.org/pdf/2502.15698). The two versions report inconsistent numbers, and Graph-RAG did not beat plain GPT-4 in the later version.
- **NCCN NSCLC "knowledge models" + RAG QA (arXiv 2407.21053) [PP]**
  - Design: 32 questions.
  - Accuracy: 54.5% for questions answered from the treatment algorithm (flowchart) and 81.8% for questions answered from the discussion section — [arXiv](https://arxiv.org/pdf/2407.21053)
- **MOAlmanac-based RAG for biomarker-driven therapy [PR, venue unconfirmed]:** up to 95% accuracy on synthetic queries and 93% on real-world oncologist queries, vs an LLM-only baseline — (search-summary; [JMIR 2025](https://jmir.org/2025/1/e64364) / related). Venue and authors are unconfirmed.
- **GatorOnco, colorectal agentic LLM (arXiv 2608.09142, Aug 2026) [PP]**
  - Architecture: trained on 282B tokens, including 166B from UF Health clinical text, plus agentic RAG over time-sensitive guidelines. Agent-based reinforcement learning.
  - Evaluation: blinded ratings by 5 oncologists vs expert-written plans.
    - Correctness: 4.09 vs 4.11 (P=0.92).
    - Safety: 4.22 vs 4.22.
    - Completeness: 3.91 vs 3.52 (P<0.01).
  - Case count not stated; no code listed — [arXiv](https://arxiv.org/abs/2608.09142)
- **Microsoft Healthcare Agent Orchestrator (HAO), tumor boards (arXiv 2509.06602, demo) [PP]**
  - Focus: patient summarization, not treatment concordance.
  - Results:
    - The Patient History agent captured over 94% of high-importance facts, counting partial entailment.
    - TBFact strict recall was 0.84.
    - TBFact (LLM-as-judge) correlated with experts at Kendall τ = 0.558.
    - Preliminary orchestrator scores (1–5 scale): agent selection 4.0, intent resolution 4.5, information aggregation 3.7.
  - Sources: [arXiv](https://arxiv.org/pdf/2509.06602); [MSR](https://www.microsoft.com/en-us/research/publication/demo-healthcare-agent-orchestrator-hao-for-patient-summarization-in-molecular-tumor-boards)

### Inferences
- The strongest, consistent evidence is "same model + guideline retrieval > same model alone." Evidence that Graph-RAG beats simple or agentic RAG is weak and inconsistent; the single small breast preprint shows Agentic-RAG > Graph-RAG.
- Citation grounding is the weak link. A quarter of the Ferber agent's citations were wrong or irrelevant. A navigator should cite deterministic node IDs (NCCN page/footnote codes), not free retrieval hits.
- Open-weight models lagged badly at function calling in 2024. This needs re-checking with 2025–26 open models before choosing local deployment.

### Gaps
- No peer-reviewed study was found that RAGs over the **full NCCN library** with large real-world case sets. NCCN licensing likely restricts this.
- The original NEJM AI numbers were not verified from the primary text.
- MSK/Mayo agent systems (e.g., MSK "Woollie") and the "MEREDITH" MTB system were not confirmed in this pass.

## Structured traversal (decision tree / flowchart / graph-guided agents)

### Takeaway
Explicit guidance-tree traversal is technically feasible and auditable: MedDM built 1,202 trees, CPGPrompt published code, and CancerGUIDE released an NCCN path benchmark. The best real-world evidence is HemaGuide, which grounds recommendations in guideline flowcharts plus case memory and reached about 82% tumor board concordance on 555 external cases. However, **no published head-to-head shows that tree traversal beats unstructured RAG on oncology concordance**. Ablations suggest the gains depend on the case type.

### Cited Findings
- **CancerGUIDE (Unell, Codella, …, Horvitz; Microsoft Research/Stanford; arXiv 2509.07325) [PP]: the closest analog to an NCCN Navigator benchmark**
  - Task: predict the NCCN NSCLC guideline **path** (sequence of nodes) plus the final treatment from longitudinal notes.
  - Data:
    - 121 notes annotated by 13 oncologists, averaging 46.5 minutes per note and about 55k characters.
    - 82 distinct guideline paths and 48 final treatments.
  - Metrics: **path overlap** (process fidelity) and **treatment match** (outcome).
  - Expert ceiling (inter-annotator on 11 dual-annotated cases): treatment match 0.636, path overlap 0.692.
  - Results:
    - Frontier models reach only moderate path overlap and low exact treatment match; the best covered about half the path.
    - GPT-5 at medium reasoning effort was best; GPT-4.1 was worst.
    - Self- and cross-model-consistency proxy benchmarks correlated with expert benchmarks (Spearman r = 0.88, RMSE 0.08).
    - A meta-classifier flagged incorrect recommendations (AUROC about 0.80).
    - Unsupervised error detection caught 40.4% of errors.
  - A synthetic patient dataset is available — [hyper.ai summary](https://hyper.ai/papers/2509.07325); [arXiv](https://arxiv.org/html/2509.07325v2)
- **HemaGuide (DKFZ / HI-STEM / Heidelberg University Hospital, 2026) [PR; venue reported as Nature Medicine by one aggregator, unconfirmed]**
  - Architecture: locally deployable agent. It structures unstructured documents, routes each case to a guideline, advanced or molecular decision mode, and grounds recommendations in disease-specific guideline flowcharts plus a memory of over 2,000 real tumor board cases.
  - Benchmark: blinded test on 45 high-complexity cases across 6 foundation models showed substantially improved tumor board concordance. An 11-layer ablation showed gains depended on routing type, with no single component sufficient across case types.
  - External validation: about 82% agreement with expert panels on 555 cases spanning 47 blood cancer types. About 83% in a one-month silent prospective run.
  - Additional claims (commentary only, unverified): 0.3% hallucination rate, 39 s median runtime, and residents using it approached senior hematologists' decisions.
  - Sources: [DKFZ record](https://inrepo02.dkfz.de/record/313892); [MDLinx](https://www.mdlinx.com/news/new-ai-system-provides-treatment-recommendations-for-complex-blood-cancers/3POW9lAOCvngJgujoLYLkw); [Gesundheitsindustrie-BW press](https://www.gesundheitsindustrie-bw.de/en/article/press-release/new-ai-system-provides-treatment-recommendations-complex-blood-cancers); [OncoDaily commentary](https://oncodaily.com/voices/yan-leyfman-532541)
- **CPGPrompt (Deng, …, Weng, Peng; arXiv 2601.03475) [PP]**
  - Architecture:
    - An LLM converts guideline text or pathway diagrams into JSON guidance trees, which are then manually validated.
    - Node types: Simple Feature Check and Multi-Criteria Check.
    - A chatbot engine traverses the tree with yes/no questions and logs every branch.
  - Evaluation: GPT-4o, 5 runs, on synthetic vignettes including 96 for prostate cancer referral.
  - Results:
    - Binary F1 was 1.00 for prostate cancer and back pain and 0.90 for headache.
    - Multi-class pathway macro-F1 was much lower: 0.77 prostate, 0.72 low back pain, 0.44 headache.
  - Failure modes: early termination of traversal; over-referral on exclusion criteria (headache exclusion F1 0.06).
  - No RAG or plain-LLM baseline was reported.
  - Code: [github.com/bionlplab/CPGPrompt](https://github.com/bionlplab/CPGPrompt) — [arXiv](https://arxiv.org/html/2601.03475v1)
- **MedDM (arXiv 2312.02441) [PP]:** converts CPG flowcharts into "LLM-executable clinical guidance trees," with a knowledge base of 1,202 decision trees covering over 500 diseases — [arXiv](https://arxiv.org/pdf/2312.02441)
- **ALL guideline + ontology study (CEUR-WS Vol-4001) [PR workshop]:** pairs structured guidelines with an ontology. Tested GPT-3, GPT-4o and Llama-2-70B on synthetic patients, with decision-path tracing and rule-based reasoning for auditability — [CEUR](https://ceur-ws.org/Vol-4001/paper3.pdf)
- **Counter-evidence (medRxiv 2024.03.04) [PP]:** GPT-4 and Claude-2 could generate molecular-subtyping decision trees, but adding guideline text added little accuracy. The authors urge caution in zero-shot use — [medRxiv](https://medrxiv.org/content/10.1101/2024.03.04.24303737.full.pdf)

### Inferences
- The best-supported Navigator design pattern combines:
  1. structured extraction of patient facts;
  2. deterministic or LLM-assisted routing to a guideline flowchart node;
  3. LLM used only for local branch decisions with evidence citations;
  4. case memory or RAG for off-pathway or complex cases;
  5. consistency-based uncertainty flags, as in CancerGUIDE, to trigger abstention.

  HemaGuide and CancerGUIDE together cover most of this pattern.
- Inter-oncologist agreement on NCCN paths is only about 0.64–0.69 (CancerGUIDE). Concordance targets near 100% are unrealistic for complex cases. Report concordance relative to the expert ceiling, and score path and treatment separately.
- Tree traversal mainly buys auditability and version traceability. Accuracy gains over RAG are plausible but unproven.

### Gaps
- No RCT or head-to-head of tree-traversal vs RAG vs plain LLM on the same NCCN oncology case set was found.
- How HemaGuide encodes its flowcharts was not available from accessible sources.
- I found no published LLM + CQL/CDS Hooks executable-guideline system with oncology concordance results.

## Open-source code, benchmarks and evaluation methods

### Takeaway
Public assets are thin:
- Ferber agent code (GitHub)
- CPGPrompt code (GitHub)
- CancerGUIDE synthetic NSCLC dataset (expert set availability unclear)
- AMIE's 50 breast vignettes
- the MedDM tree knowledge base (described in the paper)

There is no public NCCN-concordance benchmark with full NCCN text, likely because of licensing.

### Cited Findings
- Ferber agent code: [github.com/Dyke-F/LLM_RAG_Agent](https://github.com/Dyke-F/LLM_RAG_Agent) — [PMC12380607](https://pmc.ncbi.nlm.nih.gov/articles/12380607/)
- CPGPrompt code: [github.com/bionlplab/CPGPrompt](https://github.com/bionlplab/CPGPrompt) — [arXiv](https://arxiv.org/html/2601.03475v1)
- CancerGUIDE: a synthetic patient dataset is linked. Public release of the expert-annotated 121-case set is not stated — [hyper.ai](https://hyper.ai/papers/2509.07325)
- AMIE breast vignettes (50) were released with the arXiv paper — [arXiv](https://arxiv.org/html/2411.03395v1)
- Evaluation methods in use:
  - **Majority-of-3 oncologist concordance with a pinned NCCN version** (Chen 2023) — [JAMA Oncol](https://jamanetwork.com/journals/jamaoncology/fullarticle/2808731)
  - **Statement-level correct / incorrect / harmful scoring, plus completeness, helpfulness and citation correctness** (Ferber 2025) — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/12380607/)
  - **mGPS** (gyn RAG) — [Creighton](https://researchworks.creighton.edu/esploro/outputs/journalArticle/Guideline-anchored-retrieval-augmented-generation-outperforms-baseline-and/991006292244502656)
  - **Path overlap vs treatment match** (CancerGUIDE) — [hyper.ai](https://hyper.ai/papers/2509.07325)
  - **TBFact entailment-based LLM-judge** (HAO) — [arXiv](https://arxiv.org/pdf/2509.06602)
  - **Likert ratings for readability, completeness, correctness, currency and safety** (GatorOnco) — [arXiv](https://arxiv.org/abs/2608.09142)

### Inferences
- A Navigator project can reuse the CancerGUIDE metrics (path overlap and treatment match) together with the Ferber statement-level harm and citation scoring. This would give both process-level and safety-level evaluation.

### Gaps
- Searches did not surface "OncoBench," "CancerBench," "NCCN benchmark," or MedQA oncology-subset datasets with NCCN-concordant labels. Their existence is unconfirmed.

## Safety and evaluation frameworks (citation grounding, abstention, version tracking)

### Takeaway
The safety evidence points to three controls:
- verify citations, since about 25% were irrelevant in the Ferber agent;
- use consistency-based uncertainty to abstain or flag (CancerGUIDE error-detection AUROC about 0.80);
- pin the guideline version, since knowledge cutoffs confound concordance.

Fluent output frequently masks safety-critical errors, even with retrieval.

### Cited Findings
- Citation correctness was 75.5%, with 23% irrelevant and 1.6% contradictory citations — [PMC12380607](https://pmc.ncbi.nlm.nih.gov/articles/12380607/)
- In the Ferber agent, 2.4% of statements were potentially harmful despite tools and RAG — [PMC12380607](https://pmc.ncbi.nlm.nih.gov/articles/12380607/)
- Consistency-based meta-classifier: AUROC about 0.80. Unsupervised detection caught 40.4% of errors with no labels — [hyper.ai](https://hyper.ai/papers/2509.07325)
- "Fluent presentation frequently masks safety-critical failures"; retrieval is "insufficient in complex solid tumor settings" — [JCO 2026 abstract](https://www.citedrive.com/en/discovery/disease-specific-safety-risks-in-oncology-large-language-models-a-multi-axis-evaluation-across-solid-tumor-subtypes/)
- Version pinning: Chen et al. had to benchmark against 2021 NCCN guidelines to match the model's cutoff — [MDedge](https://mdedge.com/content/do-ai-chatbots-give-reliable-answers-cancer-yes-and-no)
- Reproducibility: silent model updates and deprecations, and built-in refusals required restarting runs — [PMC12380607](https://pmc.ncbi.nlm.nih.gov/articles/12380607/)
- Traversal logging (every query, response and branch) gives an audit trail — [CPGPrompt](https://arxiv.org/html/2601.03475v1)
- HemaGuide ran a silent prospective phase, processing cases in parallel without influencing decisions (about 83% concordance). This is a deployment-validation template — [MDLinx](https://www.mdlinx.com/news/new-ai-system-provides-treatment-recommendations-for-complex-blood-cancers/3POW9lAOCvngJgujoLYLkw)

### Inferences
- For an NCCN Navigator, abstention should trigger when any of these hold:
  - self- or cross-model disagreement at a node;
  - a patient feature required by a node is missing;
  - the case falls outside the encoded pathway.

  The silent prospective "shadow mode" used by HemaGuide is the most credible next validation step before live use.

### Gaps
- No published oncology LLM system was found that formally reports abstention rates or calibration against guideline-version changes (e.g., re-evaluating after an NCCN update).
