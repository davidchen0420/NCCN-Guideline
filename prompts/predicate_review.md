# Task: audit branch conditions written for NCCN flowchart boxes

Inputs:
- `{ROOT}/fact_schema.json`: the variables. Read it first. Derived variables are computed by code from their rules.
- `{INPUT}`: one JSON object per line: {"id", "parent", "box", "predicate"}.

The predicate is supposed to be true exactly when a patient at `parent` belongs in `box`. For an entry box, it is true exactly when the patient's situation is the one the box describes.

For each line, give one verdict:
- **correct**: the predicate faithfully encodes the box's condition.
  - Thresholds and their direction (> vs >=) must match the text.
  - Enum values must exist in the schema.
  - Nothing important from the box is missing, and nothing is added that the box does not say.
- **wrong**: anything else. This includes a reversed or wrong threshold, a wrong variable, a missing condition, an extra condition, or a predicate that is always true or false.

Write `{OUTPUT}` as JSON: `{"<id>": {"verdict": "correct" | "wrong", "note": "<at most 15 words>"}, ...}`, covering every id.

Be strict: when unsure, say wrong. Reply only with the counts of correct and wrong.
