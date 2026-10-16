# Re-extracting dead-end pages (procedure)

Some pages that boxes link to have no entry box, so the engine and the viewer stop at the link. Four causes:

| Cause | Example | Fix |
|---|---|---|
| A flowchart page typed `footnotes` (code `<PREFIX>-<n>A`) or `other` (`B`, `C`, ...), no boxes | REC-3A, HODG-6B | re-extract it (spec with `boxes`) |
| A recommendation list page, no arrows | REC-10A | re-extract it as one entry box |
| An `algorithm` page with boxes but no entry box | CD-3, PHL-6, PROS-12 | name the entry box (spec with `entries`) |
| Two pages that share one printed code, so the first page's boxes were lost or filed under the other page | WILMS-5 / WILMS-11, AFAP-1, GALL-4, AYAO-8 | `relabel` (see below), then re-extract |

Pages that really are footnotes, references or principles are left alone (PROS-10A, `FOOTNOTES FOR X-n` pages).

The data is edited in place: `data/<slug>/guideline.json` has no intermediate files except for prostate. The reviewer reads the PDF page and writes a small JSON spec; code does the measuring, wiring and checking. Specs are kept in `data/<slug>/page_specs/<PAGE>.json`, so a page can be re-applied at any time.

## 0. Setup

```
git merge claude/nccn-frontend-redesign-y1l5d1      # or the current integration branch
python -m nccn_nav.audit_pages --review reports/misclassified-pages-review.json --out reports/misclassified-pages.md
```

`reports/misclassified-pages.md` has "Worklist per guideline" (pages, boxes that link to them, estimated size) and "Every dead-end link target" with `genuine`, `est. boxes` and `action`. Take the pages of one guideline: the split between agents is by guideline, each agent edits only `data/<slug>/` of its guidelines (and `data/index.json` rows, see 7).

`genuine` is a heuristic; read the page image before deciding. PDFs: `Guideline/<Category>/<Title>.pdf`, found with `nccn_nav.dashboard.find_pdfs("data")` (matched by SHA-256, so file names do not matter). `pdf page` in the report is 1-based.

## 1. Look at the page

```
python -c "import sys; sys.path.insert(0,'src'); from nccn_nav.dashboard import find_pdfs; print(find_pdfs('data')['rectal'])"
pdftoppm -r 100 -png -f 14 -l 14 "Guideline/Treatment/Rectal Cancer.pdf" /tmp/p       # then read /tmp/p-014.png
PYTHONPATH=src python -m nccn_nav.page_spec lines "Guideline/Treatment/Rectal Cancer.pdf" 14
```

`lines` prints every text line of the PDF page with its box in PDF points (origin top left; 100 dpi pixels x 0.72 = points) and superscript footnote letters as `^{a,b}`. Decide from the image whether it is a flowchart (boxes joined by arrows), a list, or a table/footnote page. Look at the neighbouring pages in the same format (and at the boxes that link to this page):

```
PYTHONPATH=src python -m nccn_nav.page_spec show data/rectal REC-6
```

Also read `g['schema']` (variables, derived with values) and `g['sections']`: conditions may only use those names.

## 2. Write the spec

`data/<slug>/page_specs/<PAGE>.json`. Full field list is in the docstring of `src/nccn_nav/page_spec.py`; the essentials:

```json
{
 "page": "REC-3A",
 "note": "why this page is a flowchart; what it continues",
 "section": null,
 "footnotes": {"a": "text printed at the bottom of the page", "...": "..."},
 "boxes": [
  {"key": "h1", "header": true, "region": [20, 84, 130, 116]},
  {"key": "start", "region": [20, 228, 110, 296], "decision_type": "condition",
   "predicate": {"fact": "distant_metastases_suspected_or_proven", "op": "!=", "value": true}},
  {"key": "opt", "region": [316, 194, 465, 240], "decision_type": "option"},
  {"key": "to6", "region": [572, 322, 720, 344]}
 ],
 "edges": [["start", "opt"], ["opt", "to6"]]
}
```

Rules used for every page so far:

