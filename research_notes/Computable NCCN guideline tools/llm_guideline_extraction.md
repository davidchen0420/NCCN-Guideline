# LLM/NLP Methods for Encoding Clinical Practice Guidelines (esp. NCCN flowcharts) into Machine-Readable Structures

Legend: [PEER] = peer-reviewed venue confirmed; [PREPRINT] = arXiv/medRxiv only, as far as I found; [ABSTRACT] = conference abstract. "Validated" means quantitative metrics against a human-curated gold standard or expert rating.

## Q1. Published LLM studies converting guidelines into decision trees / graphs / KGs / computable rules, and how they were validated

### Takeaway
Few LLM guideline-to-structure studies have peer-reviewed, expert-validated metrics. The strongest are: Text2MDT (a Chinese text-to-decision-tree benchmark with tree-level metrics), the Imperial College NICE-to-Answer-Set-Programming study (3-clinician rule review plus vignette F1 0.825), and Guideline2Graph (node/edge precision/recall on NCCN Prostate v4.2024, but n=1 guideline). Most other work is preprints with small, synthetic, or QA-only evaluations. I found no peer-reviewed study that measures LLM generation of CQL or FHIR PlanDefinition from guidelines.

### Cited Findings

**Text-to-decision-tree (Text2DT / Text2MDT)**
- Text2DT was a shared-task track at CHIP-2022 on extracting medical decision trees from unstructured medical texts such as guidelines and textbooks. Its overview paper was published by Springer (CHIP 2022 proceedings) [PEER]. — [Springer chapter](https://link.springer.com/chapter/10.1007/978-981-99-4826-0_9); [ECNU record](https://pure.ecnu.edu.cn/en/publications/extracting-decision-trees-frommedical-texts-an-overview-ofthetext/)
- Text2MDT (Zhu et al., arXiv 2401.02034) [PREPRINT]. Chinese dataset of 500 text-tree pairs and 3,232 triplets from guidelines and textbooks, annotated with medical experts. Trees have depth 2 to 4 and average 3.76 nodes and 6.46 triplets per tree. The paper also states an 800/100/100 split, which is internally inconsistent with the 500-pair count. — [arXiv HTML](https://arxiv.org/html/2401.02034v1)
- Text2MDT representation: a binary tree with condition nodes (patient status) and decision nodes (treatment). Each node holds (subject, relation, object) triplets and a logical operator (AND/OR/NULL). Yes goes left and No goes right, and the tree is serialized in pre-order. — [arXiv HTML](https://arxiv.org/html/2401.02034v1)
- Text2MDT metrics: triplet P/R/F1, a node-grouping Levenshtein ratio, exact tree accuracy (TreeAcc), decision-path F1 (DP-F1), and a whole-tree Levenshtein ratio. — [arXiv HTML](https://arxiv.org/html/2401.02034v1)
- Text2MDT results:
  - Best end-to-end LLM (COT-Generation, fine-tuned Baichuan-2 family): TreeAcc 0.490, DP-F1 0.632, Tree_LR 0.898.
  - Pipelines: CGen-Pipe TreeAcc 0.470, Enc-Pipe (MedBERT) 0.450.
  - Per-subtask best: triplet F1 0.901 and TreeAcc 0.748 (given gold intermediate inputs).
  - Takeaway: fewer than half of trees are reproduced exactly. Code is at github.com/michael-wzhu/text2dt and data at tianchi.aliyun.com/dataset/95414. — [arXiv HTML](https://arxiv.org/html/2401.02034v1); [search summary of abstract](https://arxiv.org/pdf/2401.02034)
- Follow-up PI-LoRA (ACL Anthology 2025) claims to beat other parameter-efficient fine-tuning methods on Text2MDT. The figures GPT-4 TreeAcc 0.672 and PI-LoRA 0.772 come from a secondary summary (Emergent Mind) that I did not verify against the primary paper. — [Emergent Mind topic](https://www.emergentmind.com/topics/text2mdt); [ACL Anthology author page](https://aclanthology.org/people/wenwen-ouyang/)

**Flowchart-to-tree datasets**
- MedDM (arXiv 2312.02441) [PREPRINT]. Defines an "LLM-executable clinical guidance tree" and builds 1,202 decision trees from flowcharts in about 5,000 medical publications, covering 12 departments and over 500 diseases.
  - Pipeline: flowchart screening, Faster R-CNN structure detection, then conversion to trees. It handles yes/no labels written on connectors, loops, and nodes with several parents.
  - No accuracy or validation metrics are reported on the abstract page. Later work (CPGPrompt) notes that MedDM still needs heavy manual curation. — [arXiv abs](https://arxiv.org/abs/2312.02441); [arXiv PDF](https://arxiv.org/pdf/2312.02441); [CPGPrompt](https://arxiv.org/pdf/2601.03475)

**Full-guideline-to-graph pipelines (2026)**
- Guideline2Graph (Kilic et al., Georgia Tech / MetaDialog / Infuse; arXiv 2604.02477, Apr 2026) [PREPRINT].
  - Input: NCCN Prostate Cancer v4.2024.
  - Stage 1: profile extraction from the first pages, page labeling as core or auxiliary, and chunks with entry and terminal interfaces.
  - Stage 2: breadth-first chunk-level graph generation with a prompted VLM that takes page images plus the text layer or OCR.
  - Stage 3: global merge with cross-chunk deduplication, edge rewiring, and node provenance. — [arXiv HTML](https://arxiv.org/html/2604.02477v1)
- Guideline2Graph validation: reference graphs were manually curated and adjudicated. Results on the merged graph:

  | Method | Node P / R | Edge P / R |
  |---|---|---|
  | Guideline2Graph | 57.7% (30/52) / 93.8% (30/32) | 69.0% (49/71) / 87.5% (49/56) |
  | AutoKG | 56.8% / 78.1% | 19.6% / 16.1% |
  | Doc2KG | 27.5% / 43.8% | 1.1% / 1.8% |

  Triplet scores equal the edge scores. Implied edge F1 is about 0.77 (my calculation, not the paper's). Limitations: a single guideline, 32 gold nodes and 56 gold edges, the VLM is not named on the page, and no code release was found. — [arXiv HTML](https://arxiv.org/html/2604.02477v1)
- CPGPrompt (arXiv 2601.03475, 2026) [PREPRINT]. Auto-converts narrative and flowchart guidelines into decision trees that an LLM then traverses. Domains: headache, low back pain, and prostate cancer referral.
  - Evaluation uses synthetic vignettes, so it scores downstream classification, not tree fidelity.
  - Binary specialty-referral F1 is 0.85 to 1.00 with recall 1.00.
  - Multi-class pathway F1 is 0.47 (headache), 0.72 (low back pain), and 0.77 (prostate).
  - No expert validation of the trees is mentioned on the abstract page. — [arXiv abs](https://arxiv.org/abs/2601.03475)

**LLM to executable logic (Answer Set Programming), peer-reviewed with expert review**
- Gupta, Prociuk, Russo, Delaney (Imperial College London), "Automatic Conversion of NICE Guidelines to an Executable Computational Model Using LLMs", *Learning Health Systems* 2026 [PEER].
  - Model: Claude Opus 4.5.
  - Pipeline (D2K): constant extraction, then predicate generation, then ASP rule generation, each step with 6 in-context examples. The Clingo solver then runs patient facts against the rules (K2P).
  - Guidelines: NICE NG85 (pancreatic), NG12 (suspected cancer), and NG122 (lung). — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13475280/); [Wiley](https://onlinelibrary.wiley.com/doi/10.1002/lrh2.70114)
- NICE ASP study validation:
  - Three clinicians independently rated each rule as correct, incorrect, missing key information, hallucinated, or not translated.
  - Cohen's κ was 0.716 to 0.857.
  - On 20 pancreatic-cancer vignettes: precision 0.894 ± 0.115, recall 0.766 ± 0.190, F1 0.825 ± 0.127.
- NICE ASP study error profile:
  - The dominant errors were omissions (qualifiers, higher-arity arguments) and missed multi-step procedural relations. Hallucinations were rare.
  - Vignettes activated only about 64% of rules.
  - The stepwise pipeline did not beat direct in-context prompting significantly (58.2% vs 54.8%, p≈0.248, n=3).
  - The authors state it is "not yet ready for direct clinical integration." — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13475280/)

**LLM-generated oncology decision trees (expert-graded)**
- Miao, Alaa, Butte et al. (UCSF/Berkeley), medRxiv 2024 [PREPRINT]. GPT-4 and Claude-2 generated molecular-subtyping decision trees for colorectal cancer, invasive ductal carcinoma, AML, DLBCL, and diffuse glioma. Clinical evaluators graded the trees.
  - The trees contained valid biomarkers and subtypes even without guideline text.
  - Adding guideline text gave only limited accuracy gains.
  - A Streamlit dashboard was released. — [Alaa Lab page](https://alaalab.berkeley.edu/node/48); [medRxiv](https://www.medrxiv.org/content/10.1101/2024.03.04.24303737v1)

**Flowchart-as-graph for LLM navigation**
- Multi-agent self-triage (arXiv 2511.12439) [PREPRINT]. Uses 100 AMA clinically validated flowcharts, represented as directed graphs in Python.
  - Retrieval top-3 accuracy: 95.29% (N=2,000).
  - Navigation accuracy: 99.10% (N=37,200).
  - Both test sets are synthetic conversations. The abstract does not say whether the graphs were built manually or by an LLM. — [arXiv abs](https://arxiv.org/abs/2511.12439); [PDF](https://arxiv.org/pdf/2511.12439)

**LLM plus CQL/FHIR**
- LLM-in-the-Loop CQL execution (JAMIA Open 2026) [PEER]. A CQL engine was modified so that an LLM answers binary questions over unstructured FHIR data during CQL execution.
  - Accuracy: 72% (Phi-3-Mini) and 93% (Llama 3.1 8B) in a feasibility test.
  - This is LLM-assisted execution of CQL, not generation of CQL. — [JAMIA Open](https://academic.oup.com/jamiaopen/article/9/3/ooag099/8707497); [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13264386/)
- A USPTO patent describes using an LLM to translate a disease-specific treatment algorithm into FHIR-conformant CQL. It reports no accuracy data. — [USPTO 12431226](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12431226)
- Target standard: the HL7 CPG-on-FHIR IG represents guidelines as PlanDefinition, with eligibility logic in CQL and populations in Group. — [HL7 CPG IG](https://hl7.org/fhir/uv/cpg/PlanDefinition-anc-contact.json.html); [CPG methodology](https://build.fhir.org/ig/HL7/cqf-recommendations/methodology.html)
- A JBI 2023 paper on representing guideline recommendations on FHIR notes that not all information needed to execute recommendations can be expressed in current FHIR resources. — [JBI 2023](https://www.sciencedirect.com/science/article/pii/S1532046423000266)
- Adjacent text-to-query work: LLMs converting trial criteria to OMOP SQL showed an overall hallucination rate of 32.7% across models (JMIR Med Inform 2025) [PEER]. — [JMIR](https://medinform.jmir.org/2025/1/e71252)

### Inferences
- Exact-structure fidelity is still modest. Text2MDT reaches TreeAcc of about 0.49 on small trees of about 4 nodes, and Guideline2Graph's node precision is 58% on one NCCN guideline. NCCN pages are larger and denser than either test set, so a fully automated pipeline should be expected to need human correction.
- Omission is the dominant error mode (NICE ASP study), not hallucination. Validation should therefore emphasize recall checks: did every box, arrow, and footnote make it in?
- Validation designs that are most transferable:
  1. Node/edge/triplet P/R against an adjudicated gold graph (Guideline2Graph).
  2. Decision-path F1 and exact tree accuracy (Text2MDT).
  3. Multi-clinician rule-level categorical review with κ (NICE ASP).
  4. Vignette-based end-to-end execution F1 (NICE ASP, CPGPrompt).

### Gaps
- No peer-reviewed study was found that quantitatively evaluates LLM generation of CQL, ELM, or FHIR PlanDefinition from guideline text or flowcharts.
- The model names and full metric tables for CPGPrompt, and the full results of the CHIP-2022 Text2DT shared task (top-system scores), were not retrieved.
- The PI-LoRA and GPT-4 Text2MDT figures are unverified.

## Q2. NCCN-specific work that parsed NCCN PDFs into graphs/trees; datasets and repos

### Takeaway
The most directly relevant line of work is the IIT Madras (HTIC) group of Ta, Gupta, Ram, and Sivaprakasam. It parses the NCCN PDF object model (vector text boxes and line/arrow objects, not rasterized images) into a programmatically traversable graph, tested on NSCLC and three other cancers, exported to JSON-LD and Neo4j, and enriched with LLM node classification. Other NCCN graphs (IIT Bombay DKG, MedGUIDE, Guideline2Graph) exist, but no group has released an NCCN-derived graph dataset or parsing code that I could confirm. NCCN licensing likely explains this.

### Cited Findings

**IIT Madras (HTIC) NCCN knowledge-model line**
- "Automated Knowledge Modeling for Cancer CPGs" (Ta et al., arXiv 2307.10231; PubMed 38082992, so likely IEEE EMBC 2023) [PEER, likely].
  - Parses the PDF object model to extract knowledge items and relationships. This replaces earlier image-processing approaches that rasterized NCCN pages.
  - Tested on two versions of the NCCN NSCLC guideline for "faithful extraction."
  - Enrichment adds staging, UMLS/NCIt concepts, and SVM node classification (accuracy 0.81, 10-fold cross-validation). — [arXiv PDF](https://arxiv.org/pdf/2307.10231); [PubMed](https://pubmed.ncbi.nlm.nih.gov/38082992/); [SOTAVerified summary](https://sotaverified.org/papers/automated-knowledge-modeling-for-cancer)
- "Knowledge Models for Cancer CPGs: Construction, Management and Usage in QA" (Ta, Gupta, Jain, Sree C, Ram, Sivaprakasam; arXiv 2407.21053, Jul 2024) [PREPRINT].
  - The improved algorithm handles varying edge styles: fan-out edges, multi-segment directed edges, and chained edges.
  - Evaluated on NCCN guidelines for four cancer types, which are not named on the abstract page.
  - Includes a version-diff algorithm that detects treatment changes between guideline versions.
  - QA on 32 NSCLC question-answer pairs: 54.5% accuracy from the treatment algorithm and 81.8% from the discussion section. — [arXiv abs](https://arxiv.org/abs/2407.21053v1); [search summary](https://arxiv.org/pdf/2407.21053)
- "Comprehensive Modeling and QA of Cancer CPGs using LLMs" (Gupta, Ta, Ram, Sivaprakasam; arXiv 2501.13984; related IEEE CIBCB 2024 DOI 10.1109/CIBCB58642.2024.10702112).
  - Exports NSCLC pathways to JSON-LD, followed by manual review and Neo4j import.
  - LLM node classification accuracy: 80.86% zero-shot and 88.47% few-shot.
  - LLM-based subgraph retrieval is used for QA.
  - A pith.science referee summary argues that two central claims are not supported. — [arXiv abs](https://arxiv.org/abs/2501.13984); [search summary](https://arxiv.org/pdf/2501.13984); [Pith](https://pith.science/paper/2501.13984)

**Other NCCN-derived graphs and benchmarks**
- Decision Knowledge Graph (Kandula & Bhattacharyya, IIT Bombay; arXiv 2308.02984) [PREPRINT].
  - Input: NCCN ALL v1.2022, Bone Cancer, and Kidney Cancer flowcharts.
  - OCR of box text. Footnote superscripts are replaced with the footnote text, and hyperlinks are replaced with the linked content.
  - Head and tail entities are taken from the boxes at each arrow's ends and written to CSV.
  - Patient constraints are extracted with a CoreNLP constituency parser plus rules and deep learning, then loaded into Neo4j.
  - 8,300 QA pairs with hand-written Cypher. QA accuracy rose from 0.259 to 0.676 with the DKG, versus a fine-tuned BioBERT baseline.
  - No graph-fidelity metric is reported. — [arXiv HTML](https://arxiv.org/html/2308.02984); [arXiv abs](https://arxiv.org/abs/2308.02984)
- MedGUIDE (arXiv 2505.11613) [PREPRINT].
  - Built from 55 curated NCCN decision trees across 17 cancer types, yielding 7,747 samples after selection with expert-labeled reward models plus LLM-as-judge ensembles on 10 criteria.
  - 25 LLMs were evaluated, and domain-specific LLMs often underperformed.
  - The abstract does not say whether the trees were built manually. — [arXiv abs](https://arxiv.org/abs/2505.11613v1)
- Guideline2Graph, on NCCN Prostate v4.2024: see Q1. — [arXiv HTML](https://arxiv.org/html/2604.02477v1)
- GAPS benchmark (arXiv 2510.13734) builds a section tree for NCCN NSCLC from the table of contents and headings. This is hierarchy only, not the decision flow. — [arXiv PDF](https://arxiv.org/pdf/2510.13734)
- Bone cancer study (JCO 2024 suppl e13623) [ABSTRACT]. Converted the NCCN Bone Cancer guideline into a binary decision tree (internal nodes are decisions, leaves are treatments) to steer a generative model. — [ASCO abstract](https://ascopubs.org/doi/10.1200/JCO.2024.42.16_suppl.e13623)
- Singapore breast cancer study (JCO CCI 2024). Augmented Claude-2 with the 2023 NCCN guidelines (retrieval, not structured encoding) for adjuvant therapy recommendations. — [JCO CCI](https://ascopubs.org/doi/10.1200/CCI-24-00243)
- Leukemia study (CEUR Vol-4001, 2025). Combines clinical guidelines, a domain ontology, and LLMs for personalized leukemia treatment. — [CEUR](https://ceur-ws.org/Vol-4001/paper3.pdf)

### Inferences
- For NCCN specifically, vector/PDF-object parsing is the most validated starting point, because NCCN PDFs carry text boxes, line/arrow paths, and hyperlink annotations natively (IIT Madras approach). Footnote and page-link resolution has precedent in the IIT Bombay DKG.
- A hybrid is likely more robust than either method alone: deterministic vector extraction of boxes and arrows, then a VLM or LLM for semantics, edge-label disambiguation, and chunk merging (Guideline2Graph-style), then human adjudication.
- The IIT Madras version-diff idea is directly useful for keeping an encoded NCCN graph current across guideline updates.

### Gaps
- No public NCCN graph dataset or parsing code was confirmed for any of these groups.
- No edge-level precision/recall was found for the IIT Madras PDF-object parser. Its abstracts claim faithful extraction but give no edge F1.
- No NCCN-graph work from Stanford, MSK, Mayo, or Tencent surfaced in my searches. Absence is not proof that none exists.

## Q3. Document-layout / flowchart parsing tools and flowchart-understanding benchmarks

### Takeaway
General VLMs remain weak at recovering arrows and edges from flowchart images. Claude-3 Opus link F1 was about 0.30 on FlowLearn. Arrow-aware pipelines (detector plus OCR plus LLM) and two-stage "image to text graph, then reason" methods (TEXTUALIZER/TextFlow) clearly beat end-to-end VLM prompting. Generic PDF parsers (Docling, MinerU, Marker) are benchmarked on layout and text, not on flowchart topology.

### Cited Findings
- FlowLearn (Pan et al., ECAI 2024) [PEER]. Simulated flowcharts with semantically meaningless labels to isolate topology. It scores flowchart-to-Mermaid conversion with node and link P/R/F1. — [ECAI PDF](https://www.cs.uic.edu/~cornelia/papers/2024.ECAI.pdf); [arXiv](https://arxiv.org/pdf/2407.05183)
- On FlowLearn, link-level F1 was about 0.30 for Claude-3 Opus and 0.22 for GPT-4V, as cited in the Arrow-Guided VLM paper. — [arXiv 2505.07864](https://arxiv.org/html/2505.07864)
- FlowVQA (Findings of ACL 2024) [PEER]. 2,272 human-verified flowchart images and 22,413 QA pairs. Best baseline was GPT-4 few-shot at a 68.42% majority-voting score. — [ACL Anthology](https://aclanthology.org/2024.findings-acl.78/); [project page](https://flowvqa.github.io/)
- TEXTUALIZER/TextFlow (NAACL 2025) [PEER]. Converts the flowchart image to Graphviz, Mermaid, or PlantUML text, then reasons over that text.
  - With Claude 3.5 Sonnet: 82.74% on FlowVQA and 80.57% on FlowLearn, versus prior results of 76.61% and 77.00%.
  - Node extraction generally beats edge extraction, and Mermaid performs about as well as Graphviz. — [ACL Anthology PDF](https://aclanthology.org/2025.naacl-long.180.pdf); [alphaXiv](https://www.alphaxiv.org/abs/2412.16420)
- Arrow-Guided VLM (arXiv 2505.07864) [PREPRINT].
  - Pipeline: Azure Document Intelligence OCR, a fine-tuned DAMO-YOLO detector for nodes and arrow start/end points, overlap-based linking, then a graph-structured prompt to GPT-4o.
  - Data: 99 annotated flowcharts (30 test), 90 questions.
  - QA accuracy (human-judged): 88.9% versus 80.0% for GPT-4o alone. Gains were larger on large diagrams (80% vs 66.7%), but previous-step accuracy was only 50%.
  - Detection: arrow classes averaged 0.235 mAP at IoU 0.50 to 0.95, versus 0.653 for non-arrow classes. — [arXiv HTML](https://arxiv.org/html/2505.07864)
- Follow the Flow (arXiv 2506.01344). Neurosymbolic flowchart attribution, with Qwen2-VL-7B fine-tuned to emit Mermaid. — [arXiv](https://arxiv.org/pdf/2506.01344)
- FlowGen (ICLR 2026) [PEER]. Synthetic flowchart training data. Qwen2.5-VL-7B rose from 43.2 to 60.1 on FlowLearn after fine-tuning. Also uses the hdBPMN and FC_A/FC_B parsing datasets. — [ICLR proceedings](https://proceedings.iclr.cc/paper_files/paper/2026/file/21b7e46991301ad2126c3e39384df6ed-Paper-Conference.pdf)
- Flowchart2Mermaid (arXiv 2512.02170). VLM-based image-to-Mermaid conversion with normalization and validation. — [arXiv](https://arxiv.org/pdf/2512.02170)
- FlowExtract (arXiv 2604.06770). Procedural knowledge extraction from maintenance flowcharts. — [arXiv](https://arxiv.org/pdf/2604.06770)
- diagram2graph (GitHub). Self-reported edge F1 rose from about 46% to about 69% after fine-tuning on process diagrams. Not peer-reviewed. — [GitHub](https://github.com/Zackriya-Solutions/diagram2graph)
- OmniDocBench (CVPR 2025) [PEER]. Covers 9 document sources, 19 layout categories, and 15 attribute labels, and evaluates pipeline tools (MinerU, Marker) and VLMs. The authors argue MinerU and Marker had mostly been evaluated on academic papers. — [CVPR paper](https://openaccess.thecvf.com/content/CVPR2025/papers/Ouyang_OmniDocBench_Benchmarking_Diverse_PDF_Document_Parsing_with_Comprehensive_Annotations_CVPR_2025_paper.pdf); [arXiv](https://arxiv.org/html/2412.07626v1)
- MinerU2.5-Pro self-reports an OmniDocBench v1.6 overall score of 95.69, up from 92.98. — [arXiv 2604.04771](https://arxiv.org/pdf/2604.04771)
- On 1,355 OmniDocBench pages, MinerU covered 99.9% and Docling 99.0%. This measures coverage, not accuracy. — [arXiv 2604.00500](https://arxiv.org/pdf/2604.00500)

### Inferences
- Arrow and edge recovery is the main bottleneck. Because NCCN PDFs are vector documents, reading line and path objects directly (as the IIT Madras group does) sidesteps the weakest part of image-based VLM parsing. VLMs are best kept for verification and for semantics.
- An intermediate textual graph (Mermaid or JSON) is supported by the TEXTUALIZER results as a better substrate for LLM traversal than raw images. This matches a Navigator-style agent design.

### Gaps
- No flowchart benchmark was found that uses clinical or NCCN-style algorithms (multi-column, footnoted, cross-page). Numbers on FlowLearn and FlowVQA may not transfer.
- No reliable head-to-head of Docling, Marker, GROBID, and Nougat on flowchart topology was found. These tools target text and layout, not edges.
- LayoutLM-family results on flowchart parsing were not retrieved.

## Q4. Pre-LLM NLP approaches for guideline recommendation extraction

### Takeaway
Pre-LLM work focused on markup (GEM XML) and sentence-level condition-action classification. Validation was mostly classifier accuracy on small, guideline-specific corpora. These methods are useful as schema ideas, such as GEM's decision-table elements and condition/action typing, rather than as extraction engines today.

### Cited Findings
- GEM, the Guideline Elements Model (Shiffman et al., Yale; JAMIA 2000) [PEER]. An XML hierarchy with over 100 tags covering recommendations, definitions, and algorithms, derived from IOM appraisal criteria and augmented decision tables. ASTM adopted the GEM DTD as a standard. — [GEM JAMIA 2000](https://gem.med.yale.edu:443/Publications/GEM-jamia-sept200-fulltext.pdf); [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC516249)
- GEM-encoded guidelines were used to generate partially populated Arden Syntax Medical Logic Modules (Agrawal, AMIA 2001). — [AMIA 2001](https://gem.med.yale.edu:443/Publications/AgrawalAMIA2001_MLMs.pdf)
- Hematialam & Zadrozny 2017 (arXiv 1706.04206). Supervised condition-action sentence classification with domain-independent features. Released two annotated guideline datasets. — [arXiv](https://arxiv.org/abs/1706.04206)
- Hematialam's 2021 dissertation reports gains of 5 to 17% over the prior state of the art and the first use of domain adaptation and transfer learning for this task. — [UNCC dissertation](https://ninercommons.charlotte.edu/record/995/files/Hematialam_uncc_0694D_12805.pdf); [abstract](https://graduateschool.charlotte.edu/knowledge-extraction-and-analysis-medical-text-particular-emphasis-medical-guidelines/)
- "AI Driven Knowledge Extraction from CPGs" (arXiv 2012.05489). Classifies sentences as condition-action, condition-consequence, action, or not applicable, then forms "If Condition(s) Then Action" rules. Reports 95% classifier accuracy on hypertension, rhinosinusitis, and asthma guidelines. — [arXiv](https://arxiv.org/pdf/2012.05489)
- Heuristic condition-action extraction (TU Wien). — [TU Wien](https://ims.tuwien.ac.at/publications/tuw-223973)

### Inferences
- Condition-action typing maps naturally onto NCCN box semantics (a condition box, an arrow, then an action or recommendation box). GEM's element set can inform a node and attribute schema.

### Gaps
- Precision, recall, and F1 values for Hematialam 2017 were not retrieved, because only the abstract page was accessible.
- GEM Cutter and BRIDGE-Wiz details were not retrieved.

## Q5. Human-in-the-loop verification and formal verification of encoded guidelines

### Takeaway
Current LLM-encoding papers verify through three mechanisms:
1. Adjudicated gold graphs (Guideline2Graph).
2. Multi-clinician rule-level review with κ (NICE ASP).
3. Vignette or test-case execution (NICE ASP, CPGPrompt, MedGUIDE).

Formal verification such as model checking was studied mainly in 2006 to 2014 on manually authored guideline models, and I found no recent work applying it to LLM-generated encodings.

### Cited Findings
- Rule-level clinician review: 3 independent clinicians, 5 categories (correct, incorrect, missing information, hallucinated, not translated), κ 0.716 to 0.857. Vignette execution: 20 cases, F1 0.825. The paper also reports a coverage metric, with vignettes activating about 64% of rules. — [PMC13475280](https://pmc.ncbi.nlm.nih.gov/articles/PMC13475280/)
- Adjudicated gold graph with node, edge, and triplet P/R, reported per chunk and for the merged graph. — [Guideline2Graph](https://arxiv.org/html/2604.02477v1)
- MedGUIDE uses expert-labeled reward models plus LLM-as-judge ensembles across 10 criteria for quality control of NCCN-derived samples. — [arXiv](https://arxiv.org/abs/2505.11613v1)
- CLEVER (JMIR AI 2025) is a blind, randomized, preference-based expert-review framework for clinical LLM outputs. It is a general method that can be adapted. — [JMIR AI](https://ai.jmir.org/2025/1/e72153)
- Model-checking work on guidelines:
  - Pérez & Porres, JBI 2010: UML statecharts translated to PROMELA and checked with SPIN, with requirement patterns for non-experts (GBDSSGenerator). — [Unirioja PDF](https://investigacion.unirioja.es/documentos/5bbc699ab750603269e81e34/f/5ddc084352922232560fc7dc.pdf); [record](https://investigacion.unirioja.es/documentos/5bbc67dbb750603269e7fe98)
  - Giordano et al., AMIA 2006: SPIN/LTL verification of a GLARE stroke guideline. — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC1839493)
  - EPFL 2014: timed automata (TIMES) for an imatinib protocol. — [EPFL PDF](https://si2.epfl.ch/demichel/publications/archive/2014/S0218213014600033.pdf)
  - Constraint logic programming verification of customized decision models. — [CRIS](https://cris.iucc.ac.il/en/publications/using-constraint-logic-programming-for-the-verification-of-custom/)
- Known limitation of model checking: when a property fails, it is hard to trace the result back to the protocol model that needs changing. — [EPFL PDF](https://si2.epfl.ch/demichel/publications/archive/2014/S0218213014600033.pdf)
- LLM-encoded rules in ASP can be executed and inspected for provenance, but ASP's closed-world assumption may misinterpret missing EHR data. — [PMC13475280](https://pmc.ncbi.nlm.nih.gov/articles/PMC13475280/)

### Inferences
- A defensible NCCN encoding QA stack, synthesized from the cited designs:
  1. Deterministic structural checks: every box has edges, no orphan nodes, and every footnote and page reference resolves.
  2. Node and edge P/R against a dual-annotator adjudicated subset.
  3. Clinician rule review with κ.
  4. Vignette and path-coverage testing.
  5. Optionally, model-checking-style properties such as reachability of terminal recommendations and absence of dead ends.

### Gaps
- No 2022 to 2026 paper was found that applies formal verification or model checking to LLM-generated guideline encodings.
- No published inter-annotator agreement for NCCN graph gold standards was found.
