# Validation, Reporting Standards, Regulatory Considerations, and NCCN Licensing for an LLM-Traversed, Machine-Readable NCCN Guideline Navigator

Research date: 2026-10-13. Sources are marked [PRIMARY] (official text, the original paper, or a regulator) or [SECONDARY] (law-firm commentary, news, aggregators). Items marked "(prior knowledge; DOI not re-fetched)" are well-established citations that I did not re-open this session. Check them before quoting.

## 1. NCCN terms of use and licensing: are derivative, machine-readable, AI/RAG uses permitted?

### Takeaway
No, not without a written license. NCCN's current End-User License Agreement (EULA) grants only a personal, internal, non-commercial, educational license. It expressly prohibits scraping, "digesting", "processing", modifying, or creating derivative works of NCCN Content. It also expressly prohibits using NCCN Content "as an input to, or in connection with any development, testing, training" of AI software or models. Each of these restrictions applies unless NCCN agrees otherwise in writing.

The navigator described would convert the PDFs into machine-readable form (a derivative and "processed" work) and feed them to LLM agents (AI "input"/"testing"). Both fall squarely inside the prohibitions. NCCN does license its content to AI vendors commercially, for example OpenEvidence (Nov 2025) and Viz.ai (Jan 2026), so the realistic route is a written license or research permission from NCCN.

### Cited Findings
- **EULA location.** The NCCN EULA is published at https://nccn.org/footermenu/end-user-license-agreement. The nccn.org page returned HTTP 403/404 to automated fetches this session, so its text was read through a third-party archive (TOS Tracker, captured 4 Aug 2026; its copyright notice reads "2026") — [TOS Tracker capture of NCCN EULA](https://tostracker.app/document/nccn-eula) [SECONDARY capture of PRIMARY text].
- **§1 License scope.** Access is "solely on an internal, lawful, non-commercial basis and solely for your own educational or informational purposes". The license is non-transferable, non-sublicensable, limited, and personal — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
- **§2 Ownership.** NCCN owns the content and "all modifications, updates, enhancements, embodiments, and derivative works thereof" — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
  - Implication: even a user-made structured JSON or graph encoding would arguably be NCCN-owned.
- **§3(A)(a) No copying, scraping, processing, or derivatives.** Unless NCCN agrees otherwise in writing, "you shall not (a) copy, transfer, distribute, make available, reproduce, scrape, digest, process, modify or create derivative works of any part of the NCCN Content" — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
- **§3(A)(b) No AI use.** The clause bars using NCCN Content "as an input to, or in connection with any development, testing, training…" of artificial intelligence software or other models. The archive summary renders this as covering "development, testing, training, exploitation or support of, any artificial intelligence (AI) software or other model" — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
  - The full clause text was truncated in my retrieval. Read it in full on nccn.org before relying on the exact wording.
