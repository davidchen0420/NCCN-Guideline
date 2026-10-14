# Prostate audit, lung and colorectal encoding, two improvement rounds

This report covers four NCCN guidelines:
- NCCN Prostate v6.2026;
- NSCLC v6.2026 and SCLC v1.2027;
- Colon v2.2026 and Rectal v2.2026.

It holds numbers only; licensed content stays in `private/`.

**What did the LLM work:**
- **Haiku 5.5 sub-agents** did all of it: reading page images, building fact schemas, writing branch conditions, reviewing them, extracting facts from cases, and answering without context (A0).
- **Code does everything after extraction:** thresholds, unit conversion, derived classes (risk group, stage) and the graph walk.

## 1. Audit of the prostate work (before this round)

| # | Problem found | What was done |
|---|---|---|
| 1 | Everything was hard-coded to `PROS-` and to fixed page indexes | `guideline.Spec` reads page prefixes and page kinds from each PDF. The same code now runs on all 5 guidelines |
| 2 | The 0.986 MedGUIDE score was a development score. The engine started at a hand-picked tree (PROS-16), and the predicates and engine rules were written after reading the items | The engine now picks its starting box from the facts, over the whole guideline. Items are split 50/50 into dev and test (seeded); only dev is used for error analysis |
| 3 | Facts were judgments (`progression=true`) chosen per page | Each guideline has one schema of raw values: numbers in fixed units, enums, and stated yes/no events. Derived classes are rule tables run by code. A checker rejects variables like `psa_high` |
| 4 | Box ids were sequence numbers. Any extractor change silently invalidated review verdicts and predicates | Ids are now based on box position (`n<y>_<x>`). Existing verdicts were migrated |
| 5 | Footnote letters were treated as unique across pages; 10 prostate letters had conflicting text | Footnotes are stored per page and looked up from the node's own page first |
| 6 | E1/E2 box matching was text-only, so boxes with identical text were swapped. Some "verified" prostate arrows were artifacts of the image reviewer, which couldn't tell those boxes apart either | Matching now uses graph structure and reading order. The review prompt now gives each box's position on the page |
| 7 | The MedGUIDE answer rule "the only option still reachable" leaked the label: it scored the same with shuffled facts | Removed. The engine must walk through the answer box. Every benchmark row now has a shuffled-facts control and a majority-box baseline |

## 2. Encoding fidelity: arrows (edge F1 against hand-checked reference pages)

**Reference pages:**
- 8 new pages, 2 per guideline, chosen at random (seed 1). Claude checked them against the page images, not clinicians.
- Prostate uses the 4 earlier reference pages.

| Guideline (reference pages) | E1 vector, start of round 1 | E1 vector, after round 2 | Final graph (E1 + vision check + image review) |
|---|---|---|---|
| Prostate (PROS-3, 7, 9, 13) | 0.98 | 0.98 | 0.98 |
| NSCLC (NSCL-6, 35) | 0.94 | 0.98 | 0.98 |
| SCLC (SCL-3, 5) | 0.74 | 0.86 | 0.91 |
| Colon (COL-3, 11) | 0.89 | 0.92 | 0.96 |
| Rectal (REC-3, 5) | 0.60 | 0.71 | 0.85 |

**E1 fixes, all general and checked against prostate with no regression:**
- junction bars, where several arrows run into one vertical bar and leave it again;
- segments with arrowheads at both ends;
- fan-out stems no longer treated as brackets;
- tall collector bars split at vertical gaps;
- arrows that start at the end of one line inside a multi-line box.

**Vision check (E2):**
- Haiku vision ran only on pages E1 flagged: arrows with no box at one end, orphan boxes, and dead ends mid-page. A 20% random sample of clean pages was checked too.
- Coverage was 55 of 82 lung and colorectal pages, plus all 18 prostate pages from earlier.
- 246 disputed arrows got an image check.

**Arrows in the final graph:**

| Guideline | Confirmed by both | Image-verified | E1 only | E2 only |
|---|---|---|---|---|
| NSCLC | 407 | 57 | 115 | 0 |
| SCLC | 67 | 4 | 18 | 0 |
| Colon | 108 | 9 | 42 | 0 |
| Rectal | 94 | 47 | 41 | 1 |

"E1 only" arrows are mostly on unflagged pages, which got no vision check.

**Remaining E1 weaknesses:**
- separate stacked boxes that share one bracket get merged (SCL-5);
- arrows without arrowheads that run into a junction bar;
- dense rectal tables (REC-5 alone scores 0.64 after review).

## 3. Fact schemas and branch conditions (one Haiku draft and one Haiku review each)

