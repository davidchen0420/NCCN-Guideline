# Task: extend a patient-fact schema so every decision box can be encoded

Read, in this order:
1. `/home/user/NCCN-Guideline/prompts/fact_schema.md`: the rules the schema follows (formats, units, hard rules).
2. `{ROOT}/fact_schema.json`: the current schema.
3. `{ROOT}/llm/schema_extend_input.txt`: decision boxes that still have no usable condition. Each line is `id | section | parent | box | footnotes | review note`. A review note means an earlier condition was rejected and why.

Edit the schema so that these boxes CAN be encoded, then rewrite `{ROOT}/fact_schema.json`.

Rules (in addition to fact_schema.md):
- Never rename or delete an existing variable or derived variable, and never remove enum values. You may add enum values, add variables, and add derived variables.
- Add a "time" field to every variable: "current" (the patient's state at the decision now), "at_diagnosis" (the state when first diagnosed; add such a variable only if a box conditions on the state at diagnosis, e.g. "initial risk group"), or "history" (something that happened before: prior treatment received, prior response, prior duration).
- Treatments a box may depend on having received: add history variables, e.g. an enum "definitive_treatment_received" with the options the guideline lists, or bools such as "prior_docetaxel_received", and numbers such as "prior_adt_duration_months".
- A yes/no variable that lumps several findings (e.g. "adverse pathologic features") stays, but add a raw bool for each finding the guideline lists (e.g. positive margins, seminal vesicle invasion, extracapsular extension, detectable PSA) and add a derived variable "<name>_from_findings" whose rule is "any" of them.
- Every derived variable gets "criteria_source": "guideline" if its criteria are printed in the boxes or footnotes (copy them exactly), or "external: <named definition>" if the box names a published definition (e.g. "CHAARTED") and you use that definition.
- A variable that is a clinician's judgement (e.g. "clinician judges oligometastatic") gets "judgment": true and "criteria": the guideline's own words for it from the boxes or footnotes, or "" if the guideline gives none.
- Add missing raw variables a box needs (imaging results such as PSMA PET findings, nadir values, performance status, prior therapies, durations). Use the units listed in fact_schema.md.
- Leave a box unencodable rather than invent criteria the guideline does not state.

Check that the file is valid JSON. Reply only with the counts of variables added and derived variables added.
