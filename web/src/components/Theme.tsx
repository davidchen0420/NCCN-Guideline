import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { isDark, setThemePref, themePref, THEME_EVENT, type ThemePref } from "../lib/theme";

/** The appearance choice and whether the page is dark now; updates with the choice and the system. */
export function useTheme(): { pref: ThemePref; dark: boolean } {
  const read = () => ({ pref: themePref(), dark: isDark() });
  const [t, setT] = useState(read);
  useEffect(() => {
    const on = () => setT(read());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener(THEME_EVENT, on); mq.addEventListener("change", on);
    return () => { window.removeEventListener(THEME_EVENT, on); mq.removeEventListener("change", on); };
  }, []);
  return t;
}

const CHOICES: [ThemePref, string][] = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];

/** Settings row: System / Light / Dark. */
export function ThemeChoice() {
  const { pref } = useTheme();
  return (
    <div className="set-theme" role="radiogroup" aria-label="Appearance">
      <span className="set-t"><b>Appearance</b><small>Light or dark, or follow this device.</small></span>
      <div className="seg">
        {CHOICES.map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={pref === v} className={pref === v ? "on" : ""}
            onClick={() => setThemePref(v)} data-testid={`theme-${v}`}>{label}</button>
        ))}
      </div>
    </div>
  );
}

/** One-click switch between light and dark (from whatever is showing now). */
export function ThemeToggle({ className = "", label = false }: { className?: string; label?: boolean }) {
  const { dark } = useTheme();
  const to = dark ? "light" : "dark";
  const name = dark ? "Light mode" : "Dark mode";
  return (
    <button type="button" className={className} onClick={() => setThemePref(to)} aria-label={`Switch to ${name.toLowerCase()}`} title={`Switch to ${name.toLowerCase()}`} data-testid="theme-toggle">
      {dark ? <Sun size={label ? 20 : 15} aria-hidden /> : <Moon size={label ? 20 : 15} aria-hidden />}
      {label ? <span className="rl" aria-hidden>{dark ? "Light" : "Dark"}</span> : <span>{dark ? "Light" : "Dark"}</span>}
    </button>
  );
}
