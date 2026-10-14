# Task: read raw patient facts off case descriptions

Inputs:
- `{ROOT}/fact_schema.json`. Read it first.
  - "variables" are the raw facts to extract.
  - "derived" are classifications, which code computes. Extract a derived one only when the case states it outright (for example "high-risk", "stage IIIA", "castration-resistant").
- `{INPUT}`: one JSON object per line: {"id", "case"}.

For EVERY case, go through EVERY variable in the schema and record each one the case states or directly implies by a named finding. For example, "CT and bone scan negative for metastases" gives the metastasis variables.

Output: write `{OUTPUT}` as one JSON object:
{"<case id>": {"<variable>": {"value": V, "unit": U, "quote": "<exact words copied from the case>"}, ...}, ...}

Value rules:
- Numbers: the raw number as written, with "unit" as written (years, months, weeks, days, cm, mm, ng/mL, ng/dL, %).
  - Never convert units and never compare to thresholds yourself.
  - A range or bound ("more than 20 years", "<6 months") becomes {"min": 20} or {"max": 6}.
  - Ages: "68-year-old" gives value 68, unit "years".
- Enums: exactly one of the schema's listed values, or omit the variable.
- Booleans: true or false, only when the case says so (a stated absence counts as false).
- quote: copy a short exact substring of the case (3–20 words) that supports the value. Never paraphrase.
- Changes over time: "value" is the patient's state NOW, at the decision the case asks about. If the case explicitly states a different EARLIER state for the same variable, also give "earlier": {"value": V, "quote": "<exact words>"}. Examples: imaging negative at CRPC diagnosis and new metastases now gives m_category value M1, earlier M0. Nodule 4 mm previously and 7 mm now gives value 7, earlier 4. Never invent an earlier state.
- Do not guess. If the case does not say it, leave the variable out. Do not use outside knowledge about what is typical.

Check that the file is valid JSON and has an entry for every case id. Reply only with the number of cases and the average number of facts per case.