| Guideline | Raw variables | Derived variables | Decision boxes | Usable conditions after review | Rejected by review |
|---|---|---|---|---|---|
| Prostate | 29 | 15 | 161 | 108 | 14 |
| NSCLC | 63 | 8 | 275 | 238 | 15 |
| SCLC | 22 | 7 | 48 | 44 | 1 |
| Colon | 35 | 13 | 82 | 66 | 3 |

**How the conditions were handled:**
- Rejected conditions were set to "undecidable", never hand-patched.
- The remaining gaps are treatment-choice boxes, which are choices rather than conditions, plus boxes with identical text such as "Progression".
- No clinician has reviewed these. One derived definition needs clinician sign-off: prostate high-risk biochemical recurrence, which Haiku defined beyond what the guideline states.

**Extraction stability (two independent Haiku runs; only facts both runs agree on are used):**

| Guideline | Facts per case kept | Run agreement |
|---|---|---|
| Prostate | 8.6 | 0.82 |
| NSCLC | 9.0 | 0.89 |
| SCLC | 4.3 | 0.80 |
| Colon | 7.7 | 0.78 |

- Raw numbers such as age and pack-years agree 100%.
- Judgement-like flags ("high risk stated", family history, symptomatic) agree only 64–83%.
- Every value's quote is checked against the case text by code.

## 4. MedGUIDE (held-out test split, validated items only)

**What counts as a valid item:**
- Its decision path maps onto a connected chain in our graph, and its answer is the end of that chain. This check is deterministic and replaces the earlier Haiku-only label check.
- The LLM label check was not re-run this round.

**Arms:**
- **B:** always pick the option at the answer box most common among dev items.
- **A0:** Haiku answers with no guideline context.
- **A5:** the deterministic engine; it abstains when undecided.
- **A5 shuffled:** the engine fed another case's facts.

Each cell shows accuracy over all items, with the "correct / answered" count in brackets; ± is a 95% Wald interval.

| Test split | n | B majority box | A0 | A5 engine | A5 shuffled facts | **A5 + A0 fallback** |
|---|---|---|---|---|---|---|
| Prostate (prostate_14) | 83 | 0.29 | 0.71 | 0.51 (42/48) | 0.23 | **0.88 ± 0.07** |
| Colon (col6) | 68 | 0.50 | 0.53 | 0.60 (41/61) | 0.16 | **0.69 ± 0.11** |
| NSCLC (nscl_2, nscl_3) | 122 | 0.39 | 0.90 | 0.29 (35/35) | 0.03 | **0.90 ± 0.05** |
| SCLC (sclc_7) | 17 | **1.00** | 0.71 | 0.71 (12/12) | 0.71 | 1.00 |

**How to read this:**
- **Prostate and colon:** the engine adds 17 and 16 points over Haiku alone. The shuffled-facts control collapses to 0.16–0.23, so the gain comes from the case facts and is not leakage.
- **The old prostate 0.986 was optimistic.** The held-out, whole-guideline, raw-fact version is 0.88.
- **NSCLC:** the engine is never wrong when it answers (35/35 test, 54/54 dev). But it answers only 29% of items, and Haiku alone already scores 0.90 on these nodule-workup questions, so the engine adds nothing here.
- **SCLC is uninformative.** All 35 valid items share one answer box, so a constant answer scores 100%.
- **Only part of MedGUIDE is usable.** Valid items are prostate 166/166, NSCLC 252/336, SCLC 35/57 and colon 136/182. The rest don't map onto the v6.2026 graph, which is partly version drift: MedGUIDE was built on older guidelines.

## 5. Round-2 changes (chosen on dev items only)

1. **Missing `*_stated` flags now mean "not stated"** instead of "undecidable". Before, they blocked derived rules such as NSCLC high risk.
2. **"Otherwise" branch:** when every sibling's condition is false and exactly one sibling has no condition, the engine takes that sibling.
3. **Exclusive bounds** such as ">50 mut/Mb" are now supported.
4. **The engine walks from every entry box the facts satisfy and takes the last answer box reached.** The cap of 4 entries in id order is gone. On colon dev this went from 27/42 (old rule) to 36/51; "first answer box" scored 14/51.
5. **E1 attaches arrows that start at the end of a line inside a multi-line box.**
6. **MedGUIDE mapping change, disclosed because it came after one test run:**
   - Mapping now uses page references.
   - A mismatched reference is a penalty, not a veto. A hard veto had dropped prostate valid items from 166 to 112 through version drift.
   - This changes which items are valid, not how answers are scored.

