/** The patient entered for a guideline, kept for this browser tab so the atlas and the reader
 * share it (the atlas shows its route; an example chosen in the atlas opens in the reader). */
import type { Facts } from "../types";

export const patientKey = (slug: string) => `oc-patient:${slug}`;

export interface StoredPatient { facts: Facts; age: number | null; start?: string; stale?: string[] }
export function readPatient(slug: string): StoredPatient | null {
  try {
    const j = JSON.parse(sessionStorage.getItem(patientKey(slug)) ?? "null");
    return j && typeof j === "object" && j.facts && typeof j.facts === "object"
      ? { facts: j.facts, age: typeof j.age === "number" ? j.age : null, start: typeof j.start === "string" ? j.start : undefined, stale: Array.isArray(j.stale) ? j.stale : undefined }
      : null;
  } catch { return null; }
}

export function writePatient(slug: string, facts: Facts, age: number | null) {
  try { sessionStorage.setItem(patientKey(slug), JSON.stringify({ facts, age })); } catch { /* storage blocked */ }
}
