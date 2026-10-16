/**
 * The words the interface uses, in one place. Clinical users see recommendations, questions and
 * steps; the encoding vocabulary (routes, fit, arms, extraction) appears only in Advanced tools.
 * Logic keeps its own names (lib/pathways.ts): these helpers only translate for display.
 */

/** A ranked pathway, as clinicians read it. */
export const T = {
  recommendation: "recommendation",
  recommendations: "recommendations",
  bestMatch: "Best match",
  questions: "Questions that change the recommendation",
  questionsFirst: "Questions that decide the first steps",
  noChangeYet: "doesn't change the result yet",
  noneFits: "no recommendation fits",
  judgment: "Your clinical judgment needed here",
  judgmentShort: "clinical judgment",
  verify: "Verify on the NCCN page",
  openPage: "Open NCCN page",
  step: "step",
  steps: "steps",
  prototype: "Research prototype, not an official NCCN tool. Conditions were drafted by software and are not clinician-reviewed: always check the NCCN page.",
} as const;

/** Likelihood band in plain words (not a probability). */
export const matchWord = (likelihood: number) =>
  likelihood >= 0.5 ? "Best match" : likelihood >= 0.2 ? "Also possible" : likelihood >= 0.05 ? "Less likely" : "Unlikely";

/** How well the answers support a recommendation: "Matches your answers" or what is missing. */
export function supportPhrase(missing: number): string {
  if (missing <= 0) return "Matches your answers";
  return `Needs ${missing} more answer${missing === 1 ? "" : "s"}`;
}

/** "N possible recommendations for this patient" */
export const countRecs = (n: number) => (n === 1 ? "1 possible recommendation for this patient" : `${n} possible recommendations for this patient`);

/** A page shown title first, its code as a quiet suffix: "Low-Risk Group (PROS-3)". */
export const pageName = (code: string, title?: string | null) => (title ? `${title} (${code})` : code);

/** Dock tabs in full words. */
export const DOCK_LABEL = { fn: "Footnotes", E: "Evidence", P: "Preference" } as const;

/** Enum values whose stored spelling keeps its capitals (pMMR_MSS, grade_I): the words a clinician writes. */
const VALUE_WORDS: Record<string, string> = {
  pMMR_MSS: "pMMR/MSS", dMMR_MSI_H: "dMMR/MSI-H", POLE_POLD1_ultra_hypermutated: "POLE/POLD1 ultra-hypermutated",
  B_or_T_lymphoblastic_leukemia_lymphoma: "B- or T-lymphoblastic leukemia/lymphoma",
  MEN2A_or_FMTC: "MEN2A or FMTC", N0_i_plus: "N0(i+)", N_positive: "Node-positive (N+)", pN_positive: "pN-positive",
  UC_NOS: "Undifferentiated carcinoma, NOS", V_upper: "Level V, upper", V_lower: "Level V, lower",
  grade_I: "Grade I", grade_II: "Grade II", grade_III: "Grade III",
  less_than_CR: "Less than CR", less_than_PR: "Less than PR", no_mIDH: "No mIDH",
  metastatic_IVB: "Metastatic (stage IVB)", node_positive_IVA: "Node-positive (stage IVA)",
  uncommon_S768I_L861Q_G719X: "Uncommon (S768I, L861Q, G719X)",
};
const LOWER_JOINERS = new Set(["or", "and", "of", "to", "with", "than", "not"]);

/**
 * An enum value as a clinician reads it, for values that carry capitals or underscores ("dMMR_MSI_H" ->
 * "dMMR/MSI-H"). Named values are spelled out above; any other underscored value keeps its capitalised parts
 * as they are and spaces the rest ("POLE_POLD1" -> "POLE/POLD1", "BRCA1_or_2" -> "BRCA1 or 2").
 * Called by factMeta.valueLabel for every value it does not already know.
 */
export function humanizeValue(v: string): string {
  const known = VALUE_WORDS[v];
  if (known) return known;
  const parts = v.split("_").filter(Boolean);
  const isName = (p: string) => /[A-Z]/.test(p) && !/[a-z]{3}/.test(p);
  const out: string[] = [];
  parts.forEach((p, i) => {
    const prev = parts[i - 1];
    if (i && isName(p) && isName(prev)) out.push(p.length === 1 ? `-${p}` : `/${p}`);            // MSI_H -> MSI-H, POLE_POLD1 -> POLE/POLD1
    else if (!i) out.push(isName(p) ? p : p[0].toUpperCase() + p.slice(1));
    else out.push(` ${LOWER_JOINERS.has(p.toLowerCase()) ? p.toLowerCase() : p}`);
  });
  return out.join("");
}
