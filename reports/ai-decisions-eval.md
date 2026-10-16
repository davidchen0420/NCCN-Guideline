# AI decisions: calibration report

- Date: 2026-10-16
- Source: server http://127.0.0.1:8765, model `gpt-6-luna`
- Labelled cases: 300 requested over 35 guidelines (seed 1, up to 1 per decision node); answered 300, failed 0
- Labels come from the encoded predicates of the guideline graph; only nodes whose arms all have an encoded condition are used. "none" is the label when no arm's condition holds (70 cases).

## Summary

| Measure | Value |
|---|---|
| Top-1 accuracy | 96.0% (288/300) |
| Accuracy where an arm is true | 97.8% |
| Accuracy where none is true | 90.0% |
| Expected calibration error (10 bins) | 0.025 |
| Brier score (sum over choices, mean over cases) | 0.067 |

## Reliability (top probability vs how often it was right)

| Top probability | Cases | Mean confidence | Accuracy | Gap |
|---|---:|---:|---:|---:|
| 0.0–0.1 | 0 | – | – | – |
| 0.1–0.2 | 0 | – | – | – |
| 0.2–0.3 | 0 | – | – | – |
| 0.3–0.4 | 1 | 39.0% | 0.0% | -39.0 pts |
| 0.4–0.5 | 1 | 49.0% | 100.0% | 51.0 pts |
| 0.5–0.6 | 9 | 54.0% | 77.8% | 23.8 pts |
| 0.6–0.7 | 8 | 63.6% | 75.0% | 11.4 pts |
| 0.7–0.8 | 13 | 73.8% | 84.6% | 10.8 pts |
| 0.8–0.9 | 22 | 84.7% | 81.8% | -2.9 pts |
| 0.9–1.0 | 246 | 98.9% | 99.6% | 0.7 pts |

## Auto-follow by threshold

Auto-follow takes the top arm when its probability is at least the threshold and it is not "none". Precision: followed arms that were right. Recall: cases with a true arm that were followed correctly. Coverage: share of all cases followed.

| Threshold | Followed | Right | Wrong | Precision | Recall | Coverage |
|---:|---:|---:|---:|---:|---:|---:|
| 0.5 | 233 | 225 | 8 | 96.6% | 97.8% | 77.7% |
| 0.6 | 227 | 221 | 6 | 97.4% | 96.1% | 75.7% |
| 0.7 | 222 | 217 | 5 | 97.7% | 94.3% | 74.0% |
| 0.8 | 213 | 210 | 3 | 98.6% | 91.3% | 71.0% |
| 0.85 | 209 | 208 | 1 | 99.5% | 90.4% | 69.7% |
| 0.9 | 200 | 200 | 0 | 100.0% | 87.0% | 66.7% |
| 0.95 | 193 | 193 | 0 | 100.0% | 83.9% | 64.3% |
| 0.99 | 157 | 157 | 0 | 100.0% | 68.3% | 52.3% |

## Weakest guidelines

| Guideline | Cases | Accuracy |
|---|---:|---:|
| pediatric_aggressive_mature_b_cell_lymphomas | 10 | 80.0% |
| hepatocellular_carcinoma | 8 | 87.5% |
| occult_primary | 9 | 88.9% |
| neuroendocrine_and_adrenal_tumors | 10 | 90.0% |
| colorectal_screening | 10 | 90.0% |
| prostate | 10 | 90.0% |
| breast | 10 | 90.0% |
| testicular | 10 | 90.0% |
| histiocytic_neoplasms | 10 | 90.0% |
| myeloproliferative_neoplasms | 10 | 90.0% |
| merkel_cell_carcinoma | 10 | 90.0% |
| t_cell_lymphomas | 10 | 100.0% |
| central_nervous_system | 10 | 100.0% |
| management_of_immune_checkpoint_inhibitor_relate | 10 | 100.0% |
| gestational_trophoblastic_neoplasia | 10 | 100.0% |

## Method

Facts are sampled from each condition's variables (enum values, flags, numbers around the thresholds the guideline compares them with). A sample counts when every arm's predicate evaluates to true or false after the derived values are added and at most one arm is true. The request is built exactly as the app builds it (structured answers plus the page text), sent through the proxy, and the model's distribution over the arms and "none" is compared with the label. Samples are synthetic and the labels are the guideline encoding's own, so this measures agreement with the encoding, not clinical correctness.

