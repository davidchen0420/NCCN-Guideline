import type { Pred, Schema } from "../types";

const OP_WORD: Record<string, string> = { "==": "is", "!=": "is not", ">": ">", ">=": "≥", "<": "<", "<=": "≤", in: "is one of", not_in: "is none of" };
export const factLabel = (name: string) => name.replace(/_/g, " ");

const fmtValue = (v: unknown): string =>
  Array.isArray(v) ? v.map(fmtValue).join(", ") : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);

/** A branch condition as a readable sentence fragment, e.g. "PSA ≥ 10 ng/ml and Grade group is one of 4, 5". */
export function humanizePred(p: Pred, schema?: Schema, top = true): string {
  if ("all" in p) return join(p.all.map((x) => humanizePred(x, schema, false)), "and", top);
  if ("any" in p) return join(p.any.map((x) => humanizePred(x, schema, false)), "or", top);
  if ("not" in p) return `not (${humanizePred(p.not, schema, true)})`;
  const spec = schema?.variables?.[p.fact];
  const unit = spec?.unit && spec.unit !== "count" && typeof p.value === "number" ? ` ${spec.unit}` : "";
  const op = OP_WORD[p.op] ?? p.op;
  return `${factLabel(p.fact)} ${op} ${fmtValue(p.value)}${unit}`;
}
const join = (parts: string[], word: string, top: boolean) => {
  const s = parts.join(` ${word} `);
  return top || parts.length < 2 ? s : `(${s})`;
};
