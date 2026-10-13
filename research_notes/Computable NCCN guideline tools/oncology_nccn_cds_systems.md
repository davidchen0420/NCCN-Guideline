# Oncology / NCCN Guideline Encoding Efforts and Clinical Decision Support Systems (inventory as of 2026-10-13)

Legend: **[VALIDATED]** = peer-reviewed or formally reported evaluation with numbers; **[PRELIM]** = preprint, conference abstract, or small vignette study with numbers; **[DESCRIBED]** = described only, no outcome numbers found.

## Q1. What does NCCN itself offer in machine-readable form, and what are its licensing and AI terms?

### Takeaway
NCCN does not license the Guidelines themselves as structured data. They are licensed as PDF only. The Drugs & Biologics Compendium and the Biomarkers Compendium are the only NCCN products offered as XML/JSON through an API. The Guidelines Navigator (2025) is an interactive web viewer for non-commercial use, with no public data feed. NCCN's End User License Agreement bars using NCCN content to develop, test or train AI models without NCCN's written agreement. Separately, NCCN licenses content to selected AI vendors, such as OpenEvidence (November 2025). An LLM system built on downloaded NCCN PDFs is therefore legally constrained, and the user needs a license or an NCCN agreement before any use beyond personal, non-commercial use.

### Cited Findings
**Licensing formats and API**
- NCCN's developer page lists the NCCN Guidelines as licensable in **PDF only, with no API**. The **NCCN Drugs & Biologics Compendium** is licensable as PDF and as **XML/JSON via API**, and the **Biomarkers Compendium** also has an API option. The Radiation Therapy Compendium is PDF only. API access uses an NCCN-issued AccessKey and is restricted to IP addresses the consumer supplies. — [NCCN Developer API](https://nccn.org/developer-api) (seen via search snippet; a direct fetch returned HTTP 403)
- The Compendium "contains authoritative, scientifically derived information designed to support decision-making about the appropriate use of drugs and biologics in patients with cancer." — [NCCN Developer API](https://nccn.org/developer-api)

**NCCN Guidelines Navigator**
- Announced June 24, 2025 as an interactive digital format of the NCCN Guidelines. Beta began with colon and prostate, and rectal followed on June 16, 2025. NCCN plans to add all 88 guidelines over time, and the PDF remains available. — [ASCO Post, June 2025](https://ascopost.com/news/june-2025/national-comprehensive-cancer-network-launches-nccn-guidelines-navigator/); [Newswise press release](https://www.newswise.com/articles/trusted-oncology-guidelines-get-a-digital-makeover-national-comprehensive-cancer-network-launches-nccn-guidelines-navigator)
- Features include table-of-contents and search navigation, filters, a **pathway highlighter**, color-coded links, footnotes linked from pathway nodes, links to patient guidelines, and links to chemotherapy templates for subscribers. It is free with an NCCN account for **non-commercial use**. It has **no AI features** at launch. NCCN says it plans to add "artificial intelligence capabilities" for more conversational search. — [ASCO Post](https://ascopost.com/news/june-2025/national-comprehensive-cancer-network-launches-nccn-guidelines-navigator/)
- Conflict: one search summary called the Navigator a "2024" launch. The primary press coverage dates the public launch to June 2025, with beta testing before that. — [ASCO Post](https://ascopost.com/news/june-2025/national-comprehensive-cancer-network-launches-nccn-guidelines-navigator/)
- No source describes a data export, API, or FHIR/CQL representation for the Navigator. — [ASCO Post](https://ascopost.com/news/june-2025/national-comprehensive-cancer-network-launches-nccn-guidelines-navigator/); [NCCN Developer API](https://nccn.org/developer-api)

**NCCN Evidence Blocks**
- Launched in 2016 as a visual display of five measures for each recommendation (efficacy, safety, quality of evidence, consistency of evidence, affordability). — [The Cancer Letter, 2016](https://cancerletter.com/the-cancer-letter/20160325_4/)
- NCCN's legal notices say the Evidence Blocks™ design is "subject to certain U.S. and foreign patents," and each approved use requires NCCN's independent written approval. — [NCCN Legal Notices](https://nccn.org/legal-notices)

**NCCN Chemotherapy Order Templates and EHR integration**
- NCCN Templates cover chemotherapy and immunotherapy regimens, supportive care agents, monitoring parameters and safety instructions, with literature support. They are integrated into **Epic Beacon** and **Cerner PowerChart Oncology**, and CureMD is also listed. Licensing is directly with NCCN, and the integrated templates link back to NCCN.org. — [NCCN EHR Integration page](https://www.nccn.org/professionals/OrderTemplates/EHRintegration.aspx); [NCCN HIT](https://nccn.org/HIT)
- The Epic integration of the Templates into Beacon was announced in October 2014. — [Newswise 2014](https://www.newswise.com/articles/nccn-chemotherapy-order-templates-to-be-integrated-into-epic-s-electronic-health-record); [HC Innovation Group](https://www.hcinnovationgroup.com/finance-revenue-cycle/health-it-market/news/13024127/epic-to-integrate-with-network-of-cancer-centers)
- A third-party directory lists integrations with Flatiron OncoEMR and MEDITECH, and cites roughly $3,000 per year for enterprise EHR integration licensing. This is **unverified** and does not come from NCCN. — [IntuitionLabs](https://intuitionlabs.ai/software/chemotherapy-order-management-cpoe/regimen-libraries-and-protocols/nccn-templates)

**AI and LLM policy**
- **NCCN EULA:** it prohibits using NCCN content "as an input to developing, testing, or training" AI software or models unless NCCN agrees otherwise in writing, and it prohibits commercial use. — [NCCN End User License Agreement](https://www.nccn.org/end-user-license-agreement) (seen via search summary; direct fetch returned HTTP 403, so verbatim wording was not confirmed); also tracked at [tostracker NCCN EULA](https://tostracker.app/document/nccn-eula)
- **Guideline development:** NCCN policy prohibits using AI tools to develop or update clinical recommendations, and states that AI tools or agents do not meet NCCN criteria for authorship. — [NCCN Development and Update of Guidelines](https://www.nccn.org/guidelines/guidelines-process/development-and-update-of-guidelines)
- **Licensed AI distribution:** on November 5, 2025, NCCN and OpenEvidence announced a licensing collaboration to integrate the NCCN Guidelines and JNCCN content into OpenEvidence's clinician AI platform. NCCN content shown there follows NCCN QA review and links back to the source document. — [ASCO Post Nov 2025](https://ascopost.com/news/november-2025/nccn-guidelines-to-be-integrated-into-openevidence-medical-ai-platform/); [OpenEvidence announcement](https://www.openevidence.com/announcements/nccn-and-openevidence-collaborate-to-bring-clinical-oncology-guidelines-to-medical-ai); [NCCN news](https://www.nccn.org/home/news/newsdetails?NewsId=5283)
- JNCCN, the journal, requires authors to disclose AI use. — [JNCCN AI policy](https://jnccn.org/page/ai/use-of-artificial-intelligence-ai-tools)
- An open benchmark repository working with NCCN-derived decision items says it **does not redistribute** them because of NCCN copyright and license terms. This shows how the community handles the restriction in practice. — [github.com/dcszhang/Benchmark](https://github.com/dcszhang/Benchmark)

### Inferences
- Pre-structured NCCN algorithm data is not publicly available from NCCN. Anyone building a Navigator-like agent system has to parse the PDFs themselves. Under the EULA, using those PDFs as input to building or testing an AI system appears to need NCCN's written permission. The OpenEvidence deal shows NCCN does grant such licenses.
- The only licensable machine-readable NCCN data is the Compendium (drug, indication and category of evidence via XML/JSON API). It could serve as a structured backbone for regimen and indication checks, but it does not encode decision pathways.
- Navigator's "pathway highlighter" and linked footnotes match the target user experience. NCCN has signaled that it will add AI itself, which could compete with or overlap a home-built system.

### Gaps
- I could not fetch the verbatim EULA and Terms of Use text (HTTP 403). The report writer should flag the AI clause wording as summarized, not quoted.
- No primary source was found on NCCN partnerships with Elsevier ClinicalPath (formerly Via Oncology Pathways), Philips, Navigating Cancer, or Color. I also found no NCCN-authored FHIR, CQL or structured-guideline initiative.
- No public NCCN licensing fee schedule was found.

## Q2. Academic and commercial encodings of NCCN and comparable guidelines, and their validation

### Takeaway
The best-validated approaches are older rule-based or knowledge-based systems with long-term concordance data: OncoDoc2 (France, breast), with about 91% guideline compliance in routine tumor-board use and an RCT showing practice harmonization, and IBM Watson for Oncology, with 81.5% pooled tumor-board concordance across 2,463 patients but documented unsafe outputs and a commercial failure. Newer NCCN-to-graph and LLM/RAG efforts (2023–2026) report promising numbers on small vignette sets. None has prospective clinical validation.

### Cited Findings
**OncoDoc / OncoDoc2 (AP-HP Tenon, Paris; Séroussi and Bouaud), breast cancer guideline-based CDS [VALIDATED]**
- In 1,889 multidisciplinary tumor board (MTB) decisions from 2007–2009, guideline compliance was **91.0%**. Non-compliance came mainly from "MSM choices" (39.1%) and "particular cases" (34.9%). The authors concluded that 100% compliance is unreachable because some cases fall outside the guidelines. — [PMC3243232 (AMIA 2011)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3243232)
- In 1,624 invasive-cancer decisions, non-compliance was **8.3%**, and its associated factors were analyzed by multivariate logistic regression. — [Br J Cancer 2013](https://www.nature.com/articles/bjc2013453)
- About **91.7%** compliance after nearly three years of routine use, with pattern mining applied to non-compliance. — [PMC3540437 (AMIA 2012)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3540437)
- In an earlier uncontrolled before–after study, compliance rose from **79.2% to 93.4%**. The authors noted that causality could not be attributed to the system. A later RCT analysis found fewer non-compliance patterns in the intervention arm. — [PMC3778303](https://pmc.ncbi.nlm.nih.gov/articles/PMC3778303); [HAL 01238059](https://hal.archives-ouvertes.fr/hal-01238059)
- Note: the cohorts appear to overlap. Figures come from abstracts and summaries.

**IBM Watson for Oncology (WFO; MSK-trained) [VALIDATED concordance; documented failure]**
- Manipal, India breast cancer study, n=638: **90%** concordance with the MTB at the "recommended/for consideration" level. Concordance was 46% for metastatic disease, 79% for non-metastatic, 35% for HER2-negative and 68% for triple-negative. When WFO and the MTB disagreed, the board changed its decision 63% of the time after review. — [Somashekhar et al., Ann Oncol 2018](https://academic.oup.com/annonc/article/29/2/418/4781689); [OncLive SABCS 2016](https://www.onclive.com/view/ibms-watson-achieves-high-concordance-in-tumor-board-test)
- Other cohorts: Bangkok 83%. Korea colon 73% but gastric 43%, which was attributed to Korean versus US guideline differences. China postoperative colorectal therapy: rectal 74%, colon 64%, gastric 12%. — [Healio](https://www.healio.com/news/hematology-oncology/20170120/ibm-watson-for-oncology-platform-highly-concordant-with-physician-recommendations); [pharmaphorum](https://pharmaphorum.com/news/ibm-watson-asco-high-concordance); [Frontiers Oncol 2020](https://www.frontiersin.org/journals/oncology/articles/10.3389/fonc.2020.595565/pdf); [PMC6433269](https://pmc.ncbi.nlm.nih.gov/articles/PMC6433269)
- Meta-analysis (Zhou, Zeng, Li; Sci Rep 2021): 9 studies, 2,463 patients, **pooled concordance 81.52%**. Concordance was highest in breast and lowest in gastric, and higher in stage I–III than stage IV, except in lung. Registered in PROSPERO (CRD42020199418). — [PMC7952578](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7952578/)
- Failure: internal IBM documents from 2017, reported by STAT in July 2018, showed "unsafe and incorrect" recommendations. One example was bevacizumab recommended for a lung cancer patient with severe bleeding, against the drug's black-box warning; MSK said this was a test case. The system was trained on **synthetic/hypothetical cases** reflecting one or two MSK specialists per cancer type rather than guidelines or evidence. A hospital physician said they "can't use it for most cases". — [STAT News 2018](https://www.statnews.com/2018/07/25/ibm-watson-recommended-unsafe-incorrect-treatments/); [MassDevice](https://www.massdevice.com/report-ibm-watson-delivered-unsafe-and-inaccurate-cancer-recommendations/); [AI Incident Database](https://incidentdatabase.ai/ja/reports/1739)

**Chinese CSCO-guideline CDS ("CSCO AI") [VALIDATED, but numbers not retrieved]**
- A retrospective study from Anhui Medical University (Breast Cancer: Targets and Therapy, July 2024) assessed concordance of CSCO AI, described as a CDSS developed on Chinese breast cancer data, with MDT decisions. I did not retrieve the concordance percentages. — [DOAJ record](https://doaj.org/article/13174793df44417c80c9b49db5ef5d3f); [Dove Press PDF](https://dovepress.com/article/download/94588)
- In a 2023 Frontiers in Oncology study on early breast cancer, a CDSS and a guideline expert group independently produced recommendations for randomly assigned cases, which were compared with physician panels. — [Frontiers Oncol 2023](https://www.frontiersin.org/journals/oncology/articles/10.3389/fonc.2023.1152013/full)
- A review reported higher CDSS–MTB concordance than clinician–MTB concordance, and higher concordance in an Indian tertiary-center study than in comparable Chinese studies. — [Research Square rs-101188](https://researchsquare.com/article/rs-101188/v1)
- The CSCO breast guidelines are stratified by resource availability, which makes them a useful model for encoding resource-tiered recommendations. — [TBCR appraisal](https://tbcr.amegroups.org/article/view/45811/html)

**Academic NCCN knowledge-graph encodings [PRELIM]**
- *Automated Knowledge Modeling for Cancer CPGs* (arXiv 2307.10231): extracted the NCCN NSCLC v1.2022 treatment flow, **914 nodes**, into JSON-LD and loaded it into Neo4j for visual validation. Node classification accuracy was **0.81** (10-fold cross-validation). UMLS/NCIt concept mapping was error-prone because of substring matching and use of the first API result. — [arXiv 2307.10231](https://arxiv.org/pdf/2307.10231)
- *Decision Knowledge Graphs … QA for CPGs* (arXiv 2308.02984), and *Knowledge Models for Cancer CPGs: Construction, Management and Usage in QA* (arXiv 2407.21053): extended to four cancer types, with version-diff of graphs across guideline updates. QA accuracy on 32 question–answer pairs was **54.5%** for treatment-algorithm questions and **81.8%** for discussion-section questions. — [arXiv 2308.02984](https://arxiv.org/pdf/2308.02984); [arXiv 2407.21053](https://arxiv.org/pdf/2407.21053)
- arXiv 2501.13984: LLM node classification on NCCN guideline graphs reached **80.86%** accuracy zero-shot and **88.47%** few-shot. — [arXiv 2501.13984](https://arxiv.org/abs/2501.13984v1)
- *OncoPath* (Neuro-Oncology 2024 abstract, Henry Ford): overlays longitudinal data from 44 glioma patients onto NCCN-based graphs in a dashboard. No outcome validation was found. — [Henry Ford Scholarly Commons](https://scholarlycommons.henryford.com/neurology_mtgabstracts/194)
- *Guideline2Graph* (arXiv 2604.02477, April 2026): profile-aware multimodal parsing of long guidelines into **executable clinical decision graphs** using topology-aware chunking, interface-constrained chunk-graph generation, and provenance-preserving aggregation. No code link was found. — [arXiv 2604.02477](https://arxiv.org/pdf/2604.02477v1); [alphaXiv](https://www.alphaxiv.org/abs/2604.02477)
- *MedDM* (arXiv 2312.02441): defines an LLM-executable "clinical guidance tree" format that converts guideline flowcharts into standardized decision trees. It is not NCCN-specific, but it is a candidate schema reference. — [arXiv 2312.02441](https://arxiv.org/abs/2312.02441?context=cs)

**LLM agents and RAG over NCCN [PRELIM]**
- *CancerGUIDE* (Microsoft Research et al., NeurIPS 2025): an LLM agent that generates **NCCN-concordant NSCLC treatment trajectories**, with 121 expert-annotated cases labeled by board-certified oncologists. LLM-generated proxy benchmarks correlated with expert benchmarks at Spearman 0.88 (RMSE 0.08). A meta-classifier for confidence reached AUROC **0.800**; one summary of a later version reports 0.804. — [arXiv 2509.07325](https://arxiv.org/abs/2509.07325v1); [NeurIPS 2025](https://neurips.cc/virtual/2025/124912); [Microsoft Research](https://www.microsoft.com/en-us/research/?p=1149993)
- *AI Tool for Personalized Breast Cancer Plans based on NCCN* (Mohammed et al., arXiv 2502.15698): NCCN breast content converted to **JSON**, then Agentic-RAG and Graph-RAG built on top. Guideline adherence was **24/24 (100%)** for Agentic-RAG, **23/24 (95.8%)** for Graph-RAG and **22/24 (91.6%)** for ChatGPT-4. The evaluation is very small and no code was found. — [arXiv 2502.15698](https://arxiv.org/abs/2502.15698)
- RAG-GPT-4 over the 2025 NCCN breast guidelines, 40 vignettes, two blinded reviewers scoring concordance and hallucination (AACR/SABCS abstract). — [Clin Cancer Res Suppl PS3-06-29](https://aacrjournals.org/clincancerres/article/32/4_Supplement/PS3-06-29/773515/Abstract-PS3-06-29-Retrieval-augmented-GPT-4)
- RAG-GPT-4 for NCCN lymphoma, 50 vignettes, one scorer: mean score **0.32 vs 0.10** for baseline GPT-4 (p=0.038). — [Blood 2025 Suppl 1, 7914](https://ashpublications.org/blood/article/146/Supplement%201/7914/550031/Retrieval-Augmented-GPT-4-Improves-NCCN-Concordant)
- *MEREDITH* (JCO Precision Oncology): a Gemini Pro RAG system with expert guidance reached **94.7%** concordance with expert recommendations, but on only 10 fictional patients. — [JCO PO-24-00478](https://ascopubs.org/doi/10.1200/PO-24-00478)
- LLM benchmarking against breast MTB decisions: about **76–79%** concordance. The board was treated as an institutional reference, not a gold standard. — [BMC Med Inform Decis Mak 2026](https://link.springer.com/article/10.1186/s12911-026-03556-4)
- RAG over urologic guidelines: a PSA-testing tool was concordant in 95.5% of cases (210/220) versus 62.3% for junior clinicians (EAU/AUA, not NCCN). — [JMIR 2025 e78393](https://www.jmir.org/2025/1/e78393); [PMC11771495, urologic oncology RAG](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11771495/)
- ChatGPT-4 and Llama 2 compared against NCCN thyroid carcinoma guidelines. — [Pandya et al., Am Surg 2025](https://journals.sagepub.com/doi/abs/10.1177/00031348241269430)

### Inferences
- The graph-based pathway representation (JSON-LD or Neo4j nodes for decision, recommendation and footnote, plus edges for conditions) in the arXiv 2307.10231, 2308.02984 and 2407.21053 series is the closest published precedent to an LLM-traversable Navigator. Its own evaluation shows that concept normalization to NCIt/UMLS is the weak link.
- Agentic traversal (CancerGUIDE) with calibrated confidence and abstention is the strongest recent design pattern for "guideline-concordant trajectory" generation. Its validation is still offline and limited to NSCLC.
- Concordance numbers are not comparable across studies. References differ (NCCN text, tumor board, or individual experts), as do sample sizes (10 to 2,463) and scoring ("recommended" vs "for consideration" tiers).

### Gaps
- I found no published validated MSK or MD Anderson rule-based NCCN engine apart from WFO. MDACC's Watson project (the OEA) was not researched in this pass.
- I found no peer-reviewed prospective outcome study (survival, toxicity) for any NCCN-encoded CDS.
- The concordance figures for CSCO AI and the full validation of commercial pathway systems (Elsevier ClinicalPath/Via, Philips) were not retrieved.

## Q3. Open-source repositories that structure NCCN algorithms

### Takeaway
No public, maintained repository was found that redistributes NCCN algorithms as JSON or graphs. The license appears to prevent this, and at least one repository explicitly withholds NCCN-derived items. Reusable artifacts are methods and schemas from papers (JSON-LD/Neo4j, clinical guidance tree, Guideline2Graph), not NCCN content.

### Cited Findings
- `dcszhang/Benchmark` has pipelines that turn guideline workspaces into structured decision items, but its README says NCCN-derived items are **not redistributed** because of NCCN copyright and license terms. — [GitHub dcszhang/Benchmark](https://github.com/dcszhang/Benchmark)
- `SS12dev/policy-processor` is a LangGraph pipeline that turns policy documents into conditional decision trees. It is not medical but is structurally analogous. — [GitHub policy-processor](https://github.com/SS12dev/policy-processor)
- The NCCN NSCLC JSON-LD and Neo4j graph method is described in an arXiv paper. Public release of the graph was not confirmed. — [arXiv 2307.10231](https://arxiv.org/pdf/2307.10231)
- A CEUR-WS workshop paper on guideline-to-graph extraction appeared in the results. Details were not reviewed. — [CEUR-WS Vol-4001 paper3](https://ceur-ws.org/Vol-4001/paper3.pdf)

### Inferences
- The user will need to build the graph from their own PDFs. They should keep derived NCCN content private or obtain a license, and publish only schema and code, which mirrors dcszhang/Benchmark's practice.

### Gaps
- A direct GitHub code search for "NCCN" with flowchart, decision tree or knowledge graph was not run, because GitHub MCP was unavailable. Smaller hobby repositories may exist.

## Q4. Precision-oncology knowledge bases with guideline-level evidence

### Takeaway
OncoKB is the reference example. Its Levels 1 and 2 explicitly encode FDA-approved and **NCCN-listed** biomarker–drug pairs. Part of OncoKB received FDA recognition in October 2021, the first somatic variant database to do so. It is updated monthly. It is a strong structured complement for biomarker nodes in NCCN pathways, subject to MSK licensing.

### Cited Findings
- OncoKB's therapeutic levels: Level 1 covers FDA-recognized biomarkers for FDA-approved drugs, Level 2 covers standard-care biomarkers including **NCCN-guideline-listed** ones, and Levels 3 and 4 are investigational. Curation sources include FDA labels, NCCN guidelines and the literature. — [MSK OncoKB](https://mskcc.org/research-advantage/support/digital-health-projects/oncokb); [ESMO news](https://esmo.org/oncology-news/fda-recognises-oncokb-database-of-molecular-tumour-marker-information)
- FDA partially recognized OncoKB in October 2021, the first somatic variant database to receive recognition. The recognized "FDA-recognized" tab uses FDA Levels 2 and 3 to support clinical validity claims for NGS tests. This scale is distinct from OncoKB's therapeutic levels. — [FDA decision summary](https://fda.gov/media/152847/download); [MSK press release](https://mskcc.org/news-releases/fda-grants-partial-recognition-status-mskcc-precision-oncology-knowledge-database); [ASCO Post](https://ascopost.com/news/october-2021/fda-recognizes-memorial-sloan-kettering-database-of-molecular-tumor-marker-information)
- OncoKB levels align 1:1 with the AMP/ASCO/CAP tiers, updates are monthly, and FDA approvals are prioritized. — [Targeted Oncology](https://targetedonc.com/view/new-fda-recognized-msk-database-makes-5600-mutations-searchable-to-researchers); [AMP](https://shop.amp.org/amp-horizons-somatic-variant-curation-using-oncokb-an-fda-recognized-precision-oncology-knowledge-base)

### Inferences
- Biomarker-gated nodes in NCCN pathways, such as an EGFR or ALK branch, could link to OncoKB Level 1 and 2 entries for cross-validation. This would give a second, FDA-recognized check on targeted-therapy branches.

### Gaps
- CIViC, CGI, My Cancer Genome and PMKB licensing and validation were **not researched in this pass**. The same applies to OncoKB's current licensing terms (free for academic use versus commercial license), mCODE, OncoTree and NCIt use for NCCN node normalization. Treat these as open items needing sourcing.

## Q5. Lessons from failures (IBM Watson for Oncology) for validation

### Takeaway
WFO showed that high headline concordance with one institution's tumor board does not establish safety or generalizability. Training on synthetic cases and a few experts' preferences produced unsafe outputs, and concordance fell sharply outside the US guideline context and in metastatic disease.

### Cited Findings
- Recommendations were based on hypothetical cases and one or two MSK physicians per cancer type, not on guidelines or real-world evidence. This led to "unsafe and incorrect" recommendations, including one contradicting a black-box warning. — [STAT 2018](https://www.statnews.com/2018/07/25/ibm-watson-recommended-unsafe-incorrect-treatments/); [MassDevice](https://www.massdevice.com/report-ibm-watson-delivered-unsafe-and-inaccurate-cancer-recommendations/)
- Concordance depended on local guidelines: gastric cancer was 43% in Korea and 12% in China, against colon 64–73%. — [Healio](https://www.healio.com/news/hematology-oncology/20170120/ibm-watson-for-oncology-platform-highly-concordant-with-physician-recommendations); [Frontiers Oncol 2020](https://www.frontiersin.org/journals/oncology/articles/10.3389/fonc.2020.595565/pdf)
- Concordance was lowest in metastatic and complex disease: 46% for metastatic versus 79% for non-metastatic breast cancer. — [Ann Oncol 2018](https://academic.oup.com/annonc/article/29/2/418/4781689)
- The pooled meta-analysis showed stage-dependent and cancer-type-dependent heterogeneity. — [Sci Rep 2021 / PMC7952578](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7952578/)
- OncoDoc's authors argue that full compliance is unattainable and that out-of-guideline "particular cases" are an inherent category. A CDS should flag and support these cases rather than force a recommendation. — [PMC3243232](https://pmc.ncbi.nlm.nih.gov/articles/PMC3243232)

### Inferences (not directly stated by sources)
- Ground recommendations in the published guideline text with node-level provenance, so that every recommendation cites an NCCN page or node ID and footnote. Do not ground them in expert-preference training.
- Validate on real, consecutive patient cases against guideline adjudication, not only against one tumor board. Stratify by stage and metastatic status, and report safety errors (contraindications, hallucinations) separately from concordance.
- Build in abstention and confidence estimation (as in CancerGUIDE's meta-classifier) and an explicit "outside guideline / clinical trial / particular case" exit node.
- Track guideline versions with graph diffs (as in arXiv 2407.21053), because NCCN updates often and stale content was a WFO criticism.

### Gaps
- No formal IBM or MSK post-mortem was found. The lessons above are synthesized from press reports and concordance studies.
