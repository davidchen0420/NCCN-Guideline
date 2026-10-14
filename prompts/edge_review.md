# Task: verify disputed arrows on NCCN flowchart pages

Input: the JSON file {BATCH}. It is a list of pages. Each page has `image` (a PNG of the page), `out` (the file to write), and `edges`.

Two automatic extractors disagreed about each edge. An edge claims that an arrow leads from the box `from` to the box `to`.
- Box text is truncated.
- `*_pos` gives where the box sits on the page. `y` is measured in PDF points from the top: the page is 612 points tall, and the image is about 1.53 pixels per point.
- Use the position to tell apart boxes with identical text.

For each page:
1. Open the image with the Read tool.
2. For every edge, decide:
   - **yes**: an arrow, possibly via a vertical bar, junction or bracket, leads from that exact `from` box to that exact `to` box. If several arrows enter one vertical bar and one arrow leaves it, every entering box leads to the box the leaving arrow points at.
   - **no**: there is no such arrow, or it connects a different box with the same text.
   - **unsure**: you cannot tell.
3. Write `out` as JSON: `{"<edge_id>": {"verdict": "yes|no|unsure", "note": "<at most 12 words>"}, ...}`. Include every edge_id from that page.

Do not quote guideline text in your reply. Reply only with: per page, the counts of yes/no/unsure.
