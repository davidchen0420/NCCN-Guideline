# Task: fix problems in a patient-fact schema

The schema at `{ROOT}/fact_schema.json` was built under the rules in `/home/user/NCCN-Guideline/prompts/fact_schema.md`. Read both files and `{ROOT}/llm/schema_input.txt`.

An automatic checker reported these problems:
{PROBLEMS}

Fix every problem:
- A variable that encodes a threshold or a classification the guideline defines by criteria (for example "high volume", "high-risk biochemical recurrence", "castration resistant") becomes a DERIVED variable.
  - Its rules use raw variables, and you add any raw variables it needs (for example counts, testosterone, PSA doubling time, interval in months, sites of metastasis).
  - Copy the criteria exactly as the guideline states them. If the boxes do not state the criteria, use the standard published definition named in the box, and say so in "definition".
- Keep the derived variable's name. If a case explicitly states the classification (for example "diagnosed with CRPC"), code accepts that stated value instead of the rules.
- A false alarm (for example a gene name containing a digit) needs no change; just leave it.

Then add any raw variable that a box needs but the schema lacks.

Rewrite `{ROOT}/fact_schema.json` and check that it is valid JSON. Reply only with the counts of variables and derived variables.
