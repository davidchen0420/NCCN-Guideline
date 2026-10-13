# Assemble a validated NCCN navigator from parts

No open-source, peer-reviewed, clinically validated tool takes NCCN PDFs and produces a machine-readable pathway that an LLM agent can traverse for guideline-concordant care. The pieces exist but sit at different evidence levels and have not been assembled. **Extraction** has one NCCN-specific line of work: the IIT Madras vector-PDF parser, roughly peer-reviewed at IEEE EMBC 2023 with no released code. **Representation** has mature, maintained, open standards (HL7 CQL with the FHIR Clinical Practice Guidelines IG, mCODE) but no published NCCN encoding in them. **Traversal** has strong design patterns from a NeurIPS 2025 NCCN benchmark (CancerGUIDE) and a hematology agent with external validation (HemaGuide). **Validation** is the most mature layer, with reusable protocols and reporting standards. The only guideline-concordance evidence from routine clinical use comes from pre-LLM systems: OncoDoc2, which encodes French breast-cancer guidelines (not NCCN) and reached about 91% tumor-board compliance, and IBM Watson for Oncology, a cautionary case. Before any technical work there is a legal gate. **NCCN's End-User License Agreement prohibits processing NCCN content into derivative works and using it "as an input to … development, testing, training" of AI without NCCN's written agreement.** NCCN does sell such licenses (OpenEvidence, Nov 2025; Viz.ai, Jan 2026), so the realistic route is a written research or evaluation license from NCCN. The best-supported plan reuses published pieces at each layer. LLMs should be used where the evidence supports them: semantic labeling, local branch decisions and error flagging. They should not be used as end-to-end converters.

Evidence labels used throughout: **[PR-validated]** means peer-reviewed with quantitative evaluation against experts or a gold standard. **[PR-described]** means a peer-reviewed or official specification without outcome numbers. **[Preprint]** means arXiv or medRxiv only, or a conference abstract. **[Vendor/press]** means company or news reporting.

## NCCN's license blocks this build until NCCN grants written permission

This constraint comes before every technical choice. The NCCN EULA grants a personal license that is "internal, lawful, non-commercial" and "solely for your own educational or informational purposes." Unless NCCN agrees otherwise in writing, it bars users from the following ([NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula)):

- §3(A)(a): to "copy, transfer, distribute, make available, reproduce, scrape, **digest, process, modify or create derivative works** of any part of the NCCN Content";
- §3(A)(b): to use it "**as an input to, or in connection with any development, testing, training**" of AI software or models;
- §3(A)(c): to use it for any commercial purpose or on behalf of a third party.

Under §2, NCCN also claims ownership of "all modifications … and derivative works," so a JSON graph you build yourself would arguably belong to NCCN. The project as described would turn the PDFs into a graph, feed that graph to LLM agents, and test the agents against it. Each of those three steps falls within the prohibited acts, and the EULA text contains no research exception. One caveat on sourcing: nccn.org blocked automated fetches, so the clause text was read from a third-party archive captured in August 2026, and the AI clause was truncated there. Read the full clause on nccn.org before relying on its exact wording.

NCCN does license content for AI use; it does so selectively and under quality control. On 5–7 November 2025, NCCN and OpenEvidence announced a license to integrate the NCCN Guidelines and JNCCN content into OpenEvidence's LLM platform, subject to "NCCN's evidence and quality control review" and with links back to source ([ASCO Post](https://ascopost.com/news/november-2025/nccn-guidelines-to-be-integrated-into-openevidence-medical-ai-platform/); [OpenEvidence](https://www.openevidence.com/announcements/nccn-and-openevidence-collaborate-to-bring-clinical-oncology-guidelines-to-medical-ai)). In January 2026, Viz.ai announced integration of the Breast, Prostate and Bladder guidelines into its oncology platform ([Business Wire](https://www.businesswire.com/news/home/20260108401134/en/Viz.ai-and-NCCN-Collaborate-to-Integrate-NCCN-Guidelines-into-Clinical-Workflows-for-Oncologists)).

