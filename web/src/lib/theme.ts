/**
 * Appearance: follow the system, or always light, or always dark. The choice sits on
 * <html data-theme="light|dark"> (absent = follow the system); the CSS reads it, and the NCCN page
 * windows copy it. Kept per browser in localStorage.
 */
export type ThemePref = "system" | "light" | "dark";
export const THEME_EVENT = "oc-theme";
const KEY = "oc-theme";

export function themePref(): ThemePref {
  try { const v = localStorage.getItem(KEY); if (v === "light" || v === "dark") return v; } catch { /* storage blocked */ }
  return "system";
}

/** Is the page dark right now (the choice, or the system when following it)? */
export const isDark = (): boolean => {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
};

export function applyTheme(p: ThemePref = themePref()) {
  const el = document.documentElement;
  if (p === "system") delete el.dataset.theme; else el.dataset.theme = p;
}

export function setThemePref(p: ThemePref) {
  try { if (p === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* storage blocked */ }
  applyTheme(p);
  window.dispatchEvent(new Event(THEME_EVENT));
}
