# Classic Computer-Interpretable Guideline (CIG) Formalisms, Standards, and Open-Source Engines for Encoding Oncology/NCCN Guidelines

Scope note: about 18 search/fetch calls (2026-10-13). Findings marked **[VALIDATED]** come from a peer-reviewed evaluation that reports numbers. Findings marked **[DESCRIBED]** come from a specification, prototype, or vendor claim. Items marked "(not verified this session)" come from background knowledge and were not re-checked against a source in this session. Treat them as leads.

## 1. Which formalisms/standards exist, are they maintained, and are they open-source?

### Takeaway
The older academic CIG languages are now mostly research or legacy tools. These include GLIF/GLEE, PROforma, Asbru, SAGE, EON, GUIDE and GLARE. The standards that are actively maintained and open-source are three:
- HL7 CQL with the FHIR Clinical Practice Guidelines IG (CPG-on-FHIR, STU2 published 2024-11-26)
- the WHO SMART Guidelines DAK→FHIR/CQL layer model
- openEHR GDL2

The only open-source, oncology-specific pathway engine found is MITRE's Camino/mCODE pathways prototype (CQL + mCODE, Apache-2.0).

### Cited Findings
**HL7 CQL + CPG-on-FHIR**
- [DESCRIBED] The FHIR Clinical Practice Guidelines IG "provides a means of creating a computable representation of a narrative clinical guideline" for CDS, quality measures and documentation. The current published version is 2.0.0 (STU2). CQL guidance has moved to the separate "Using CQL with FHIR" IG — [HL7 CPG IG](https://hl7.org/fhir/uv/cpg/index.html); [CPG build](https://build.fhir.org/ig/HL7/cqf-recommendations/en/index.html)
- STU1 (v1.0.0) has been superseded by 2.0.0, active as of 2024-11-26. The STU1 page lists known publication-tooling defects (broken links, grouping errors) — [CPG STU1](https://hl7.org/fhir/uv/cpg/STU1/)
- In the CPG IG, CQL data requirements can be read statically from the Library resource or derived via the `$data-requirements` operation. This supports checking which FHIR data a pathway needs before it runs — [CPG profiles](https://build.fhir.org/ig/HL7/cqf-recommendations/en/profiles.html)
- The original 2019 proposal says guideline developers such as CDC and WHO planned content IGs on top of CPG and so have an interest in maintaining it — [HL7 wiki proposal](https://wiki.hl7.org/Clinical_Guidelines_FHIR_IG_Proposal)
- An IHE "Computable Care Guidelines" (QRPH CCG) profile constrains the HL7 CPG IG. Its stated aim is to scale "conformance-testable, concurrently executable guidelines" across OECD and LMIC settings — [IHE CCG](https://build.fhir.org/ig/IHE/QRPH.CCG/CCG_v1_over.html)
- [DESCRIBED] A 2021 Applied Clinical Informatics study compared Arden Syntax and CQL for CDS. Both have constructs that fully or partially address several categories, but Arden has gaps in data models and terminologies — [Thieme ACI 2021](https://www.thieme-connect.com/products/ejournals/html/10.1055/s-0041-1731001)

**Oncology CQL content and engines**
- [DESCRIBED] The CQF "Colorectal Cancer Concepts" IG has a Colorectal Cancer Screening CDS PlanDefinition, a quality measure and a HEDIS variant, all on CQL libraries. It is a continuous build that "changes regularly" — [cqf-ccc](https://build.fhir.org/ig/cqframework/cqf-ccc/artifacts.html)
- A lung cancer screening CQL example exists in the cqframework `lcs-cds` repo. AHRQ CDS Connect also hosts several CQL artifacts — [FHIR chat archive](https://chat-archive.fhir.org/stream/179220-cql/topic/CQL.20and.20CDS.20for.20ANC.20and.20cancer.20screenings.html)
- Not verified this session: CDS Connect (cds.ahrq.gov) also offers an open-source Authoring Tool (CQL) and the CQL Services engine.

**mCODE and Camino (oncology data model and pathway engine)**
- [DESCRIBED] mCODE is the HL7 FHIR oncology data model. STU2 was balloted in 2021 and a 4.0.0 continuous build exists. Elements were down-scoped to those likely found in current EHRs — [mCODE IG 2021May](https://hl7.org/fhir/us/mcode/2021May/index.html); [mCODE build](https://build.fhir.org/ig/HL7/fhir-mCODE-ig/index.html)
- A 2025 JMIR Cancer paper notes that mCODE (37+ profiles) centres on diagnosis and treatment and covers screening poorly — [JMIR Cancer 2025](https://cancer.jmir.org/2025/1/e79011)
- [DESCRIBED] MITRE's Camino (`mcode/pathways`) is a prototype SMART-on-FHIR app (Apache-2.0, ©2020, about 849 commits). It reads mCODE data from the EHR, uses CQL in pathway definitions to place the patient on a structured oncology pathway, and suggests next steps. No published validation was found. Its README does not name NCCN content — [GitHub mcode/pathways](https://github.com/mcode/pathways)
- A companion visual "pathway-builder" authoring tool exists — [pathway-builder](https://proxy-ga.blitzz.co/proxy/123456/github.com/mcode/pathway-builder)

**WHO SMART Guidelines**
- [DESCRIBED] The Digital Adaptation Kit (DAK, layer L2) is "the primary artefact" of WHO SMART Guidelines. It holds software requirements: data dictionary, decision tables and algorithms — [WHO SMART Base IG](https://build.fhir.org/ig/WorldHealthOrganization/smart-base/index.html)
- Layer L3 "transforms L2 DAK components into standards-based software code" (FHIR IG), and the logic may be encoded in CQL — [SMART ICVP](https://build.fhir.org/ig/WorldHealthOrganization/smart-icvp/adapting.html); [WHO L3 page](https://www.who.int/tools/CCC/l3-implementation-guide)
- WHO's Em Care app is fully open-source and FHIR-native, built on the Android FHIR SDK with FHIR/CQL support — [Swiss TPH newsletter](https://newsletter.swisstph.ch/c/83516590/5e313c590-rvl24o)
- No WHO SMART oncology DAK was found. Published DAKs cover antenatal care, immunization, HIV, family planning and similar areas (not verified this session).

**openEHR GDL / GDL2**
- [DESCRIBED] GDL2 is a formal, terminology- and EHR-model-agnostic language that expresses CDS logic as chained production rules. It covers alerts, single-screen decision apps, order sets, care-process support and calculators. It can output CDS-Hooks cards and bind to openEHR, ISO 13606 or FHIR — [openEHR GDL2 spec](https://specifications.openehr.org/releases/CDS/latest/GDL2.html); [GDL2 release news](https://openehr.org/news_events/releases/273); [Australian Digital Health Agency listing](https://developer.digitalhealth.gov.au/standards/guideline-definition-language-v2-gdl2-vcds-2-0-1)
- [VALIDATED, but not oncology] openEHR cites a GDL stroke-prevention app "clinically validated by a large scale randomized clinical trial" led by Linköping University Hospital cardiologists — [openEHR release](https://openehr.org/news_events/releases/273)
- A 2021 GDL meta-model paper targets model-driven engineering, not clinical evaluation — [SciTePress 2021](https://scitepress.org/PublishedPapers/2021/105434)

**Arden Syntax**
- [DESCRIBED] Medexter (Adlassnig) deployed Arden-based SOP checking for melanoma patients on chemotherapy at Vienna General Hospital. Only the deployment is reported, with no outcome numbers — [Adlassnig slides](https://www.gmds.de/fileadmin/user_upload/aktuelles-termine/DMEA/2012/120423_Adlassnig_Klaus_Peter.pdf)
- A 1999 AMIA study turned breast-cancer trial eligibility criteria into executable statements using an Arden derivative — [PMC2232554](https://pmc.ncbi.nlm.nih.gov/articles/PMC2232554)
- Arden encodes single-decision Medical Logic Modules (MLMs). This is known to suit poorly the multi-step plans found in oncology (see Q3).

**BPMN + DMN**
- [DESCRIBED, partially evaluated] CDC contraceptive-eligibility guidance was modeled in BPMN and DMN. The authors conclude these notations "can be used to successfully create models for clinical pathways", but defining data elements was "the biggest challenge" and validation was left to future work — [PMC6924335](https://pmc.ncbi.nlm.nih.gov/articles/PMC6924335)
- Martínez-Salvador and Marcos built algorithms that refine BPMN clinical-process models into PROforma CIGs and applied them to several guidelines — [UJI repository](https://repositori.uji.es/xmlui/handle/10234/163759)
- Trisotech (commercial BPMN/DMN/CMMN vendor) recommends a modular, decision-first design for guideline maintenance and reuse — [Trisotech](https://trisotech.com/?p=31061)
- No oncology BPMN/DMN evaluation was found.

**Classic academic CIGs**
- Peleg et al. (JAMIA 2003) compared six CIG models through case studies: Asbru, EON, GLIF, GUIDE, PRODIGY and PROforma — [PMC150359](https://pmc.ncbi.nlm.nih.gov/articles/PMC150359)
- Peleg (J Biomed Inform 2013) published a methodological review of CIGs since their inception — [Haifa record](https://cris.haifa.ac.il/en/publications/computer-interpretable-clinical-guidelines-a-methodological-revie/)
- A review of Arden, GLIF, PROforma, Asbru, GLARE and SAGE from an AI perspective assessed how well each addresses the limits of paper guidelines — [RCAAP record](https://www.rcaap.pt/vufind/PublicationRecord/rum_af0ba20e82a91129ed7a6d3c8693df03)
- GLARE (Piovesan, Terenziani et al., Univ. Piemonte Orientale) has tools that check guideline well-formedness and correctness by model checking — [UniUPO](https://research.uniupo.it/it/publications/automatic-checking-of-the-correctness-of-clinical-guidelines-in-g-2/)
- A 2000s AMIA paper evaluated Arden, GLIF and PROforma against quality and safety requirements for executable guidelines — [PMC2244058](https://pmc.ncbi.nlm.nih.gov/articles/PMC2244058)
- A four-phase evaluation model for CDS architectures was applied to Arden, GLIF, SEBASTIAN and SAGE — [PubMed 18462999](https://pubmed.ncbi.nlm.nih.gov/18462999)

**OHDSI**
- Not verified this session: OHDSI `TreatmentPatterns` (R package) and ATLAS pathway analysis describe observed treatment sequences in OMOP data retrospectively. They do not execute guidelines, but could serve concordance auditing.

### Inferences
- For an NCCN-Navigator-like system in 2026, the maintained, open, standards-based path is mCODE/FHIR data + CQL logic + CPG PlanDefinitions (or WHO-style L2 decision tables feeding L3 CQL), invoked through CDS Hooks. Engines include CQF tooling and the CQL-to-ELM translator.
- Of the older CIG languages, only PROforma (via the BPMN→PROforma work) and GLARE (verification tooling) show visible activity in the results. None appears to have an actively maintained open-source oncology content library.
- GDL2 is technically capable and has one RCT-validated (non-oncology) app, but its ecosystem outside openEHR shops is small.

### Gaps
- GitHub last-commit dates and licences were not verified for: the CQL engine (cqframework), cqf-ruler/HAPI CR, the CDS Connect authoring tool, GDL2 tools (Cambio), Asbru/DELT, Tallis/OpenClinical PROforma, GLEE, and the SAGE engine.
- Camino's last commit date and archive status could not be confirmed.
- No WHO SMART oncology DAK was confirmed.

## 2. Which have been used to encode NCCN or other oncology guidelines, and what validation was published?

### Takeaway
The strongest peer-reviewed numbers for a guideline-encoding CDSS in oncology come from OncoDoc/OncoDoc2. These are French breast-cancer guideline decision trees, not NCCN. Results:
- compliance rose from 61% to 85% (OncoDoc) and from 79% to 93% (OncoDoc2)
- 8.3% residual non-compliance across 1,624 decisions
- an RCT (NCT00728442) whose results were not found

No peer-reviewed study validating a formal CIG encoding of NCCN itself was found. Commercial pathway programs (Via Oncology/ClinicalPath, Dana-Farber pathways, US Oncology Value Pathways, payer NCCN-based CDS) report cost and adherence numbers. Most are before-after or vendor-sponsored. A 2020 systematic review rates the overall evidence low to very low.

### Cited Findings
**OncoDoc / OncoDoc2 (breast cancer, France)**
- [VALIDATED] OncoDoc (Bouaud 2001, Gustave Roussy): physician compliance rose from 61.42% to 85.03% (p<10⁻⁴) over 127 multidisciplinary-team (MDT) decisions. Initial decisions changed in 31% of cases. Design: single-centre before-after — [Klarenbeek 2020 review](https://pmc.ncbi.nlm.nih.gov/articles/PMC7226340/); [OncoDoc2 search summary / PubMed 18693918](https://pubmed.ncbi.nlm.nih.gov/18693918/)
- [VALIDATED] OncoDoc2 (Séroussi 2007, Tenon hospital, CancerEst guideline): MDT compliance rose from 79.2% to 93.4% (p<10⁻⁵), n=316. There was no control arm, so the gain cannot be firmly attributed to the system — [PubMed 18693918](https://pubmed.ncbi.nlm.nih.gov/18693918/); [Klarenbeek 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7226340/)
- [VALIDATED] OncoDoc2 navigation quality mattered. Over 557 decisions, compliance was 94.2% with correct navigation, 80.0% with incorrect navigation and 90.2% with missing navigation — [PMC3778303](https://pmc.ncbi.nlm.nih.gov/articles/PMC3778303)
- This is directly relevant to LLM agents that "navigate" a tree: wrong patient-state abstraction reduces concordance.
- [VALIDATED] Over 2007–2009, 1,624 invasive breast-cancer decisions had 8.3% non-compliance despite the CDSS. Age >80 was associated with non-compliance in pre-surgical decisions, along with other factors for re-excision and adjuvant decisions. The authors partly attribute residual non-compliance to gaps in guideline content for some patient profiles — [HAL 02489165](https://hal-ensta-paris.archives-ouvertes.fr/UPMC/hal-02489165v1)
- RCT NCT00728442 (Dec 2008–Apr 2010, completed) tested OncoDoc2's impact on MDT compliance. Its results were not retrieved — [ClinicalTrials.gov](https://clinicaltrials.gov/study/NCT00728442)
- A BJC 2013 article on OncoDoc2 exists but was paywalled — [BJC](https://www.nature.com/articles/bjc2013453)

**Other guideline-based oncology CDSS (Klarenbeek 2020 systematic review: 9 studies, 7,985 patients, all before-after, none RCT)**
- [VALIDATED] Rios 2003 (Oncolor/CancerEst):
  - breast adherence rose from 77.8% to 87.1% (p=0.02)
  - prostate adherence rose from 86.7% to 89.9% (p=0.35, not significant)
  - Source: [Klarenbeek 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7226340/)
- [VALIDATED] Christ 2018 (NCCN-based pain CDS): guideline-adherent regimens went from 40.0% to 46.9%, not significant, n=62 — [Klarenbeek 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7226340/)
- [VALIDATED] Adeboyeje 2017 (lung) and Agiro 2018 (breast) both used NCCN/ASCO-based CDS. Colony-stimulating factor (CSF) use fell from 48.4% to 35.6% and from 74.9% to 68.5% respectively. Neither study measured adherence — [Klarenbeek 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7226340/)
- [VALIDATED] Bertsche 2009 (WHO pain principles): deviations from the guideline at discharge fell from 74% to 14% (p<0.001) — [Klarenbeek 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7226340/)
- Review conclusion: higher-level CDSS improved process outcomes and guideline adherence, but no clinical-outcome benefit was shown. Risk of bias was critical in 6 studies and serious in 3. GRADE was low or very low. Most studies were single-centre, concentrated on breast and lung cancer — [Klarenbeek 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7226340/); [MDPI](https://www.mdpi.com/2072-6694/12/4/1032)

**Pathway programs (proprietary encodings, NCCN-derived or NCCN-aligned)**
- [VALIDATED, cohort] Dana-Farber Clinical Pathways (Jackman 2017, stage IV NSCLC, n=370):
  - adjusted 1-year cost $69,122 before vs $52,037 after (p=0.01)
  - median overall survival (OS) 10.7 vs 11.2 months (p=0.08)
  - Source: [Klarenbeek 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7226340/)
- [VALIDATED, cohort; figures inconsistent across secondary sources] Via Oncology (Neubauer, J Oncol Pract 2010, NSCLC): on-pathway patients had similar OS at about 30–35% lower cost. One secondary source gives $18,042 vs $27,737 first-line cost (2006–07). Page numbers and exact figures differ between secondary sources — [Managed Care 2010](https://www.managedcaremag.com/?p=19267); [HMP JCP](https://hmpgloballearningnetwork.com/site/jcp/interview/optimizing-nsclc-clinical-pathways)
- [DESCRIBED, vendor] Via Oncology is now Elsevier ClinicalPath:
  - Aurora: 85% of NSCLC patients on pathway within 3 months — [AJMC](https://ajmc.com/view/third-party-validation-of-observed-savings-from-an-oncology-pathways-program)
  - Cone Health ASCO 2023 poster (press release): on-pathway patients were about half as likely to die at 3, 6 and 12 months, and contribution margin rose 74% — [Elsevier press release](https://www.elsevier.com/about/press-releases/new-study-shows-elseviers-clinicalpath-can-help-support-oncologists-to-improve-outcomes-for-oncology-patients-and-manage-the-cost-of-care)
  - Mortality comparisons of this kind are heavily confounded.
- [VALIDATED, cohort] US Oncology Value Pathways (2020 analysis): mean total cost of care was 19% lower on-pathway, with no significant difference in median OS — [HMP JCP](https://www.hmpgloballearningnetwork.com/site/jcp/article/treatment-pathways-first-line-metastatic-non-small-cell-lung-cancer-cost-and-survival)
- [DESCRIBED, company-authored] A payer-run NCCN-based CDS program reported weighted cumulative NCCN adherence rising from 75% (month 1) to 88% (month 12) — [HMP JCP](https://hmpgloballearningnetwork.com/site/jcp/article/use-clinical-decision-support-and-peer-review-increase-nccn-guideline-adherence)
- [VALIDATED, cohort] A community prostate-cancer study found a significantly greater drop in single-agent docetaxel use at CDS-enabled sites after a guideline update. This is evidence that encoded CDS can propagate guideline updates faster — [HMP JCP abstract](https://hmpgloballearningnetwork.com/site/jcp/abstracts/impact-ehr-embedded-clinical-decision-support-cds-tool-guideline-adoption)
- [VALIDATED] Colon cancer: higher concordance with a reference pathway was associated with lower mortality and significantly lower health-system cost. The pathway was not Via or ClinicalPath — [PMC10075281](https://pmc.ncbi.nlm.nih.gov/articles/PMC10075281)

**Asbru in oncology**
- [DESCRIBED] The Oncocure project (MIE 2009) encoded a breast-cancer protocol in Asbru and linked the interpreter to an EHR. Better adherence was projected, not measured — [TU Wien MIE2009](https://www.cvast.tuwien.ac.at/sites/default/files/bibcite/76/MIE2009p0663.pdf)

**Ontology-based cancer pathways**
- [DESCRIBED] Abidi/Daniyal (Dalhousie) built an OWL/OWL-S prostate-cancer clinical-pathway ontology with UML activity diagrams — [AIME 2009](https://web.cs.dal.ca/~sraza/papers/aime09uml.pdf); [prostate CP](https://web.cs.dal.ca/~sraza/papers/prostate_cancer_cp.PDF)

**"Computable NCCN"**
- No published machine-readable NCCN representation was found. A radiation-oncology informatics commentary states that one "is currently not available" and argues guidelines must become machine-readable — [CORE](https://core.ac.uk/outputs/188636689)
- Guideline Central sells FHIR/CQL conversion of guidelines (commercial). It does not name NCCN — [Guideline Central](https://www.guidelinecentral.com/solutions/computable-guidelines/)

**Other**
- Italian AIOM RIGHT program: observed adherence was 69% in breast, 76% in colorectal and 69% in lung cancer. This is a baseline from an observational audit, not a CIG evaluation — [ISPOR](https://www.ispor.org/heor-resources/presentations-database/presentation/ispor-17th-annual-european-congress/an-italian-oncology-research-to-evaluate-adherence-to-clinical-guidelines-for-cancer-treatment-the-right-program)

### Inferences
- The best-validated design pattern is OncoDoc2's "guided navigation of a guideline decision tree with clinician in the loop." It has before-after data and an RCT registration. The navigation-quality finding (94% vs 80% compliance) argues for logging and auditing each branch choice an LLM agent makes.
- The evidence that encoded NCCN-aligned pathways improve adherence and cost is consistent but low-grade (cohort, vendor). No RCT shows clinical-outcome benefit.
- Encoding accuracy itself (fidelity of encoding versus the source guideline) is almost never reported numerically in classic CIG oncology work.

### Gaps
- Results of the OncoDoc2 RCT (NCT00728442) and the BJC 2013 OncoDoc2 paper were not retrieved.
- No peer-reviewed evaluation was found for Eviti (NantHealth), MD Anderson or Mayo pathway encodings, or ASCO CancerLinQ guideline logic (not searched in depth).
- No peer-reviewed encoding-fidelity numbers were found for any CQL oncology artifact.

## 3. What does the literature say about strengths, weaknesses, expressiveness for multi-branch oncology algorithms, and maintenance cost?

### Takeaway
Comparative reviews show the classic CIGs model task networks (plans, decisions, actions) well. Recurring weaknesses are data and terminology binding and the cost of expert authoring. BPMN/DMN and FHIR-era work identifies data-element definition as the main bottleneck. No 2022–2026 review that quantifies maintenance cost under frequent guideline updates (as with NCCN) was found.

### Cited Findings
- Peleg 2003 compared Asbru, EON, GLIF, GUIDE, PRODIGY and PROforma. It found shared core constructs: plans and actions, decisions, patient-state, and expressions. It also found differences in decision representation and nesting — [PMC150359](https://pmc.ncbi.nlm.nih.gov/articles/PMC150359)
- Peleg 2013 (JBI methodological review) argues that formalization enables CIG-based CDS and verification — [Haifa](https://cris.haifa.ac.il/en/publications/computer-interpretable-clinical-guidelines-a-methodological-revie/)
- The Arden-vs-CQL comparison flags Arden's data-model and terminology gaps — [ACI 2021](https://www.thieme-connect.com/products/ejournals/html/10.1055/s-0041-1731001)
- In BPMN/DMN modeling, integrating clearly defined data elements was "the biggest challenge" — [PMC6924335](https://pmc.ncbi.nlm.nih.gov/articles/PMC6924335)
- Authoring cost: the CAREPATH project needed domain experts to co-author 296 formally defined CDS rules in CQL. This is cited as evidence that CQL authoring is "expert-driven and costly" — [PathWISE arXiv 2605.25970](https://arxiv.org/pdf/2605.25970)
- Verification: GLARE adds automatic model-checking of guideline correctness. This is useful when re-encoding after updates — [UniUPO](https://research.uniupo.it/it/publications/automatic-checking-of-the-correctness-of-clinical-guidelines-in-g-2/)
- Update propagation: CDS-enabled practices shifted docetaxel use faster after a guideline update — [HMP JCP](https://hmpgloballearningnetwork.com/site/jcp/abstracts/impact-ehr-embedded-clinical-decision-support-cds-tool-guideline-adoption)
- OncoDoc2 authors attribute part of residual non-compliance to guideline content gaps for edge patient profiles. In practice an encoding cannot exceed the guideline's coverage — [HAL](https://hal-ensta-paris.archives-ouvertes.fr/UPMC/hal-02489165v1)
- A 2022 systematic-review protocol on guideline-oriented ontological CDSS lists CIG models, rule languages and evaluation methods as outcomes — [Systematic Reviews 2022](https://systematicreviewsjournal.biomedcentral.com/articles/10.1186/s13643-022-02063-7/tables/1)

### Inferences
- NCCN algorithms (multi-branch flowcharts with footnotes, "category 2A/2B" evidence levels and "consider" options) map most naturally to:
  - decision tables (DMN, or WHO L2 decision tables)
  - PlanDefinition action trees with CQL conditions
  - footnotes and evidence categories carried as annotation, not logic
- Classic CIGs can express this, but their tooling is orphaned.
- Given NCCN's several updates per year, versioned, diffable artifacts are preferable. CQL libraries plus FHIR resources in git meet this need better than GUI-only CIG editors.
- Static `$data-requirements` analysis helps flag which encodings an update breaks.

### Gaps
- No review (2018–2026) quantifying CIG maintenance effort per guideline version was found.
- No study measuring expressiveness specifically for NCCN footnotes or evidence categories was found.
- Recent CIG reviews (e.g., Peleg/Terenziani follow-ups, 2018+ surveys) were not retrieved.

## 4. Validated methods and tools for semi-automatically authoring CIGs from narrative or flowchart guidelines

### Takeaway
Pre-LLM, the main markup approach is the Yale GEM / GEM Cutter line (XML markup of guideline text). It was evaluated only for usability and inter-annotator variation, and showed considerable variation. DeGeL and Stepper-type staged authoring tools were not retrieved. In 2026, PathWISE (arXiv preprint) uses LLM agents to convert NHS cancer-pathway flowcharts into CQL/CDS Hooks with compile checks, but without clinical validation.

### Cited Findings
- [DESCRIBED] GEM (Guideline Elements Model, Shiffman, Yale) is an XML document model with 100+ elements in 8 major branches, including Knowledge Components. GEM Cutter marks up guideline text into GEM XML. A bibliometric source reports 563 downloads since 2000 — [GEM JAMIA full text](https://gem.med.yale.edu:443/Publications/GEM-jamia-sept200-fulltext.pdf); [CDC deck](https://www.cdc.gov/os/quality/docs/TransformingGuidelineKnowledgeintoDecisionSupport.pdf); [PMC2243348](https://pmc.ncbi.nlm.nih.gov/articles/PMC2243348/?page=5)
- [VALIDATED, small usability study] Karras, Nath and Shiffman (AMIA 2000) had 8 subjects mark up the AAP febrile seizure guideline. They used between 46 and 149 elements, showing "considerable variation in the application of elements" — [karras_amia2000](https://gem.med.yale.edu:443/Publications/karras_amia2000.pdf)
- [DESCRIBED] Downstream GEM tools:
  - GEM-Q: automated guideline quality scoring — [GEM-Q abstract](https://gem.med.yale.edu/Publications/abha_mdm_gem-q_sept2000_abstract.htm)
  - GEM→Arden MLM generator — [Agrawal AMIA 2001](https://gem.med.yale.edu:443/Publications/AgrawalAMIA2001_MLMs.pdf)
  - Cocoon-based implementation framework — [Gersh AMIA 2001](https://gem.med.yale.edu:443/Publications/GershAMIA2001GEMImplem.pdf)
- [DESCRIBED] BPMN→PROforma refinement algorithms (Martínez-Salvador and Marcos) were applied to several guidelines — [UJI](https://repositori.uji.es/xmlui/handle/10234/163759)
- [DESCRIBED, preprint, May 2026] PathWISE (Birmingham City Univ., MBZUAI, Qatar Univ., UHB NHS, NHS England):
  - Four LLM agents, a deterministic path-enumeration auditor and a Java CQL-to-ELM compile check convert visual cancer-pathway flowcharts into executable CQL served via CDS Hooks.
  - Tested on 5 NHS England cancer pathways: colorectal, lung, skin, upper GI and breast.
  - Up to 183 nodes audited, 544 governance findings, 100% compile success.
  - Limitations: terminology needs manual curation, ambiguous criteria cannot be auto-resolved, and live clinical evaluation is still needed.
  - Source: [arXiv 2605.25970](https://arxiv.org/pdf/2605.25970)

### Inferences
- Pre-LLM semi-automatic authoring (GEM, staged markup) showed low inter-author consistency. This argues for dual independent encoding plus adjudication, and for deterministic auditing (path enumeration, compile checks) of any LLM-generated encoding of NCCN flowcharts.
- PathWISE's compile-success metric is structural, not clinical. It does not measure concordance with the guideline.

### Gaps
- DeGeL (Shahar's Digital electronic Guideline Library), Stepper (Svátek/Růžička) and Uruz were not retrieved in this session, so their evaluation numbers are unverified.
- No validated pre-LLM tool that parses NCCN PDF flowcharts was found.
