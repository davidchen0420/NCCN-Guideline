# Task: answer multiple-choice questions on NCCN guideline management

`{INPUT}` has one JSON object per line: {"id", "case", "options": {"A": "...", ...}}.

For each case, choose the single option that the NCCN Guidelines recommend as the next step for this patient, using only your own knowledge.

Write `{OUTPUT}` as one JSON object {"<id>": "<letter>", ...}, covering every id.

Reply only with the number of answers written.