The EULA (§12(F)) names the licensing route: the **NCCN Permissions request site (nccn.org/about/permissions)** and NCCN's Vice President of U.S. and Global Business Development ([NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula)). No public research-license fee schedule was found.

NCCN's own machine-readable products narrow what you have to build, but they do not remove the need to parse. NCCN licenses the Guidelines themselves **as PDF only, with no API**. The **Drugs & Biologics Compendium** is licensable as XML/JSON through an API, and the **Biomarkers Compendium** also has an API option ([NCCN Developer API](https://nccn.org/developer-api)). NCCN launched the **Guidelines Navigator** in June 2025. It offers a pathway highlighter and footnotes linked from nodes, is limited to non-commercial use, and has no data export. NCCN has said it plans to add "artificial intelligence capabilities" ([ASCO Post](https://ascopost.com/news/june-2025/national-comprehensive-cancer-network-launches-nccn-guidelines-navigator/)). A home-built navigator could therefore overlap with a product NCCN is building itself.

The community already works around the restriction. A public benchmark repository explicitly **does not redistribute** its NCCN-derived decision items ([dcszhang/Benchmark](https://github.com/dcszhang/Benchmark)). No public NCCN graph dataset was found anywhere. Publishing the schema and code while keeping NCCN-derived content private is the established norm. Under §3(A)(b), however, even private use still needs permission. NCCN's guideline-process policy also bars using AI to develop or update NCCN recommendations ([NCCN guidelines process](https://www.nccn.org/guidelines/guidelines-process/development-and-update-of-guidelines)). That policy constrains NCCN's own authoring, not downstream tools, but it signals how NCCN views the issue.

## A pre-LLM decision-tree system holds the best clinical evidence

The question asks for validated prior work, and the honest answer is that **the strongest evidence for encoded oncology guidelines predates LLMs and is not NCCN.** OncoDoc and OncoDoc2, built by Séroussi and Bouaud at AP-HP, encode French breast-cancer guidelines as decision trees. The clinician navigates them during multidisciplinary tumor board meetings.

- **Before-after studies [PR-validated].** Compliance rose from **61% to 85%** with OncoDoc (127 decisions) and from **79.2% to 93.4%** with OncoDoc2 (n=316). Neither study had a control arm ([Klarenbeek 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7226340/); [PubMed 18693918](https://pubmed.ncbi.nlm.nih.gov/18693918/)).
- **Routine use [PR-validated].** Over 1,889 decisions, compliance held at **91.0%** ([PMC3243232](https://pmc.ncbi.nlm.nih.gov/articles/PMC3243232)).
- **Randomized trial.** NCT00728442 ran from 2008 to 2010, and a later analysis reported fewer non-compliance patterns in the intervention arm ([HAL 01238059](https://hal.archives-ouvertes.fr/hal-01238059)).
- **Navigation quality [PR-validated].** In 557 decisions, compliance was **94.2% when clinicians navigated the tree correctly and 80.0% when they navigated it incorrectly** ([PMC3778303](https://pmc.ncbi.nlm.nih.gov/articles/PMC3778303)).

The navigation result matters most for the LLM design. Errors in abstracting the patient's state into tree branches cost about 14 points of concordance even with a perfect encoding, and an LLM agent that traverses the tree performs exactly that abstraction step. The OncoDoc authors also found that about a third of residual non-compliance came from "particular cases" outside the guideline's coverage. They concluded that 100% compliance cannot be reached ([PMC3243232](https://pmc.ncbi.nlm.nih.gov/articles/PMC3243232)).

The wider oncology CDSS literature is thin. A 2020 systematic review found 9 before-after studies covering 7,985 patients and no RCT. Higher-level CDSS improved adherence but showed no clinical-outcome benefit, and the evidence was rated **GRADE low to very low** ([Klarenbeek 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7226340/)). Commercial NCCN-aligned pathway programs report lower costs at similar survival, but they use proprietary encodings and are not reusable. Examples include Dana-Farber pathways in NSCLC (1-year cost $69,122 vs $52,037) and US Oncology Value Pathways (19% lower cost) ([HMP JCP](https://www.hmpgloballearningnetwork.com/site/jcp/article/treatment-pathways-first-line-metastatic-non-small-cell-lung-cancer-cost-and-survival)).

IBM Watson for Oncology shows what headline concordance hides. A meta-analysis of 2,463 patients found **81.5% pooled concordance** ([PMC7952578](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7952578/)). In the Manipal study, concordance fell to **46% in metastatic breast cancer** ([Ann Oncol 2018](https://academic.oup.com/annonc/article/29/2/418/4781689)). Internal documents showed "unsafe and incorrect" recommendations from a system trained on synthetic cases reflecting a few experts' preferences rather than guideline text ([STAT 2018](https://www.statnews.com/2018/07/25/ibm-watson-recommended-unsafe-incorrect-treatments/)). The lesson for design: ground every recommendation in node-level provenance from the guideline itself, and validate stratified by stage.

## Vector-PDF parsing, not vision models, is the validated extraction route

Converting NCCN flowchart pages into a graph is the least mature layer. The main difficulty is recovering arrows.

General vision-language models are poor at this. On the FlowLearn benchmark, link-level F1 was about **0.30 for Claude-3 Opus and 0.22 for GPT-4V** ([FlowLearn, ECAI 2024](https://www.cs.uic.edu/~cornelia/papers/2024.ECAI.pdf); figures as cited in [arXiv 2505.07864](https://arxiv.org/html/2505.07864)). Even a dedicated arrow detector reaches only 0.235 mAP on arrow classes, against 0.653 for other elements ([arXiv 2505.07864](https://arxiv.org/html/2505.07864)). Generic PDF parsers such as MinerU, Docling and Marker are benchmarked on layout and text, not on flowchart topology ([OmniDocBench, CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/papers/Ouyang_OmniDocBench_Benchmarking_Diverse_PDF_Document_Parsing_with_Comprehensive_Annotations_CVPR_2025_paper.pdf)).

NCCN PDFs are vector documents, and that offers a way around the problem. The **IIT Madras (HTIC) group of Ta, Gupta, Ram and Sivaprakasam** reads the PDF object model directly: text boxes, line and arrow paths, and hyperlinks. Raster images are never involved.

| Paper | Status | What it reports |
|---|---|---|
| Ta et al., arXiv 2307.10231 | Likely peer-reviewed at IEEE EMBC 2023 ([PubMed 38082992](https://pubmed.ncbi.nlm.nih.gov/38082992/)) | Extracted the NCCN NSCLC v1.2022 treatment flow (**914 nodes**) into JSON-LD and Neo4j, tested on two guideline versions. Node classification accuracy was 0.81 ([arXiv](https://arxiv.org/pdf/2307.10231)). |
| Ta, Gupta et al., arXiv 2407.21053 | [Preprint] | Handles fan-out, multi-segment and chained edges. Covers four cancers. Adds a **version-diff algorithm** that flags treatment changes between NCCN releases ([arXiv](https://arxiv.org/abs/2407.21053v1)). |
| Gupta, Ta et al., arXiv 2501.13984 | [Preprint], related to IEEE CIBCB 2024 | LLM node classification reaches 80.86% zero-shot and 88.47% few-shot ([arXiv](https://arxiv.org/abs/2501.13984)). An external referee summary disputes two of its central claims ([Pith](https://pith.science/paper/2501.13984)). |

The gap is significant. **No edge-level precision or recall is published** for this parser, NCIt/UMLS concept mapping was error-prone, and no code is released.

The other NCCN graph efforts are all preprints:

- **Guideline2Graph** ([arXiv 2604.02477](https://arxiv.org/html/2604.02477v1), Apr 2026 [Preprint]) uses VLM chunk-level generation, then a provenance-preserving merge, on NCCN Prostate v4.2024. Against an adjudicated gold graph it reached **node precision/recall of 57.7%/93.8% and edge precision/recall of 69.0%/87.5%**. That clearly beats AutoKG (edge P/R 19.6%/16.1%), but it was tested on one guideline with only 32 gold nodes, and no code was found.
- The **IIT Bombay Decision Knowledge Graph** ([arXiv 2308.02984](https://arxiv.org/html/2308.02984) [Preprint]) built graphs from NCCN ALL, Bone and Kidney guidelines. It shows how to inline footnotes and resolve hyperlinks, but reports no graph-fidelity metric.

Generic LLM text-to-tree work sets a sobering ceiling. On Text2MDT, a Chinese benchmark of trees averaging about 4 nodes, the best model reproduced only **49% of trees exactly**, with decision-path F1 of 0.632 ([arXiv 2401.02034](https://arxiv.org/html/2401.02034v1) [Preprint; the CHIP-2022 shared-task overview is [PR-described](https://link.springer.com/chapter/10.1007/978-981-99-4826-0_9)]). NCCN pages are far larger. **Fully automated extraction should be assumed to need human correction.**

Two-stage "image to textual graph, then reason" methods beat end-to-end prompting. **TEXTUALIZER/TextFlow** (NAACL 2025 [PR-validated]) converts the flowchart to Mermaid or Graphviz first and reached 82.7% on FlowVQA with Claude 3.5 Sonnet ([ACL Anthology](https://aclanthology.org/2025.naacl-long.180.pdf)). This supports a hybrid design:

1. deterministic vector extraction of boxes and arrows (IIT Madras approach);
2. an LLM or VLM pass to assign node semantics, disambiguate edge labels, and cross-check the vector result against the page image (Guideline2Graph-style, with chunking and provenance);
3. human adjudication.

## Open standards are mature, but nobody has encoded NCCN in them

Two credible targets exist for representing the extracted pathways, and they serve different purposes.

**The interoperable, maintained standard stack** is HL7 CQL with the FHIR Clinical Practice Guidelines IG (CPG-on-FHIR, STU2 2.0.0, November 2024). Guidelines are expressed there as `PlanDefinition` action trees with CQL conditions ([HL7 CPG IG](https://hl7.org/fhir/uv/cpg/index.html)). Patient data come from **mCODE**, the HL7 oncology profile set ([mCODE IG](https://build.fhir.org/ig/HL7/fhir-mCODE-ig/index.html)). Versioning follows **CRMI**: draft → active → retired, content frozen once active, semantic versions required ([HL7 CRMI](https://hl7.org/fhir/uv/crmi/en/artifact-lifecycle.html)). All of these are [PR-described] specifications. None has published encoding-fidelity numbers for oncology. The only open-source oncology pathway engine found is **MITRE's Camino (`mcode/pathways`, Apache-2.0)**, a SMART-on-FHIR prototype that runs CQL pathways over mCODE data. It has no published validation and no NCCN content ([GitHub](https://github.com/mcode/pathways)).

The literature names two costs:

- **Data-element binding** is "the biggest challenge" ([BPMN/DMN study, PMC6924335](https://pmc.ncbi.nlm.nih.gov/articles/PMC6924335)).
- **Expert CQL authoring is expensive.** CAREPATH needed experts to co-author 296 rules ([PathWISE arXiv 2605.25970](https://arxiv.org/pdf/2605.25970)).

FHIR also cannot express everything that executing a recommendation requires ([JBI 2023](https://www.sciencedirect.com/science/article/pii/S1532046423000266)). No peer-reviewed study evaluates LLM generation of CQL or PlanDefinition. PathWISE [Preprint, May 2026] reports **100% CQL compile success** on five NHS cancer pathways, but compiling is a structural check, not a clinical one.

The older academic computer-interpretable guideline (CIG) languages (GLIF, PROforma, Asbru, SAGE, EON, GUIDE) are effectively orphaned. They were compared in [Peleg 2003](https://pmc.ncbi.nlm.nih.gov/articles/PMC150359) and reviewed in [Peleg 2013](https://cris.haifa.ac.il/en/publications/computer-interpretable-clinical-guidelines-a-methodological-revie/). openEHR **GDL2** is maintained and has one RCT-validated non-oncology app, but its ecosystem is small ([openEHR](https://openehr.org/news_events/releases/273)). WHO SMART Guidelines provides a useful method: narrative, then decision tables (L2), then FHIR/CQL (L3). No oncology adaptation kit exists ([WHO SMART Base](https://build.fhir.org/ig/WorldHealthOrganization/smart-base/index.html)).

**The LLM-native graph representation** is what every NCCN extraction and traversal study actually uses. It is a JSON or JSON-LD node/edge graph, sometimes loaded into Neo4j, with typed condition and decision nodes. Published schemas worth reusing:

- **Text2MDT** triplet-plus-logic nodes ([arXiv 2401.02034](https://arxiv.org/html/2401.02034v1));
- **MedDM's** "LLM-executable clinical guidance tree," with 1,202 trees but no fidelity metric ([arXiv 2312.02441](https://arxiv.org/abs/2312.02441));
- **CPGPrompt's** Simple Feature Check and Multi-Criteria Check nodes, with released code ([GitHub](https://github.com/bionlplab/CPGPrompt));
- the **IIT Madras** JSON-LD model.

Pre-LLM GEM XML ([Shiffman, JAMIA 2000](https://pmc.ncbi.nlm.nih.gov/articles/PMC516249)) is still a useful source of element names for decision tables and condition-action typing.

A third option is the most rigorously validated route from LLM to executable logic, but it is not a standard. Imperial College converted NICE cancer guidelines (NG12, NG85, NG122) into **Answer Set Programming** with Claude Opus 4.5 and executed them in the Clingo solver ([Learning Health Systems 2026, PMC13475280](https://pmc.ncbi.nlm.nih.gov/articles/PMC13475280/) [PR-validated]):

- Three clinicians rated each rule (κ 0.716–0.857).
- Vignette execution reached precision 0.894, recall 0.766 and F1 0.825.
- **Omissions, not hallucinations**, were the dominant error.
- The authors judge it "not yet ready for direct clinical integration."

Neither format needs to be chosen exclusively. NCCN algorithms are multi-branch flowcharts with footnotes, evidence categories (2A/2B), preference tiers and "consider" options. That structure maps onto a typed graph as the working substrate. Footnotes and categories belong in annotations, not logic. Each node gets a stable ID made of the NCCN page code plus a content hash, versioned under CRMI conventions. A CQL/PlanDefinition export becomes worthwhile only if EHR execution is later required.

## Traversal works best as constrained node-by-node decisions with abstention

Three findings shape how an LLM agent should walk the graph.

**First, unconstrained LLMs add incorrect options alongside correct ones.** In Chen et al. (JAMA Oncology 2023 [PR-validated]), 98% of GPT-3.5 outputs contained at least one NCCN-concordant treatment. However, **34.3% also contained non-concordant treatments and 12.5% contained hallucinated ones**, and the three oncologist raters fully agreed on only 61.9% of scores ([JAMA Oncol](https://jamanetwork.com/journals/jamaoncology/fullarticle/2808731)). In head and neck cancer, models matched tumor boards on curative versus palliative intent 84–92% of the time but on the full first-line regimen only 48–52% ([PMC11890241](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11890241/) [PR-validated]). This favors stepwise, constrained node decisions over free-text generation of regimens.

**Second, retrieval grounding helps, but not enough on its own.** Peer-reviewed results:

| Study | Setting | Result |
|---|---|---|
| NCCN-anchored RAG, JMIR AI 2026 | GPT-5, gynecologic oncology, n=50 | Score **0.83 vs 0.65** without retrieval ([JMIR AI](https://ai.jmir.org/2026/1/e93239/PDF)) |
| Ferber et al., Nature Cancer 2025 | Tool-using GPT-4 agent, 20 cases, NCCN not in its corpus | **91.0% correct statements**, completeness 87.2% vs 30.3%, but **2.4% potentially harmful statements and only 75.5% correct citations** ([PMC12380607](https://pmc.ncbi.nlm.nih.gov/articles/12380607/); [code](https://github.com/Dyke-F/LLM_RAG_Agent)) |

A JCO 2026 abstract covering 186 vignettes concludes that retrieval is "insufficient in complex solid tumor settings" and that fluent output masks failures that matter for safety ([JCO suppl](https://www.citedrive.com/en/discovery/disease-specific-safety-risks-in-oncology-large-language-models-a-multi-axis-evaluation-across-solid-tumor-subtypes/) [Preprint/abstract]). A navigator should therefore cite deterministic node IDs (page and footnote codes) rather than whatever passages retrieval returns.

**Third, explicit traversal is feasible and auditable, but nobody has shown it is more accurate than RAG.** Two systems map most closely onto the user's goal:

- **CancerGUIDE** (Microsoft Research/Stanford, NeurIPS 2025; [arXiv 2509.07325](https://arxiv.org/html/2509.07325v2)) predicts the **NCCN NSCLC path itself**. Its data are 121 notes annotated by 13 oncologists, covering 82 distinct paths.
  - **The expert ceiling is low.** Inter-annotator agreement was 0.692 on path overlap and 0.636 on treatment match.
  - Frontier models covered about half the path.
  - Self- and cross-model consistency proxies correlated with expert benchmarks (Spearman 0.88).
  - A meta-classifier flagged wrong recommendations at AUROC about 0.80.
- **HemaGuide** (DKFZ/Heidelberg, 2026 [PR, venue unconfirmed]) grounds an agent in guideline flowcharts plus a memory of over 2,000 tumor-board cases, routing each case to a guideline, advanced or molecular mode.
  - External validation: about **82% agreement with expert panels on 555 cases** across 47 blood cancers.
  - A one-month **silent prospective run** reached about 83%.
  - Its 11-layer ablation found no single component sufficient across case types ([DKFZ record](https://inrepo02.dkfz.de/record/313892); [MDLinx](https://www.mdlinx.com/news/new-ai-system-provides-treatment-recommendations-for-complex-blood-cancers/3POW9lAOCvngJgujoLYLkw)).
  - How it encodes flowcharts is not publicly described.

Smaller preprints point the same way. **CPGPrompt** traverses JSON trees with logged yes/no questions. Binary referral F1 was 1.00, but multi-class pathway F1 fell to 0.44–0.77, and the agent tended to **terminate traversal early** ([arXiv 2601.03475](https://arxiv.org/html/2601.03475v1)). An NCCN breast tool reported Agentic-RAG at 100% on 24–50 items, with inconsistent numbers across versions ([arXiv 2502.15698](https://arxiv.org/abs/2502.15698)). Using the IIT Madras graph, accuracy was only **54.5% on questions answered from the flowchart** versus 81.8% on questions answered from the discussion text ([arXiv 2407.21053](https://arxiv.org/pdf/2407.21053)). Graph structure alone does not make LLM reasoning reliable.

One hybrid is peer-reviewed: **LLM-in-the-loop CQL execution** (JAMIA Open 2026 [PR-validated, feasibility]). A modified CQL engine calls an LLM only to answer binary questions over unstructured FHIR data, with 93% accuracy for Llama 3.1 8B ([JAMIA Open](https://academic.oup.com/jamiaopen/article/9/3/ooag099/8707497)). The executor stays deterministic and the LLM handles only data abstraction. The OncoDoc navigation finding identifies that same step as the main source of error.

The supported traversal design has five parts:

1. structured extraction of patient facts;
2. routing to an entry node;
3. LLM decisions limited to one branch at a time, each citing its node ID;
4. case memory or retrieval only for cases off the pathway;
5. consistency-based abstention, with an explicit "outside guideline / clinical trial / particular case" exit.

## Validation protocols are the most reusable published layer

Validation can be assembled almost entirely from published, peer-reviewed methods, in four tiers.

**Encoding fidelity:**

- node and edge precision/recall against an adjudicated gold graph ([Guideline2Graph](https://arxiv.org/html/2604.02477v1));
- decision-path F1 and exact tree accuracy ([Text2MDT](https://arxiv.org/html/2401.02034v1));
- three-clinician rule-level categorical review with κ, using the categories correct, incorrect, missing, hallucinated and untranslated ([NICE ASP, PMC13475280](https://pmc.ncbi.nlm.nih.gov/articles/PMC13475280/)).

Because omission dominates, recall-oriented checks matter most: every box, arrow and footnote should appear in the graph. Pre-LLM GEM markup showed "considerable variation" between authors, who used 46 to 149 elements on the same guideline ([Karras AMIA 2000](https://gem.med.yale.edu:443/Publications/karras_amia2000.pdf)). This argues for dual independent encoding with adjudication.

**Structural verification:** deterministic checks for orphan nodes, dead ends, unresolved footnotes and reachable terminals. The formal model-checking lineage (SPIN on GLARE, constraint logic programming on PROforma) is [PR-described] ([Giordano AMIA 2006](https://pmc.ncbi.nlm.nih.gov/articles/PMC1839493)). It has not been applied to LLM-generated encodings.

**End-to-end concordance:**

- Use vignettes that cover every leaf, including deliberately non-concordant cases.
- Score with registry-style definitions: minimum required treatment, additional therapy allowed, discretionary items counted as concordant ([NCDB lung, PMC6993802](https://pmc.ncbi.nlm.nih.gov/articles/PMC6993802); [ASCO/NCCN measures, PMC2793747](https://pmc.ncbi.nlm.nih.gov/articles/PMC2793747)).
- Report **path overlap and treatment match separately against the expert ceiling** ([CancerGUIDE](https://arxiv.org/html/2509.07325v2)).
- Report statement-level harm and citation correctness separately ([Ferber 2025](https://pmc.ncbi.nlm.nih.gov/articles/12380607/)).
- Pin the NCCN version, as Chen et al. did by matching the model's knowledge cutoff ([JAMA Oncol](https://jamanetwork.com/journals/jamaoncology/fullarticle/2808731)).

**Deployment:** a HemaGuide-style silent shadow run ([MDLinx](https://www.mdlinx.com/news/new-ai-system-provides-treatment-recommendations-for-complex-blood-cancers/3POW9lAOCvngJgujoLYLkw)). DECIDE-AI applies to early live use.

**Reporting standards:** TRIPOD-LLM, 19 items ([Nat Med 2025](https://pubmed.ncbi.nlm.nih.gov/39779929/)); CHART for free-text advice ([EQUATOR](https://www.equator-network.org/reporting-guidelines/reporting-guideline-for-chatbot-health-advice-studies-the-chart-statement/)); and QUEST for designing oncologist ratings ([npj Digit Med 2024](https://pubmed.ncbi.nlm.nih.gov/39333376/)).

**Regulation:** FDA's revised CDS guidance of 6 January 2026 keeps the four non-device criteria. The most important is criterion 4: the clinician must be able to independently review the basis, ideally "well-understood and accepted sources" such as guidelines. The guidance says nothing about LLMs ([Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance)). A clinician-facing tool that shows the NCCN version, page, node, footnote and traversal path matches the non-device pattern.

## Evidence-ranked reuse recommendations by layer

The table ranks options within each layer by evidence strength. "Reuse" means adopting the published method or schema. NCCN content itself cannot be redistributed, and processing it requires a license.

| Layer | First choice (strongest evidence) | Second choice | Use LLM agents for | Avoid / treat as unproven |
|---|---|---|---|---|
| **0. License gate** | Written research or evaluation license via NCCN Permissions and Business Development, before parsing or testing anything (EULA §3(A)(a)–(b), §12(F)) | License the NCCN Drugs & Biologics Compendium API (XML/JSON) to check regimens and indications [Vendor/official] | n/a | Treating "research" or "private use" as exempt; publishing NCCN-derived graphs |
| **1. PDF to structure** | IIT Madras vector-PDF object parsing of boxes, arrows and hyperlinks, with version-diff. **[PR-described / likely peer-reviewed EMBC 2023; follow-ups Preprint]**. No edge F1 and no code, so re-implement from the papers. | Guideline2Graph chunk-then-merge with provenance **[Preprint; only NCCN graph with node/edge P/R]**; IIT Bombay footnote and hyperlink inlining **[Preprint]** | Node typing (80–88% accuracy), edge-label disambiguation, cross-checking the vector parse against the page image, TEXTUALIZER-style Mermaid intermediate **[PR-validated, NAACL 2025, general flowcharts]** | End-to-end VLM extraction from rasterized pages (link F1 ~0.22–0.30) |
| **2. Representation** | Typed JSON/JSON-LD decision graph with stable node IDs and annotation fields for footnotes, evidence category and preference tier, borrowing Text2MDT, CPGPrompt and GEM element schemas **[schemas PR-described / Preprint]**. Version it under HL7 CRMI lifecycle rules **[PR-described standard]**. | HL7 CPG-on-FHIR PlanDefinition + CQL over mCODE, with Camino as reference engine **[PR-described standards; no NCCN encoding validated]**, only if EHR execution is needed. ASP/Clingo for checkable logic **[PR-validated on NICE, F1 0.825]** | Drafting CQL or ASP from the graph, always gated by compile checks and clinician review | Orphaned classic CIG languages (GLIF, Asbru, SAGE) as the primary format; unreviewed LLM-generated CQL |
| **3. Traversal by LLM agent** | Constrained node-by-node traversal with node-ID citations, logged paths and consistency-based abstention, following CancerGUIDE metrics and confidence **[NeurIPS 2025]** and OncoDoc navigation **[PR-validated, clinical]** | HemaGuide-style routing plus case memory for complex or off-pathway cases **[PR, venue unconfirmed; 82% on 555 external cases]**; LLM-in-the-loop CQL execution where a deterministic engine runs **[PR-validated feasibility]** | Patient-state abstraction at each node, routing, flagging uncertainty, explaining the path | Free-text regimen generation; plain RAG as the sole safeguard; claims that graph-RAG beats agentic RAG |
| **4. Validation** | Layered protocol: (a) structural graph checks; (b) dual-annotator node/edge P/R plus clinician rule review with κ (NICE ASP **[PR-validated]**); (c) leaf-covering vignettes scored with registry concordance definitions **[PR-validated]**; (d) path overlap and treatment match against the expert ceiling (CancerGUIDE) plus harm and citation rates (Ferber **[PR-validated]**) | Silent prospective shadow run (HemaGuide); report with TRIPOD-LLM, CHART and QUEST **[PR-described standards]** | LLM-as-judge or consistency proxies for scale, calibrated against clinicians on a subset | Single-tumor-board concordance as proof of safety (the Watson lesson); unpinned guideline versions |

## Conclusion

The field has inverted where the hard problems lie. Representation formats are mostly settled: a typed graph works for LLM traversal, and CQL/FHIR serves when EHR execution is needed. Validation methods are well specified. The weak links are the two places where meaning enters and leaves the graph. On the way in, NCCN boxes and arrows must be turned into faithful edges, and no NCCN parser has published edge-level accuracy. On the way out, patient facts must be mapped onto branch conditions; OncoDoc showed that navigation errors cost about 14 points of compliance, and even oncologists agree on NCCN paths only about 65–70% of the time. The highest-value contribution a new project could make is therefore not another end-to-end LLM converter. It is the first **published, edge-level fidelity benchmark for an NCCN parser**, combined with a navigator whose LLM decisions are confined to logged, abstainable single-node choices.

All of this depends on the license. NCCN has shown it will license content to AI platforms under its own quality review, and its Navigator roadmap already promises AI features. A research team that approaches NCCN early, with a validation protocol built from published methods rather than unvalidated claims, is better placed to obtain permission than one that builds first. It also produces exactly the provenance and version-pinning evidence that FDA's non-device CDS criteria and any later publication will require.