* **Boxes.** `region` is `[x0, y0, x1, y1]` in PDF points; every text line whose centre lies inside is the box (text, lines, line boxes and the footnote letters are measured from the PDF). Pick regions from the `lines` output. Header cells ("CLINICAL STAGE") are `"header": true` (role `page_heading`). Title/legend boxes that have no arrows are loose: role `note` (`"role": "note"` explicit for bordered text such as an aspirin note).
* **One box per arrow origin.** A bracketed list of options that all go to the same next box is one box (the option list `A or B or C`). When options carry their own arrows, make one box per option and leave out the separating "or" lines (choose region bounds so the "or" line's centre falls outside; check the text in step 4). Include trailing link lines ("(HODG-12)" is a second line of "Follow-up"): a region that cuts it off leaves the box without its link.
* **Edges** are arrows you can see in the image: `[from_key, to_key]`. A bracket that several boxes point into is one edge per box. Two arrows into the same box are two edges. The first box (no incoming edge, an outgoing one) is the page's entry; several entries are fine (REC-14). Evidence is recorded as `image_checked`; only list arrows you checked on the image.
* **Links.** Page references in a box's text ("(REC-6)", "REC-7", "See HODG-12") become `links` automatically (code, part, page id, pdf page). A box with a link and no outgoing edge is a leaf: it continues into the entry boxes of the linked algorithm page (see 5). References to other guidelines: `"extra_links": [{"code": null, "part": null, "type": "external_guideline", "guideline": "<slug>", "page": null}]` (the box text names "NCCN Guidelines for X"). `"links": [...]` replaces the automatic ones.
* **Recommendation list page (no arrows).** One box with `"entry": true, "role": "entry", "decision_type": "other"`, plus its reference box (REC-10A). The list is an entry that takes no inherited condition.
* **decision_type.** `condition` = describes the patient (stage, finding, response, risk group, MMR status; also an entry box that is a workup list under a condition heading). `option` = one of several treatments for the same patient; no predicate. `other` = recommendations without a patient condition. Boxes that are plain steps, links and headers get none.
* **Predicates.** Follow `prompts/predicates.md` (format, ops, thresholds copied exactly) and `prompts/predicate_review.md` (be strict: reversed threshold, wrong variable, missing or extra condition = wrong). Use ONLY names in `schema.variables` / `schema.derived`; enum values only from their lists (`apply` checks both and refuses otherwise). Prefer what the neighbouring page uses for the same box text (copy `mmr_group`, `clinical_risk_group`, ... predicates from the page that links here). Use no predicate (and say why in `note`) when the box needs something the schema lacks (tumour location, HIV status, "high-risk" without a variable) or a later finding the variable cannot hold (a second Deauville score or response at week 12 when the schema has one value for it). A wrong condition is worse than none.
* **predicate_status.** Left out it is `model_reviewed` for a box with a predicate you checked against the box text (do this check for each box, thresholds and direction included) and `none` otherwise. Never set `model_reviewed` without checking. The status is the reviewer's, not a clinician's (`quality.clinician_validated` stays false).
* **Footnotes.** `footnotes` = the letters printed on that page and their text. Footnote pages often put algorithm text inside a footnote entry of the old data; replacing the dict removes it. If the footnotes are on a separate printed page (`Footnotes on PHL-4B`), give `{}`: letters then resolve to the nearest page of the same code prefix that defines them (`nearest_same_prefix`, the same fallback as the rest of the data).
* **Multi-disease guidelines** (`g['sections']`): give `"section": "<value from sections.values>"` when the page's running title names it; entry predicates then get the section clause (and `section_clause: true`), exactly as the old build did. Entry boxes without a predicate of their own take the condition of the boxes that link to them (`inherited_from_link`) unless `decision_type` is `other`.
* **Page with boxes but no entry box** (CD-3, PHL-6): `{"page": "PHL-6", "entries": ["PHL-6:n123_45"], "note": "..."}`: no `boxes`. The box must exist; look at the page image to find where patients enter.
* **Misread page label** (two pages, one code): in the spec of the lost page add `"relabel": [{"page": "<old id>", "code": "<printed code>", "nodes_from": "<page id the boxes were filed under>"}]` (see `WILMS-5.json`). `nodes_from` moves boxes that were extracted from this page but filed under the other one (their ids, `pdf_page`, edges, continuations and links follow; the bbox check is redone). Then re-extract whichever page is empty.
* Do not invent anything: text only from the PDF; unknown things stay without a condition.

## 3. Apply

```
PYTHONPATH=src python -m nccn_nav.page_spec apply data/<slug>            # every spec in data/<slug>/page_specs
PYTHONPATH=src python -m nccn_nav.page_spec apply data/<slug> data/<slug>/page_specs/REC-3A.json
```

`apply` (idempotent; re-applying replaces the page's boxes):

1. measures each box (text, `lines`, `bbox`, `line_bboxes`, footnote letters, `bbox_matches_pdf`) and gives it the id `<CODE>:n<round y>_<round x>`;
2. checks predicates against the schema and edges against the boxes; assigns roles as the bundle does (no parent = `entry`, several children = `decision`, a child = `step`, none = `leaf`, loose = `note`/`link`);
3. sets the page `kind` to `algorithm`, `kind_before` to the old kind, `heading`, `footnotes`, `reextracted` (the spec's `note`);
4. wires continuations (below), recomputes `reached_from` / `link_condition` for the entries involved, rewrites `quality` and the guideline's row in `data/index.json`;
5. writes `guideline.json` in the compact format of the build.

Read the output: `boxes_text_found_in_pdf_at_bbox` must not drop (each box's text is found at its position), and look at the pages with

```
PYTHONPATH=src python -m nccn_nav.page_spec show data/<slug> <PAGE>
```

## 4. Check by hand

For each new page, in the PDF image: every box present once, no "or" separator left inside a box, no cut-off link line, every arrow an edge, and each predicate against its box text (this is where `model_reviewed` is earned). Read the incoming side: the boxes that linked to the page ("linked from") now continue into its entry.

## 5. Wiring (what `apply` does for you)

* `entries` (guideline.json) lists every box that has no incoming arrow and an outgoing one (plus `entry: true` boxes).
* `continuations` `{src, dst, page}`: a box with **no outgoing arrow** that names an algorithm page continues into **all entry boxes of that page** (a page with several entries gives several continuations; the entry predicates choose). `apply` adds them for the boxes of the new page (outgoing) and for every such box elsewhere in the guideline that names the new page (incoming, e.g. `REC-3:n348_373` "REC-3A"). Notes, headings and column headers never get one. Boxes that have other children and also name a page (e.g. "...consider surveillance (REC-10A)") are left alone: they already continue elsewhere.
* Leaf boxes elsewhere that name an algorithm page but have no continuation (the audit counts them per guideline; REC-2 "REC-3" is one) are added by `python -m nccn_nav.page_spec wire data/<slug> --all` (not applied so far; it also recomputes `reached_from` for all entries: run the web tests afterwards).

## 6. Validate

```
python -m pytest -q tests                                       # includes tests/test_page_spec.py: every published guideline is consistent
cd web && ln -s /home/user/NCCN-Guideline/web/node_modules node_modules 2>/dev/null; npx vitest run
PYTHONPATH=src python -m nccn_nav.audit_pages --review reports/misclassified-pages-review.json --out reports/misclassified-pages.md
```

`test_published_graph_is_consistent[<slug>]` checks (all guidelines): arrows and continuations name existing boxes on one page, every box sits on an algorithm page, re-extracted pages have boxes and an entry, every condition uses schema variables. A guideline-level reach check (engine): load the guideline in a throwaway vitest file (`adaptGuideline` + `buildGraph` + `rankPathways(g, facts, "<START PAGE>")`, see `web/test/scenarios.test.ts`), write the visited node ids to a file, check that a patient from the linking page reaches the new page, then delete the file.

Add the reviewer's decision for pages you leave alone to `reports/misclassified-pages-review.json` (`"<slug>:<page>": "text"`), so the report shows why.

## 7. Build and commit

```
PYTHONPATH=src python -m nccn_nav.dashboard --library data built/oncocarta.html
git checkout built/oncocarta.html                      # do not commit it or src/nccn_nav/dashboard.html
git add data/<slug> built/guidelines/<slug>.js reports/ src/ tests/ docs/
git commit                                              # no model names in code or message
```

Commit the guideline.json, `page_specs/`, the regenerated `built/guidelines/<slug>.js` of the guidelines you changed (the build rewrites only those), and `data/index.json`. Parallel agents each touch their own `data/<slug>/` and `built/guidelines/<slug>.js`; `data/index.json` has one row per guideline, merge conflicts there are per-row (take both) and `reports/misclassified-pages.md` is regenerated after the merge.

## Pitfalls seen

* Regions that cut a box's last line drop its link (`Disease (CD-6)`), regions that reach into the next box's "or" put "or" into the text. Always compare the printed text with `show`.
* A footnote letter that looks like text (`uSpecial Considerations`) stays in the text; set the footnote `u` from the note box.
* Week-6 and week-12 responses, first and second restaging, share one variable: give a predicate to the first and none to the later boxes.
* "Footnotes on X" boxes are pointers on purpose, not dead ends; the audit ignores them.
* Link text such as "(REC-F 5 of 17)" resolves to the part by number; a page code that exists once resolves to that page.
