import type { Facts, Pred, Schema } from "../types";

type Tri = boolean | null;
const OPS: Record<string, (a: any, b: any) => boolean> = {
  "==": (a, b) => a === b, "!=": (a, b) => a !== b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
  "<": (a, b) => a < b, "<=": (a, b) => a <= b,
};

/** Three-valued comparison of an unknown x in lo..hi (null = unbounded; *Open = bound excluded,
 * e.g. "PSA >10"). Mirrors predicates._compare_interval in Python. */
function compareInterval(lo: number | null | undefined, hi: number | null | undefined, op: string, v: number, loOpen = false, hiOpen = false): Tri {
  const l = lo ?? -Infinity, h = hi ?? Infinity;
  const surelyAbove = (t: number, strict: boolean) => l > t || (l === t && (loOpen || !strict));
  const surelyBelow = (t: number, strict: boolean) => h < t || (h === t && (hiOpen || !strict));
  if (op === ">" || op === ">=") {
    const strict = op === ">";
    return surelyAbove(v, strict) ? true : surelyBelow(v, !strict) ? false : null;
  }
  if (op === "<" || op === "<=") {
    const strict = op === "<";
    return surelyBelow(v, strict) ? true : surelyAbove(v, !strict) ? false : null;
  }
  if (op === "==" || op === "!=") {
    const point = l === h && h === v && !loOpen && !hiOpen;
    const outside = surelyAbove(v, true) || surelyBelow(v, true);
    const r: Tri = point ? true : outside ? false : null;
    return op === "==" || r === null ? r : !r;
  }
  return null;
}

export function compare(x: unknown, op: string, v: unknown): Tri {
  if (x === null || x === undefined || x === "unknown") return null;
  if (op === "in") return (v as unknown[]).includes(x);
  if (op === "not_in") return !(v as unknown[]).includes(x);
  if (typeof x === "object") {
    if (typeof v !== "number") return null;
    const iv = x as { min?: number | null; max?: number | null; min_open?: boolean; max_open?: boolean };
    return compareInterval(iv.min, iv.max, op, v, !!iv.min_open, !!iv.max_open);
  }
  // like Python: == and != across types are plain False/True, ordering across types is undecidable
  if (typeof x !== typeof v) return op === "==" ? false : op === "!=" ? true : null;
  return OPS[op](x, v);
}

/** Mirrors predicates.evaluate in Python: true/false, or null when undecidable. */
export function evaluate(pred: Pred | null | undefined, facts: Facts): Tri {
  if (!pred) return null;
  if ("all" in pred || "any" in pred) {
    const isAll = "all" in pred;
    const vals = (isAll ? pred.all : (pred as { any: Pred[] }).any).map((p) => evaluate(p, facts));
    if (isAll) return vals.includes(false) ? false : vals.includes(null) ? null : true;
    return vals.includes(true) ? true : vals.includes(null) ? null : false;
  }
  if ("not" in pred) { const v = evaluate(pred.not, facts); return v === null ? null : !v; }
  return compare(facts[pred.fact], pred.op, pred.value);
}

/** Mirrors facts.derive: add derived variables from rule tables; explicit facts win. */
export function derive(facts: Facts, schema: Schema | undefined): Facts {
  const out: Facts = { ...facts };
  // "<x>_stated" flags record an explicit statement in the case: not mentioned means not stated.
  for (const name of Object.keys(schema?.variables ?? {})) if (name.endsWith("_stated") && !(name in out)) out[name] = false;
  for (let i = 0; i < 3; i++) {
    for (const [name, spec] of Object.entries(schema?.derived ?? {})) {
      if (name in facts) continue;
      let value: unknown = null, decided = false;
      for (const rule of spec.rules) {
        const verdict = evaluate(rule.if, out);
        if (verdict === null) { decided = true; break; }
        if (verdict) { value = rule.then; decided = true; break; }
      }
      if (!decided) value = "else" in spec ? spec.else : null;
      if (value !== null && value !== undefined) out[name] = value;
    }
  }
  return out;
}
