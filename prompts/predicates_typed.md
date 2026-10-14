# Task: classify decision boxes and write their conditions

Read `/home/user/NCCN-Guideline/prompts/predicates.md` for the PREDICATE format and rules, then `{ROOT}/fact_schema.json`, then `{INPUT}`.

`{INPUT}` has one JSON object per line: {"id", "parent", "box", "siblings", "section"?, "footnotes"?, "rejected"?, "page_heading"?}. An entry box (parent "(entry box ...)") with "page_heading": the heading says which patients the page is for (e.g. "M1 castration-sensitive prostate cancer"); when the box itself is a workup or treatment list, its type is "condition" and its predicate encodes the heading; its siblings are the page's other entry boxes. "rejected" gives an earlier condition for this box that a reviewer rejected, with the reason: do not repeat its mistake.

For every id decide the box's type:
- "condition": the box describes the patient (a finding, stage, risk group, response, timing). Write the predicate that is true exactly when the patient belongs in this box rather than its siblings.
- "option": the box is one of several treatment or management choices for the same patient (e.g. "Radical prostatectomy" next to "Radiation therapy"). Choices are not patient facts, so "predicate" is null. If the schema has a history variable that records whether the patient already received this option (e.g. "definitive_treatment_received"), write "received": the predicate that is true when the patient received it; otherwise "received" is null.
- "other": anything else (a workup list, a note, a link). "predicate" is null unless the box states a condition.

Output: write `{OUTPUT}` as one JSON object:
{"<id>": {"type": "condition|option|other", "predicate": PREDICATE or null, "received": PREDICATE or null}, ...}
with an entry for every input id. A wrong condition is worse than null. Check that the file is valid JSON. Reply only with the counts per type and the number of non-null predicates.