- **§3(A)(c) No commercial or third-party use.** The clause bars use "for any commercial purpose or on behalf of any third party" — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
- **§3(B) Not medical advice.** "The NCCN Content is provided for education and informational purposes only" — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
- **§3(C) Clinical use.** "clinicians may access and view the NCCN Content to support diagnosis and treatment of their patients with cancer". Clinicians must still apply their own judgment — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
- **§4(A) Nature of the guidelines.** "The NCCN Guidelines® are a statement of consensus of the authors regarding their views…" on currently accepted approaches — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
- **§4(B) Updates.** "NCCN will make reasonable efforts to post updated versions of the NCCN Content", but NCCN has no obligation to update the content or to notify users. This matters for version maintenance (see section 5) — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
- **§12(F) Permissions contact.** Readers are directed to the NCCN Permissions request site (http://www.nccn.org/about/permissions) and to Beth Gaffney, Vice President, U.S. and Global Business Development — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
- **OpenEvidence license (7 Nov 2025).** NCCN entered a licensing agreement with OpenEvidence under which the NCCN Guidelines and related JNCCN content "will be integrated into OpenEvidence's large language model" for search and clinical decision support — [ASCO Post, 7 Nov 2025](https://ascopost.com/news/november-2025/nccn-guidelines-to-be-integrated-into-openevidence-medical-ai-platform/) [SECONDARY news reporting the NCCN announcement].
  - NCCN CEO Crystal Denlinger said the deal "harnesses the evolving power of artificial intelligence to support learning and care delivery in cancer".
  - Content will undergo "NCCN's evidence and quality control review" and will link to source documentation.
- **Viz.ai agreement (8 Jan 2026).** Viz.ai announced an agreement integrating the NCCN Guidelines for Breast, Prostate, and Bladder Cancer into the Viz Oncology Platform — [Business Wire, 8 Jan 2026](https://www.businesswire.com/news/home/20260108401134/en/Viz.ai-and-NCCN-Collaborate-to-Integrate-NCCN-Guidelines-into-Clinical-Workflows-for-Oncologists) [PRIMARY vendor press release; full text not retrievable (403), so details come from the search snippet].
- **NCCN Policy Summit on AI (9 Sep 2025).** NCCN held a Policy Summit on whether AI can transform cancer care "safely and fairly" — [Newswise](https://www.newswise.com/articles/nccn-policy-summit-explores-whether-artificial-intelligence-can-transform-cancer-care-safely-and-fairly) [PRIMARY NCCN press release via a distribution service].
- **AI in guideline content (Apr 2026).** NCCN updated its 2026 Breast Cancer Screening and Diagnosis guideline to include image-based AI risk assessment — [Targeted Oncology, Apr 2026](https://www.targetedonc.com/view/nccn-updates-breast-cancer-guidelines-to-include-ai-based-risk-assessment) [SECONDARY]. This concerns AI inside guideline content, not licensing.

### Inferences
- Downloading the PDFs while logged in is permitted personal viewing. Each of the following is a restricted act under §3(A) unless NCCN grants written permission:
  - converting them into a machine-readable graph or JSON ("process", "digest", "modify", "derivative works");
  - feeding them to an LLM, including through RAG or agent traversal, and including for testing ("input to … testing");
  - sharing the encoded artifact ("distribute, make available").
- The "research" framing does not create an exception in the EULA text I saw.
- The OpenEvidence and Viz.ai deals show that NCCN's model is to license content to AI and clinical decision support (CDS) vendors under NCCN quality-control review. A research team should approach NCCN Business Development or Permissions for a research or evaluation license before building, and certainly before publishing or sharing derived artifacts.
- A defensible interim design keeps NCCN text out of any shared artifact and evaluates only on locally held, licensed copies. This still conflicts with §3(A)(b) unless permission is granted.
- Copyright fair-use questions in the US (for example, whether facts and algorithms are uncopyrightable) are separate from the contractual EULA, which binds anyone who accepted it. Contract restrictions can bind even where copyright might not. This is general legal reasoning, not legal advice; consult counsel.

### Gaps
- I could not retrieve nccn.org pages directly (HTTP 403/404), so §3(A)(b) is not quoted in full from the primary page.
- I could not confirm whether a separate "NCCN Guidelines PDF download terms" page or an explicit NCCN "AI policy" statement exists beyond the EULA.
- No public information was found on NCCN research-license terms or fees for AI evaluation.
- Not verified: whether NCCN has a formal "digital/CDS licensing" program page, or whether it offers machine-readable guideline data. Historically, NCCN has licensed content to EHR and pathway vendors, but I found no source for that this session.

## 2. Established methods for validating encoded computer-interpretable guidelines (CIGs) and how "NCCN-concordant" is operationalized

### Takeaway
The CIG literature combines several validation layers:
- clinician (domain-expert) review of the encoded model;
- test-patient or vignette execution covering compliant and non-compliant pathways;
- formal or logic-based verification (model checking with SPIN or similar, constraint logic programming) to detect inconsistencies, unreachable nodes, and contradictions.

In oncology outcomes research, "NCCN-concordant" is always operationalized per cancer, per stage, and per guideline version. The usual form is the minimum recommended first-course treatment (additional therapy allowed, discretionary items counted as concordant). The ASCO/NCCN quality measures define concordance as recommended-treatment recipients divided by eligible patients.

### Cited Findings
- **Hybrid verification.** Anselma et al. argue that CIGs are complex enough to need a verification process, that different kinds of CIG knowledge need different methods, and they propose a hybrid approach (chapter, 2015) — [Hybrid approach to verification of CIGs (Open Univ NL record)](https://research.ou.nl/en/publications/a-hybrid-approach-to-the-verification-of-computer-interpretable-g/); [Univ. Piemonte Orientale record](https://research.uniupo.it/en/publications/a-hybrid-approach-to-the-verification-of-computer-interpretable-g-2/) [PRIMARY bibliographic records].
- **Model checking.** One framework uses the SPIN model checker to check guidelines for semantic errors and inconsistencies. Its authors note that some requirement patterns could not be expressed in SPIN's specification language — [Univ. Torino PDF "verification"](https://iris.unito.it/bitstream/2318/1621043/2/verification_4aperto.pdf) [PRIMARY].
- **Constraint logic programming.** Wilk, Fux, Michalowski, Peleg, and Soffer verify customized decision models (PROforma) with constraint logic programming. Original guideline knowledge is kept separate from added patient- or context-specific arguments — [CRIS record](https://cris.iucc.ac.il/en/publications/using-constraint-logic-programming-for-the-verification-of-custom/) [PRIMARY record].
- **Expert review plus test patients.** In a declarative guideline conformance-checking case study (arXiv 2209.09535, 2022), physicians first validated the models in workshops. The models were then checked technically with test patients representing compliant and non-compliant cases — [arXiv 2209.09535](https://arxiv.org/pdf/2209.09535) [PRIMARY preprint].
- **CIG formalism comparison.** Peleg et al. (2002/2003, JAMIA) compared CIG formalisms (Asbru, EON, GLIF, GUIDE, PRODIGY, PROforma) using a case-study approach — [EPFL/related record of CIG representation](https://infoscience.epfl.ch/record/196314?ln=en) [record]. The JAMIA citation is from prior knowledge and was not re-fetched.
- **NCDB operationalization (lung cancer).** Guideline-concordant treatment was defined as the "minimal first course treatment" these patients should receive under NCCN. Definitions were subgroup-specific: localized NSCLC = surgery or SBRT; extensive-disease SCLC = chemotherapy. "Additional treatment was allowed beside guideline-concordant treatment". Overall concordance was 62.1% (274,338/441,812) — [PMC6993802](https://pmc.ncbi.nlm.nih.gov/articles/PMC6993802) [PRIMARY].
- **Version and stage alignment.** Registry studies align NCCN recommendations with AJCC stage at diagnosis and with the guideline version in force. Definitions changed between guideline years (for example, inflammatory breast cancer) — [PMC4339309](https://pmc.ncbi.nlm.nih.gov/articles/PMC4339309); [PMC7319034](https://pmc.ncbi.nlm.nih.gov/articles/PMC7319034) [PRIMARY].
- **Discretionary items.** In a CDC Patterns of Care supplement, patients in subtypes where a treatment was discretionary "were considered to have guideline concordant care regardless of whether they received the treatment or not" — [CDC stacks supplement](https://stacks.cdc.gov/view/cdc/175572/cdc_175572_DS7.doc) [PRIMARY].
- **ASCO/NCCN quality measures.** Measures for breast, colon, and rectal cancer were jointly selected from definitive guideline recommendations. Concordance = patients receiving the recommended treatment / patients eligible — [ASCO/NCCN Quality Measures (RAND record)](https://www.rand.org/pubs/external_publications/EP20080726.html); [PMC2793747](https://pmc.ncbi.nlm.nih.gov/articles/PMC2793747) [PRIMARY].
- **NCCN institutional colorectal data.** Among 3,443 patients, concordance was generally ≥90%. Lower measures were adjuvant chemotherapy within 9 months for stage II–III rectal cancer (81%) and neoadjuvant chemoradiation for cT4 rectal cancer (83%). Nonconcordance reasons included lack of documentation, patient refusal, delay, and lack of consensus — [PMC3538153](https://pmc.ncbi.nlm.nih.gov/articles/PMC3538153) [PRIMARY].
- **Chen et al., JAMA Oncology 2023 (LLM–NCCN concordance template).**
  - Design: 104 prompts (4 templates × 26 breast, prostate, and lung diagnosis descriptions), GPT-3.5-turbo-0301, benchmarked against 2021 NCCN guidelines (matching the model's knowledge cutoff), 5 scoring criteria.
  - Scoring: 3 of 4 board-certified oncologists scored each output by majority rule, with the fourth adjudicating complete disagreements.
  - Inter-rater agreement: all three raters agreed on 322/520 scores (61.9%).
  - Results: 98% of outputs gave a recommendation; all of those included at least one concordant treatment; 34.3% also included a non-concordant treatment; 12.5% included hallucinated treatments; answers varied with prompt wording — [JAMA Oncology 2023;9(10):1459](https://jamanetwork.com/journals/jamaoncology/fullarticle/2808731) [PRIMARY].
- **CancerGUIDE (Microsoft, NeurIPS 2025).**
  - What it does: an LLM agent generates NCCN-concordant treatment trajectories for NSCLC.
  - Data: 121 longitudinal cases annotated by board-certified oncologists.
  - Uncertainty: a meta-classifier estimates confidence, using internal disagreement as a proxy for label-free evaluation — [arXiv 2509.07325](https://arxiv.org/abs/2509.07325v2); [NeurIPS 2025](https://neurips.cc/virtual/2025/124912) [PRIMARY preprint/conference].

### Inferences
- For a navigator, "validation" should be layered:
  1. **Structural verification of the encoding.** Every NCCN page and node is reachable, there are no dangling footnote references, and branching conditions are mutually exclusive and exhaustive where NCCN intends it. This can be done with graph checks or model checking.
  2. **Fidelity review.** Two independent clinicians (or trained abstractors) compare each encoded node and edge against the source PDF page, with agreement statistics (Cohen's or Fleiss' kappa) and adjudication.
  3. **Vignette or test-patient execution.** Cover each leaf pathway, including both concordant and deliberately non-concordant cases. Use registry-style concordance definitions keyed to guideline version and stage.
  4. **End-to-end LLM-agent evaluation.** Oncologist raters assess the agent, following the Chen et al. design: multiple prompt paraphrases, majority rule, and reported agreement.
- Concordance definitions should explicitly handle:
  - "minimum required" versus "additional allowed";
  - NCCN category of evidence and preference (preferred / other recommended / useful in certain circumstances);
  - "clinical trial" options;
  - discretionary items.
  Without this, metrics will not be comparable to the NCDB and quality-measure literature.

### Gaps
- No published, NCCN-specific CIG validation protocol (for example, from NCCN's own digital products) was found.
- Not found: standard inter-rater agreement benchmarks for CIG encoding fidelity, or QOPI's current chemotherapy measure specifications (the QOPI site was not retrieved).

## 3. Reporting and evaluation frameworks for clinical AI and LLMs: which fit guideline-concordance evaluation?

### Takeaway
For an offline (non-deployed) evaluation of an LLM navigator against NCCN, the best-fitting frameworks are:
- **TRIPOD-LLM** (Nat Med, Jan 2025) as the primary reporting checklist;
- **CHART** (2025; 12 items / 39 subitems) for chatbot health-advice studies;
- **QUEST** for designing human (oncologist) evaluation.

DECIDE-AI applies once the tool is used in early live clinical evaluation. CONSORT-AI and SPIRIT-AI apply only to randomized trials. MI-CLAIM is an older minimum-information checklist for clinical AI modeling. Benchmarks (HealthBench, MedHELM, CRAFT-MD) supply evaluation methods, such as rubric grading, LLM-as-jury, and conversational simulation, rather than reporting standards.

### Cited Findings
- **TRIPOD-LLM.**
  - Publication: Nature Medicine, Jan 2025, vol. 31, pp. 60–69 (PMID 39779929). It extends TRIPOD+AI to LLMs.
  - Structure: 19 main items and 50 subitems. It is modular, with 14 main items and 32 subitems applying to all LLM study categories.
  - Development and features: an expedited Delphi process; it emphasizes transparency, human oversight, and task-specific performance reporting; it is described as a "living" guideline with an interactive website — [PubMed 39779929](https://pubmed.ncbi.nlm.nih.gov/39779929/) [PRIMARY].
- **CHART (Chatbot Assessment Reporting Tool).**
  - Scope: a reporting guideline for studies evaluating generative-AI chatbots that summarise clinical evidence and give health advice.
  - Structure: 12 items and 39 subitems.
  - Development: a systematic review, a modified Delphi with 531 stakeholders, three panel meetings of 48 stakeholders, and pilot testing.
  - Publication: published simultaneously in BMJ Medicine (e001632, doi:10.1136/bmjmed-2025-001632), Annals of Family Medicine (2025;23(5):389–398), and BJS (112(8)). The explanation-and-elaboration paper is BMJ 2025;390:e083305 — [EQUATOR Network listing](https://www.equator-network.org/reporting-guidelines/reporting-guideline-for-chatbot-health-advice-studies-the-chart-statement/); [Ann Fam Med](https://www.annfammed.org/content/23/5/389) [PRIMARY].
- **QUEST.**
  - What it is: a framework for human evaluation of healthcare LLMs, derived from a literature review (npj Digital Medicine 2024).
  - Three phases: Planning; Implementation and Adjudication; Scoring and Review.
  - Five principles: Quality of information; Understanding and reasoning; Expression style and persona; Safety and harm; Trust and confidence — [PubMed 39333376](https://pubmed.ncbi.nlm.nih.gov/39333376/) [PRIMARY].
- **MedHELM.**
  - Taxonomy: clinician-validated, with 5 categories, 22 subcategories, and 121 tasks.
  - Benchmarks: 35 (17 existing, 18 new). Grading uses an LLM-jury.
  - Results: reasoning models led, with roughly a 66% win rate.
  - The paper characterizes HealthBench as 5,000 single-turn, free-text health dialogues graded with physician-written rubrics, useful for autonomous chatbots but not for iterative clinician assistance — [arXiv 2505.23802](https://arxiv.org/abs/2505.23802v1); [Stanford HAI](https://hai.stanford.edu/news/holistic-evaluation-of-large-language-models-for-medical-applications) [PRIMARY].
- **CRAFT-MD.**
  - Publication: Johri et al., Nature Medicine, Jan 2025.
  - Method: an AI patient agent plus an AI grader agent, with expert review.
  - Scale: 2,000 vignettes across primary care and 12 specialties.
  - Findings: LLM diagnostic accuracy fell in conversational versus exam-style formats.
  - Recommendations: realistic dialogue, history-taking, open-ended questions, and mixed automated and expert scoring — [Harvard DBMI news](https://dbmi.hms.harvard.edu/news/how-good-are-ai-clinicians-medical-conversations); [paper PDF mirror](https://gwern.net/doc/ai/nn/transformer/gpt/4/nonfiction/2025-johri.pdf) [PRIMARY institutional news / paper].
- **HealthBench.**
  - Publication: OpenAI, May 2025, arXiv 2505.08775 (prior knowledge; not re-fetched).
  - Scope: 5,000 multi-turn conversations with physician-written rubrics (more than 48,000 rubric criteria) written by 262 physicians.
  - Note: the MedHELM paper above describes it as single-turn, which conflicts with my recollection of multi-turn. Verify against the HealthBench paper.
- **DECIDE-AI.**
  - Citation: Vasey et al., Nature Medicine 2022;28:924–933, doi:10.1038/s41591-022-01772-9 (prior knowledge; not re-fetched).
  - Scope: a reporting guideline for early-stage clinical evaluation of AI decision-support systems with real users (17 AI-specific + 10 generic items).
  - Emphases: human factors, safety, and user–AI interaction.
- **CONSORT-AI and SPIRIT-AI.**
  - Citations: Liu et al. and Cruz Rivera et al., Nature Medicine, Sep 2020; doi:10.1038/s41591-020-1034-x and 10.1038/s41591-020-1037-7 (prior knowledge; not re-fetched).
  - Scope: extensions for RCT reports and protocols evaluating AI interventions.
- **MI-CLAIM.**
  - Citation: Norgeot et al., Nature Medicine 2020, doi:10.1038/s41591-020-1041-y (prior knowledge; not re-fetched).
  - Scope: minimum-information checklist for clinical AI modeling (study design, data, optimization, performance, interpretability, reproducibility). Updated "MI-CLAIM-GEN" work for generative models has been proposed (not verified this session).

### Inferences
- **Recommended stack for the navigator.**
  - Report the offline evaluation with TRIPOD-LLM. Use the categories for LLM decision support or text generation, and include the model version, date, prompts, retrieval configuration, and NCCN guideline version.
  - Also complete CHART if the tool gives free-text health advice.
  - Design the oncologist rating protocol with QUEST principles, and report the inter-rater agreement and adjudication rules (as in Chen et al.).
  - Borrow from CRAFT-MD (multi-turn simulated cases with missing information) and from HealthBench/MedHELM (rubric grading or LLM-jury, validated against clinicians on a subset).
  - Move to DECIDE-AI for a first live clinician-user study, and to SPIRIT-AI/CONSORT-AI only for an RCT.
- **Guideline-specific metrics TRIPOD-LLM will not prescribe.** The study should define and report these itself:
  - pathway-level concordance (the correct node reached);
  - recommendation-level precision and recall against the NCCN option set at the right preference category;
  - citation and grounding accuracy (correct NCCN page or footnote cited);
  - hallucinated or non-NCCN therapies (Chen et al. found 12.5%);
  - abstention or appropriate "insufficient information" responses;
  - stability across paraphrases (prompt sensitivity).

### Gaps
- I did not re-fetch DECIDE-AI, CONSORT-AI, SPIRIT-AI, MI-CLAIM, or HealthBench primary pages this session (citations are from prior knowledge).
- No guideline-concordance-specific reporting standard was found.
- Not checked: whether TRIPOD-LLM's living website has 2026 updates.

## 4. Regulatory considerations: FDA CDS guidance (2022, and the Jan 2026 revision) and the EU AI Act/MDR

### Takeaway
**United States.** FDA revised its final CDS guidance on 6 Jan 2026 (superseding Sep 2022), without a comment period. Software meeting all four §520(o)(1)(E) criteria is "Non-Device CDS". For an NCCN navigator, the key criteria are:
- **Criterion 3**: support recommendations to a healthcare professional (HCP). FDA now applies enforcement discretion to a single output when only one recommendation is clinically appropriate.
- **Criterion 4**: the HCP must be able to independently review the basis for recommendations. It emphasizes reliance on "well-understood and accepted sources" such as clinical guidelines, and usability or transparency.

The 2026 guidance says nothing specific about generative AI or LLMs. A clinician-facing navigator that cites the exact NCCN page or footnote and lets clinicians verify it is the textbook non-device CDS pattern. Patient-facing use, time-critical use, or analysis of images or signals would push it toward device regulation.

**European Union.** Clinical-decision software with a medical purpose is likely a medical device under MDR (Rule 11, typically class IIa or higher). As an Annex I product it is "high-risk" under the AI Act. The May 2026 Digital Omnibus deal moves Annex I high-risk obligations to 2 Aug 2028 and Annex III to 2 Dec 2027, pending or recently completed formal adoption.

### Cited Findings
- **Revision and source.** FDA issued a revised final CDS guidance on 6 Jan 2026, superseding the 2022 guidance. Source document: https://www.fda.gov/media/109618/download — [Covington, Jan 2026](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance) [SECONDARY law-firm analysis; links PRIMARY FDA doc]. Corroborated by [Cooley, 20 Jan 2026](https://www.cooley.com/news/insight/2026/2026-01-20-automation-bias-and-clinical-practice-fda-makes-incremental-updates-to-clinical-decision-support-software-guidance), [ACR, 14 Jan 2026](https://www.acr.org/News-and-Publications/2026/fda-updates-guidance-on-clinical-decision-support), and [Polsinelli](https://www.polsinelli.com/publications/new-year-digital-health-fda-updates-guidance-documents). Polsinelli notes it was issued without public comment.
- **The four criteria for Non-Device CDS.** Software must be:
  1. not intended to acquire, process, or analyze a medical image, IVD signal, or signal pattern;
  2. intended to display, analyze, or print medical information;
  3. intended to support or provide recommendations to an HCP about prevention, diagnosis, or treatment;
  4. intended to enable the HCP to independently review the basis for recommendations, so the HCP does not rely primarily on them — [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance).
- **Change to criterion 3 (single recommendations).** The 2022 guidance excluded any "specific preventative, diagnostic, or treatment output or directive". The 2026 guidance applies enforcement discretion to singular outputs where only one recommendation is clinically appropriate, but does not define how to determine that — [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance).
- **Criterion 4 (transparency and sources).** The 2026 guidance keeps the 2022 information recommendations, adds emphasis on usability (prioritize decision-relevant information, avoid overload), and expects reliance on "well-understood and accepted sources" such as clinical guidelines and peer-reviewed literature. Time-critical language moved from criterion 3 to criterion 4 — [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance).
- **AI and consumer tools.** The revised guidance does not address AI or generative AI, clinician-facing chatbots, or patient-facing decision support. FDA plans to revise its Device Software Functions/Mobile Medical Apps policy in FY26 — [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance).
- **Unverified later revision.** One commercial blog claims a further 29 Jan 2026 revision. Only that source reports it, so treat it as unverified — [MedDeviceGuide](https://meddeviceguide.com/blog/fda-clinical-decision-support-cds-guide) [SECONDARY, low reliability].
- **2022 criterion 4 recommendations (prior knowledge; not re-fetched).** The 2022 guidance asked labeling to describe:
  - the purpose and intended user;
  - required inputs;
  - the basis (algorithm logic, underlying data and sources, validation results);
  - known limitations and missing data.
  It also raised automation bias as a concern.
- **Related FDA AI documents (prior knowledge; not re-fetched).** Final PCCP guidance for AI-enabled device software (Dec 2024) and the draft "AI-Enabled Device Software Functions: Lifecycle Management and Marketing Submission Recommendations" (Jan 2025) apply if the tool is a device.
- **EU AI Act timeline.**
  - Original schedule: high-risk obligations for Annex I products (including AI medical devices or safety components) were due 2 Aug 2027, and for Annex III on 2 Aug 2026.
  - Digital Omnibus: provisional agreement on 6 May 2026, confirmed by the Council on 13 May 2026. It sets Annex III to 2 Dec 2027 and Annex I to 2 Aug 2028, effective only on Official Journal publication (expected before 2 Aug 2026).
  - Sectoral overlap: the Commission may limit specific AI Act requirements where sectoral law (for example, MDR) imposes equivalent obligations — [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/); [techUK](https://www.techuk.org/insights/news/eu-ai-omnibus-deal-reached-more-clarity-on-ai-act-obligations); [Sidley, Dec 2025](https://datamatters.sidley.com/2025/12/10/eu-digital-omnibus-implications-for-medtech-companies/); [Baker McKenzie, Jan 2026](https://healthcarelifesciences.bakermckenzie.com/2026/01/08/medical-device-ai-in-limbo-eus-digital-overhaul-or-digital-headache-for-pharma-and-medtech/) [SECONDARY].

### Inferences
- **US: staying non-device.** To stay in Non-Device CDS for a research or prototype navigator:
  - restrict the intended user to HCPs;
  - display the NCCN guideline name, version and date, page or node ID, footnotes, and category of evidence for every recommendation;
  - show the patient inputs the agent used and the traversal path;
  - disclose LLM limitations and validation results;
  - avoid time-critical or patient-facing use;
  - present options rather than directives, except where the single-recommendation discretion clearly applies.
  Because the 2026 guidance is silent on LLMs, nondeterminism and hallucination risk should be addressed in labeling and validation evidence.
- **Research use.** A purely research system not marketed or used for clinical decisions generally falls outside FDA premarket requirements. Prospective clinical use should go through IRB review, and the investigational device exemption (IDE) / significant-risk determination should be considered. This is general regulatory reasoning, not legal advice.
- **EU.** Marketed clinical use would need MDR conformity assessment plus, from 2028, AI Act high-risk obligations (risk management, data governance, logging, human oversight, transparency).

### Gaps
- I did not read the FDA 2026 guidance text directly. The quotes come from law-firm summaries.
- I could not verify whether the Digital Omnibus was published in the Official Journal (expected by Aug 2026). Check EUR-Lex.
- No FDA statement specific to LLM-based CDS was found as of Oct 2026.
- UK MHRA, Health Canada, and other jurisdictions were not researched.

## 5. Version control and maintenance of encoded guidelines when NCCN updates

### Takeaway
NCCN publishes multiple numbered versions per guideline per year (for example, "Version X.YYYY"). The EULA says NCCN will make "reasonable efforts" to post updates but has no duty to notify. A computable navigator therefore needs its own change-detection and re-validation pipeline.

The most mature published model for this is the HL7 FHIR CRMI (Canonical Resource Management Infrastructure) artifact lifecycle, which CPG-on-FHIR builds on:
- draft → active → retired status;
- content frozen once active;
- every change produces a new version;
- semantic versioning, with version and version-algorithm requirements.

### Cited Findings
- **NCCN update duty.** "NCCN will make reasonable efforts to post updated versions of the NCCN Content", with no obligation to update or notify — [NCCN EULA via TOS Tracker](https://tostracker.app/document/nccn-eula).
- **CRMI lifecycle states.** Knowledge artifacts carry a status of draft, active, or retired, plus an `experimental` flag. In draft the version is not fixed. Once active, the content for that version is treated as fixed, so a change requires a new version introduced as draft — [HL7 CRMI IG, Artifact Lifecycle](https://hl7.org/fhir/uv/crmi/en/artifact-lifecycle.html) [PRIMARY].
- **CRMI versioning.** Semantic versioning is recommended for dependency management. Artifacts SHALL specify a version and SHOULD specify a version algorithm. Lifecycle phases are analyze → design → develop → testing → packaging → publish → implement. The current version is STU2 (2.0.0) — [HL7 CRMI IG STU2](https://hl7.org/fhir/uv/crmi/STU2/en/artifact-lifecycle.html) [PRIMARY].
- **Registry practice.** Registry concordance studies tie definitions to the guideline year or version in force at diagnosis, because definitions change across versions — [PMC7319034](https://pmc.ncbi.nlm.nih.gov/articles/PMC7319034) [PRIMARY].

### Inferences
- Design pattern for the navigator, adapted from CRMI:
  - store each NCCN guideline version as an immutable "active" artifact with a canonical ID, NCCN version string, and release date;
  - give each node or edge a stable identifier (NCCN page code plus a content hash);
  - on each new NCCN release, diff the PDFs and the NCCN "Updates" summary pages at the front of each guideline against the prior encoding;
  - mark changed nodes "draft" and re-run the affected regression vignettes and clinician fidelity review before promoting to "active";
  - retire the old version but keep it queryable for retrospective concordance evaluation.
- Evaluation sets should record which NCCN version each gold label was derived from, following the Chen et al. version-matching approach.
- An LLM-agent system should state the guideline version it is grounded on in every answer. This also supports FDA criterion 4 transparency.

### Gaps
- No published method was found for computable change tracking of NCCN specifically.
- Not retrieved this session:
  - the CPG-on-FHIR IG's own versioning page;
  - MAGICapp / MAGIC living-guideline and computable-update publications (I know of MAGICapp's structured, living recommendation format and its FHIR/EBMonFHIR work, but did not fetch sources);
  - WHO SMART Guidelines (L1–L5 layers).
- I found no official source for how many NCCN versions are released per year per guideline.
