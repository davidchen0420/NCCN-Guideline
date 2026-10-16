import type { Schema } from "../types";
import { factValue as rawFactValue, valueLabel } from "./factMeta";

/* ---------------- how a stored value reads ---------------- */

/** An enum value the shared labeller leaves as printed (it only handles all-lower-case values):
 * "pMMR_MSS" -> "pMMR/MSS", "dMMR_MSI_H" -> "dMMR/MSI-H", "B_or_T_lymphoblastic_leukemia_lymphoma" ->
 * "B or T lymphoblastic leukemia lymphoma". Only a fallback: a label the data or the terms give wins. */
export function humanizeValue(v: string): string {
  const toks = v.split("_").filter(Boolean);
  const merged: string[] = [];
  for (const t of toks) {
    // a lone capital after an abbreviation belongs to it: MSI_H -> MSI-H
    if (merged.length && /^[A-Z]$/.test(t) && /[A-Z]$/.test(merged[merged.length - 1])) merged[merged.length - 1] += `-${t}`;
    else merged.push(t);
  }
  const abbr = (t: string) => /[A-Z]/.test(t.slice(1)) || (t.length > 1 && t === t.toUpperCase());
  const parts: string[] = [];
  merged.forEach((t, i) => { if (i > 0 && abbr(t) && abbr(merged[i - 1])) parts[parts.length - 1] += `/${t}`; else parts.push(t); });
  const out = parts.join(" ");
  return /^[a-z]{1,2}[A-Z0-9]/.test(out) ? out : out.charAt(0).toUpperCase() + out.slice(1);
}
/** The label of a value: the shared one when it has one, else the fallback above. */
export function vlabel(v: unknown): string {
  const l = valueLabel(v);
  return typeof v === "string" && l === v && v.includes("_") ? humanizeValue(v) : l;
}
export const factText = (name: string, v: unknown, schema: Schema) => (schema.variables[name]?.type === "number" ? rawFactValue(name, v, schema) : vlabel(v));

/** The label of a section value: the prefix every value shares ("Survivorship: Fatigue") and stray spaces around colons go. */
export function sectionLabeller(values: string[]): (v: unknown) => string {
  const tidy = (x: string) => x.replace(/\s*:\s*/g, ": ").replace(/\s+/g, " ").trim();
  const pre = values.map((v) => /^([^:]{1,40}?)\s*:/.exec(v)?.[1]?.trim());
  const common = pre.length > 1 && pre.every((x) => x && x === pre[0]) ? pre[0]! : null;
  return (v) => {
    const t = tidy(String(v));
    return common && t.toLowerCase().startsWith(`${common.toLowerCase()}: `) ? t.slice(common.length + 2) : t;
  };
}
