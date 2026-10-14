# Task: build the patient-fact schema for one NCCN guideline

Input: `{ROOT}/llm/schema_input.txt`. Each line is one decision box from the guideline's flowcharts: `id | parent: <text> | box: <text>`. A box is either an entry box (where a patient starts) or one of several branches below its parent. Read the whole file.

Output: write `{ROOT}/fact_schema.json` with the Write tool. Content:

{"variables": {NAME: VAR, ...}, "derived": {NAME: DERIVED, ...}}

## VAR: raw facts read directly off a case description
- number: {"type": "number", "unit": U, "definition": "..."}. U must be one of: years, months, weeks, days, hours, cm, mm, kg, kg/m2, ng/ml, ng/dl, pg/ml, g/dl, mg/dl, u/ml, u/l, x10^9/l (cell counts), ml/min, gy, mmhg, pack-years, percent, count, score, grade, ratio, index. Examples: age_years, psa_ng_ml, psa_doubling_time_months, tumor_size_cm, ecog_score, positive_cores_count, positive_cores_percent, gleason_primary, gleason_secondary, life_expectancy_years, months_since_treatment_end, testosterone_ng_dl, hemoglobin_g_dl, platelets_x10e9_l, creatinine_clearance_ml_min, smoking_pack_years.
- enum: {"type": "enum", "values": [...], "definition": "..."}. List every value the guideline distinguishes, plus "other". Examples: histology, clinical_t_category ("T1a", "T1b", ..., "T4"), n_category, m_category, egfr_mutation ("exon19_deletion", "L858R", ..., "negative"), msi_status, prior_therapy_type, treatment_phase, resection_margin ("R0", "R1", "R2").
- bool: {"type": "bool", "definition": "..."}, only for a yes/no event or finding that a case states directly ("prior_adt_received", "symptomatic_bone_metastases", "patient_declines_surgery").

**Hard rules:**
1. Never encode a threshold or a judgement in a variable. No `psa_over_10`, `high_volume`, `life_expectancy_gt_10y`, `low_risk`, `elevated_cea`, or `large_tumor`. Store the raw number or category; the threshold belongs in the predicate.
2. Anything the guideline classifies by a rule goes in "derived", not in "variables". This includes risk group, stage group, disease volume, resectability where criteria are given, and "PSADT ≤10 months".
3. Use one variable per concept. Reuse it across all boxes; no synonyms.
4. Cover every condition in every box. If a box tests something, a variable or derived variable must express it. Clinician judgements that no case text can state as a fact (for example "patient is a candidate for X") are allowed as bool variables; give them a clear definition.

## DERIVED: classifications computed by code
{"type": "enum" | "bool", "definition": "...", "rules": [{"if": PREDICATE, "then": VALUE}, ...], "else": VALUE (optional)}

- Rules are tried in order; the first one that is true gives the value.
- Put the most specific or highest category first. For example, very high risk before high risk.
- Copy each threshold exactly as printed in the boxes.

PREDICATE format:
- a comparison: {"fact": NAME, "op": OP, "value": V}
  - OP is one of: == != > >= < <= in not_in
  - for in and not_in, V is a list
- {"all": [PREDICATE, ...]}
- {"any": [PREDICATE, ...]}
- {"not": PREDICATE}
- "at least two of" a list: {"atleast": 2, "of": [...]} is NOT supported. Write it as "any" over all pairs: {"any": [{"all": [a, b]}, {"all": [a, c]}, ...]}.

## Finish
After writing, read the file back and check that it is valid JSON. Reply only with the number of variables and derived variables. Do not quote guideline text in your reply.
