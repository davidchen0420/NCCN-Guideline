# Task: turn NCCN table and list pages into decision rows

Input: `{BATCH}`, one JSON object per line: {"page", "image", "text", "out"}.
- `image` is a PNG of the page.
- `text` is the page's own text, one printed line per row as `y=<top> x=<left> | <text>` (PDF points; y grows downward). Superscript footnote letters are already removed.

For EACH line of the batch:
1. View the image with the Read tool, then read the text file.
2. Find every decision the page states: a patient situation (condition) and what to do for it (recommendation). These appear as table rows (condition column → recommendation column), as headed lists ("For patients with X:" followed by bullets), or as labelled sections.
3. Write `out` with the Write tool as JSON:
   {"rows": [{"header": "...", "condition": "...", "recommendation": "..."}]}
   - `condition`: the patient situation, copied VERBATIM from the text file (join wrapped lines with a space). Use "" when the page is a plain list with no condition.
   - `recommendation`: the recommended action(s) for that condition, copied VERBATIM from the text file (join wrapped lines; separate bullets with " • ").
   - `header`: the table column heading or section title the row sits under, copied verbatim, or "".
   - One row per condition. Keep the page's top-to-bottom order.

Rules:
- Copy text only from the text file. Never paraphrase, summarise or add words: rows whose text is not on the page are rejected automatically.
- Use the image only to see which text belongs together (columns, rows, brackets, indentation).
- Skip the page title, footnotes, "See ..." navigation-only lines, and the page header/footer.
- If the page has no decisions (a pure reference list or definitions), write {"rows": []}.
- Do not print page contents in your reply. Reply only with: per page, the number of rows.