**Dev error analysis after round 2 (`python -m nccn_nav.diagnose`):**
- **Prostate:** most misses are cases that start at "CRPC, M0" and later develop metastases. A single snapshot of facts records the latest state (M1), so the M0 entry fails. Fixing this needs time-stamped facts (state at entry vs now) and is the main open issue.
- **NSCLC:** abstentions come mostly from risk facts that weren't extracted (years since quitting, explicit risk) and a few "Stable" boxes with no condition.
- **Colon:** wrong answers mostly come from several entries being true at once (metachronous metastases vs prior chemotherapy) and from cases that don't state pMMR/MSS.

## 6. Cost

- **Haiku:** about 90 sub-agent runs averaging about 110k tokens, roughly 10M tokens, which is about $1–2 at Haiku 5.5 prices.
- **Orchestration (Opus):** the larger share. It isn't measured in-session; my rough estimate for this phase is $25–40.
- **Per guideline, once automated:** about 6 vision runs, 1 schema run, 2–6 condition runs plus review, and 2 edge-review runs. That is about $0.10–0.30 of Haiku per guideline. All 91 guidelines stay well within the remaining budget if run as a script rather than driven interactively.

## 7. What is still weak

1. **Facts have no time stamps.** Each case gets a single snapshot, which breaks paths that span disease progression.
2. **No clinician review** of the reference graphs, schemas, derived definitions or conditions.
3. **MedGUIDE is a weak test:** the trees are narrow, labels come from older guideline versions, and SCLC has a single answer box. A purpose-built vignette set covering whole guidelines is needed.
4. **Rectal dense table pages** remain the weakest extraction.
5. **The extraction runs can't be pinned to temperature 0,** because sub-agents can't set it. Two-run agreement stands in for that; a scripted API pipeline should pin temperature 0 and cache results.

## 8. Round 3: time-aware facts, bent arrows, unseen guidelines

**Changes (all general; chosen on dev items):**
- **Time-aware facts.** An extracted fact can carry `earlier: {value, quote}` when the case states a different earlier state (for example M0 at CRPC diagnosis, M1 now). In the engine:
  - an entry box counts as satisfied if the current or the earlier state matches it;
  - at each branch, the current state is tried first, then the earlier one.
  - Prostate and colon were re-extracted with two runs each, and 72 of 166 prostate cases carry an earlier state.
- **E1 arrows:**
  - vertical arrows (a vertical stroke with one arrowhead) are no longer read as brackets;
  - bent loop-back arrows are traced through corner joints;
  - arrows may leave a box from its top or bottom edge.

**MedGUIDE held-out test, round 2 → round 3:**

| Test split | A0 | A5 engine (correct / answered) | A5 + A0 |
|---|---|---|---|
| Prostate (n=83) | 0.71 | 0.51 (42/48) → **0.72 (60/65)** | 0.88 → **0.90 ± 0.06** |
| Colon (n=68) | 0.53 | 0.60 (41/61) → 0.60 (41/62) | 0.69 → 0.69 |
| NSCLC (n=122) | 0.90 | 0.29 (35/35), unchanged | 0.90 |
| SCLC (n=17) | 0.71 | unchanged; the benchmark is uninformative (single answer box) | 1.00 |

Prostate's engine alone now matches Haiku with no context, and it is right 92% of the time it answers.

**Colon gained nothing, and the reasons are in the cases rather than the encoding:**
- most colon cases don't state MMR status, so the pMMR/MSS branch is undecidable;
- few cases record a "workup negative first, positive later" sequence explicitly, so the earlier-state logic rarely applies.

**Generalizability: the local pipeline run unchanged on 3 guidelines it was never tuned on:**

| Guideline | Page prefixes found automatically | Algorithm pages | Unattached arrows | Pages flagged for the vision check | Gold page edge F1 (E1 alone) |
|---|---|---|---|---|---|
| Breast | BINV, DCIS, IBC, PAGET, PHYLL, PREG | 36 | 0% | 50% | BINV-15: 1.00 |
| AML | AML, APL, BPDCN, EVAL | 23 | 0% | 35% | APL-5: 0.91 (misses one routed loop-back) |
| Antiemesis (supportive care) | AE, PEDAE | 31 | 1% | 74% | not scored |

- Antiemesis is mostly tables and dosing lists rather than flowcharts: 31% of its boxes are orphans. Guidelines like it need a table-to-decision encoder, which is the main generalization gap.
- Gold-page edge F1 after round 3 (E1 alone):

  | Guideline | Edge F1 |
  |---|---|
  | Prostate | 0.98 |
  | NSCLC | 0.97 |
  | SCLC | 0.86 |
  | Colon | 0.92 |
  | Rectal | 0.71 |
  | Breast | 1.00 |
  | AML | 0.91 |

**Process note:** some Haiku sub-agents made stray tool calls that weren't asked for: creating or archiving a remote session, or posting a task suggestion. Each was withdrawn or denied, and no files were affected. Later prompts restrict agents to Read/Write/Bash.
