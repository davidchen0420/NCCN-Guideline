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
