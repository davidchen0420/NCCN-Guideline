/** The patient entered for a guideline, kept for this browser tab so the atlas and the reader
 * share it (the atlas shows its route; an example chosen in the atlas opens in the reader). */
import type { Facts } from "../types";

export const patientKey = (slug: string) => `oc-patient:${slug}`;

export interface StoredPatient {
  facts: Facts; age: number | null; start?: string; stale?: string[];
  /** the clinician's choices at branches of the algorithm: box id -> the child chosen (see lib/aiWalk) */
  overrides?: Record<string, string>;
}

/** Only well-formed choices (box id -> box id) survive reading or writing. */
export function cleanOverrides(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (x && typeof x === "object" && !Array.isArray(x))
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) if (typeof v === "string" && k && v) out[k] = v;
  return out;
}
export function readPatient(slug: string): StoredPatient | null {
  try {
    const j = JSON.parse(sessionStorage.getItem(patientKey(slug)) ?? "null");
    return j && typeof j === "object" && j.facts && typeof j.facts === "object"
      ? { facts: j.facts, age: typeof j.age === "number" ? j.age : null, start: typeof j.start === "string" ? j.start : undefined, stale: Array.isArray(j.stale) ? j.stale : undefined, overrides: cleanOverrides(j.overrides) }
      : null;
  } catch { return null; }
}

export function writePatient(slug: string, facts: Facts, age: number | null) {
  try { sessionStorage.setItem(patientKey(slug), JSON.stringify({ facts, age })); } catch { /* storage blocked */ }
}
