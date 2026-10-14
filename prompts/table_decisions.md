# Task: turn NCCN table and list pages into structured decision rows

Input: `{BATCH}`, one JSON object per line: {"page", "image", "text", "out"}.
- `image` is a PNG of the page.
- `text` is the page's own text, one printed line per row as `y=<top> x=<left> | <text>` (PDF points; y grows downward). Superscript footnote letters are already removed.

For EACH line of the batch:
1. View the image with the Read tool, then read the text file.
2. Find the page's table(s) or headed lists. A table is a grid of columns read left to right, e.g. "Risk Group | Clinical/Pathologic Features | Additional Evaluation | Initial Therapy". A headed list ("For patients with X:" followed by bullets) is a table with two columns (the heading, then the bullets).
3. Write `out` with the Write tool as JSON:
   {"tables": [{"title": "...",
                "columns": [{"header": "...", "kind": "condition|recommendation|reference|note"}, ...],
                "layout": "pathway|lookup",
                "rows": [{"cells": ["<column 1 text>", "<column 2 text>", ...]}, ...]}]}
   - `columns`: one entry per printed column, left to right. `header` is copied verbatim ("" if the column has no heading). `kind`:
     - "condition": the cell describes the patient (risk group, criteria, stage, finding, situation);
     - "recommendation": the cell says what to do (workup, treatment, follow-up);
     - "reference": the cell only points to another page (e.g. "PROS-3", "See NSCL-4");
     - "note": anything else (e.g. explanatory comments).
   - `rows`: one row per patient pathway, top to bottom. `cells` has exactly one string per column, copied VERBATIM from the text file (join wrapped lines with a space; separate bullets with " • "). Use "" for an empty cell.
   - A cell that spans several rows (e.g. "Intermediate" spanning "Favorable intermediate" and "Unfavorable intermediate") is repeated with the same text in each row it spans. Code merges repeated cells into one node.
   - Each row ends at its own next-page reference: never put another row's reference in a row.
   - Add `"layout"` to each table: "pathway" when a row is read left to right as one path (condition → workup → therapy → next page); "lookup" when the columns are parallel alternatives and each cell is the answer for its row AND its column (e.g. rows = response level, columns = 3/6/12 months, cells = the category; or rows = categories, columns = features with yes/no). In a lookup table the first column holds the row labels.

Rules:
- Copy text only from the text file. Never paraphrase, summarise or add words: cells whose text is not on the page are rejected automatically.
- Use the image only to see which text belongs together (columns, rows, brackets, spans, indentation).
- Skip the page title, footnotes, the page header/footer and the column headers themselves (headers go in `columns`).
- If the page has no decisions (a pure reference list or definitions), write {"tables": []}.
- Do not print page contents in your reply. Reply only with: per page, the number of tables and rows.
