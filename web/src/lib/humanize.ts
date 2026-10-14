import type { Facts, Pred, Schema } from "../types";
import { evaluate } from "./predicates";
import { factValue, formatNumber, label, valueLabel } from "./factMeta";

const OP: Record<string, string> = { "==": "is", "!=": "is not", ">": ">", ">=": "≥", "<": "<", "<=": "≤", in: "is", not_in: "is not" };
export const factLabel = label;

function leafText(p: { fact: string; op: string; value: unknown }, schema?: Schema): string {
  const spec = schema?.variables?.[p.fact];
  const name = label(p.fact);
  if (typeof p.value === "boolean" && (p.op === "==" || p.op === "!=")) {
    const yes = (p.op === "==") === p.value;
    return yes ? name : `Not: ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  }
  if (spec?.type === "number" && typeof p.value === "number") return `${name} ${OP[p.op] ?? p.op} ${formatNumber(p.value, spec.unit)}`;
  const vals = Array.isArray(p.value) ? p.value : [p.value];
  const list = vals.map(valueLabel);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}` : list[0];
  return `${name} ${OP[p.op] ?? p.op} ${joined}`;
}

/** A branch condition as a readable sentence, e.g. "PSA ≥ 10 ng/mL and Grade Group is 4 or 5". */
export function humanizePred(p: Pred, schema?: Schema, top = true): string {
  if ("all" in p) return join(p.all.map((x) => humanizePred(x, schema, false)), "and", top);
  if ("any" in p) return join(p.any.map((x) => humanizePred(x, schema, false)), "or", top);
  if ("not" in p) return `not (${humanizePred(p.not, schema, true)})`;
  return leafText(p, schema);
}
const join = (parts: string[], word: string, top: boolean) => {
  const s = parts.join(` ${word} `);
  return top || parts.length < 2 ? s : `(${s})`;
};

/** A condition as a tree whose leaves carry the patient's value and the verdict, for display. */
export type CondNode =
  | { t: "leaf"; text: string; fact: string; verdict: boolean | null; value: string | null }
  | { t: "group"; word: "all" | "any" | "not"; verdict: boolean | null; items: CondNode[] };

export function conditionTree(p: Pred, facts: Facts, schema: Schema): CondNode {
  const verdict = evaluate(p, facts);
  if ("all" in p) return { t: "group", word: "all", verdict, items: p.all.map((x) => conditionTree(x, facts, schema)) };
  if ("any" in p) return { t: "group", word: "any", verdict, items: p.any.map((x) => conditionTree(x, facts, schema)) };
  if ("not" in p) return { t: "group", word: "not", verdict, items: [conditionTree(p.not, facts, schema)] };
  const v = facts[p.fact];
  return { t: "leaf", text: leafText(p, schema), fact: p.fact, verdict, value: v === undefined || v === null ? null : factValue(p.fact, v, schema) };
}
