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

// ---------------------------------------------------------------- AI decision support

/** The confidence at which the AI's choice is followed without asking (default and range). */
export const AI_THRESHOLD_DEFAULT = 0.85;
export const AI_THRESHOLD_MIN = 0.5;
export const AI_THRESHOLD_MAX = 0.99;
export const AI_ON_KEY = "oc-ai-on";
export const AI_THRESHOLD_KEY = "oc-ai-threshold";

/** A threshold kept inside 50%..99% and to whole percents (anything unreadable becomes the default). */
export function clampThreshold(x: unknown): number {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  if (!Number.isFinite(n)) return AI_THRESHOLD_DEFAULT;
  return Math.round(Math.min(AI_THRESHOLD_MAX, Math.max(AI_THRESHOLD_MIN, n)) * 100) / 100;
}
/** AI decision support is on unless the reader turned it off (it only applies where the local server offers it). */
export const readAiEnabled = (): boolean => readPref(AI_ON_KEY) !== "0";
export const writeAiEnabled = (on: boolean): void => writePref(AI_ON_KEY, on ? null : "0");
export const readAiThreshold = (): number => clampThreshold(readPref(AI_THRESHOLD_KEY));
export const writeAiThreshold = (t: number): void => {
  const c = clampThreshold(t);
  writePref(AI_THRESHOLD_KEY, c === AI_THRESHOLD_DEFAULT ? null : String(c));
};

/** Advanced tools: the extraction and encoding views meant for reviewers, off for clinicians. */
export const ADVANCED_KEY = "oc-advanced";
export const ADVANCED_EVENT = "oc-advanced-changed";
/** Turn Advanced tools on or off everywhere (the reader and the atlas listen for the event). */
export function setAdvancedPref(on: boolean): void {
  writeFlag(ADVANCED_KEY, on);
  window.dispatchEvent(new CustomEvent(ADVANCED_EVENT, { detail: on }));
}
