import type { Facts, Pred, Schema } from "../types";

type Tri = boolean | null;
const OPS: Record<string, (a: any, b: any) => boolean> = {
  "==": (a, b) => a === b, "!=": (a, b) => a !== b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
  "<": (a, b) => a < b, "<=": (a, b) => a <= b,
};

function compareInterval(lo: number | null | undefined, hi: number | null | undefined, op: string, v: number): Tri {
  const l = lo ?? -Infinity, h = hi ?? Infinity;
  if (op === ">" || op === ">=") return OPS[op](l, v) ? true : !OPS[op](h, v) ? false : null;
  if (op === "<" || op === "<=") return OPS[op](h, v) ? true : !OPS[op](l, v) ? false : null;
  if (op === "==") return l === h && l === v ? true : v < l || v > h ? false : null;
  if (op === "!=") { const r = compareInterval(lo, hi, "==", v); return r === null ? null : !r; }
  return null;
}

export function compare(x: unknown, op: string, v: unknown): Tri {
  if (x === null || x === undefined || x === "unknown") return null;
  if (op === "in") return (v as unknown[]).includes(x);
  if (op === "not_in") return !(v as unknown[]).includes(x);
  if (typeof x === "object") {
    if (typeof v !== "number") return null;
    const iv = x as { min?: number; max?: number };
    return compareInterval(iv.min, iv.max, op, v);
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
