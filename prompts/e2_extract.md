# Task: transcribe NCCN flowchart pages into graphs

Input: `{BATCH}`, one JSON object per line: {"page", "image", "out"}. For EACH line: view the PNG at `image` with the Read tool, then write a JSON file to `out` with the Write tool.

JSON format: {"nodes": [{"id": "n1", "text": "..."}], "edges": [{"src": "n1", "dst": "n2"}]}

Rules:
- A node is one box/text block in the flowchart (a condition, finding, workup, treatment option, or a "See ... (XXX-n)" reference). Text inside one bracket "[" belongs to one node, including lines joined by "or"/"and" within that bracket. Do NOT include column headings (ALL-CAPS titles at the top such as "CLINICAL PRESENTATION"), page header/footer, the "Footnotes on ..." link, or footnote text at the bottom.
- Node text: copy exactly as printed, dropping superscript footnote letters; you may stop after the first 100 characters.
- An edge goes from the box an arrow starts at to the box the arrowhead points at. If several arrows enter one vertical bar and a single arrow leaves the bar, connect every box entering the bar to the box the leaving arrow points at. If an arrow leaves a bracket enclosing several boxes, connect each enclosed box.
- Be complete: every arrow on the page must become an edge. Do not invent edges. A page with no arrows gets "edges": [].
- Do not add commentary to the files. Do not print page contents in your reply.

Reply only with a one-line summary per page: page, node count, edge count.
