# Task: write a branch condition for each decision box of an NCCN flowchart

Inputs:
- `{ROOT}/fact_schema.json`: the variables you may use. "variables" are raw facts; "derived" are classifications computed by code from the raw facts. Read it first.
- `{INPUT}`: one JSON object per line: {"id", "parent", "box", "siblings"}.
  - A box with parent "(entry box ...)" is where a patient enters this part of the guideline.
  - The condition must be true exactly when a patient belongs in this box.
  - Otherwise the box is one of several branches below `parent`. The condition must be true exactly when a patient at `parent` should take this branch rather than one of its `siblings`.

Output: write `{OUTPUT}` as a single JSON object {"<id>": PREDICATE or null, ...} with an entry for every input id.

PREDICATE format:
- a comparison: {"fact": NAME, "op": OP, "value": V}
  - OP is one of: == != > >= < <= in not_in
  - for in and not_in, V is a list
- {"all": [PREDICATE, ...]}
- {"any": [PREDICATE, ...]}
- {"not": PREDICATE}
- NAME must exactly match a key in the schema's "variables" or "derived".
- Thresholds are copied exactly from the box. Use the variable's unit: numbers are numbers, not strings. Enum values must come from that variable's "values" list. For a derived variable, use the values its rules produce.

Rules:
- Encode only what the box says. Branches under one parent should be mutually exclusive.
- Use null when:
  - the box is a treatment or recommendation rather than a condition (for example a list of therapy options under a single parent: those are choices, not patient conditions);
  - or the condition needs a variable the schema does not have;
  - or the condition needs a judgement that is not a fact.
  Do not invent variables. A wrong condition is worse than null.
- For "See X" or link-only boxes, encode the condition stated in the box or its parent. If there is none, use null.

Check that the file is valid JSON. Reply only with the counts of non-null and null predicates.
