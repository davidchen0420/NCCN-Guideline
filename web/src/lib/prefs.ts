/** Small UI preferences kept in this browser (localStorage). Storage can be blocked (private
 * windows, file://), so reads fall back and writes are best-effort. */
export function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writePref(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* blocked */ }
}
export const readFlag = (key: string) => readPref(key) === "1";
export const writeFlag = (key: string, on: boolean) => writePref(key, on ? "1" : null);

/** Advanced tools: the extraction and encoding views meant for reviewers, off for clinicians. */
export const ADVANCED_KEY = "oc-advanced";
export const ADVANCED_EVENT = "oc-advanced-changed";
/** Turn Advanced tools on or off everywhere (the reader and the atlas listen for the event). */
export function setAdvancedPref(on: boolean): void {
  writeFlag(ADVANCED_KEY, on);
  window.dispatchEvent(new CustomEvent(ADVANCED_EVENT, { detail: on }));
}
