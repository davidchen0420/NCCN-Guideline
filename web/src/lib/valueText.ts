import type { Schema } from "../types";
import { factValue as rawFactValue, valueLabel } from "./factMeta";

/* ---------------- how a stored value reads ---------------- */

/** The label of an enum value. The one humaniser lives in terms.humanizeValue and is applied by
 * factMeta.valueLabel to every value with capitals or underscores ("pMMR_MSS" -> "pMMR/MSS"). */
export const vlabel = (v: unknown): string => valueLabel(v);
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
