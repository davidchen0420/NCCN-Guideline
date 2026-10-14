// JS port of predicates.py (and facts.derive): true/false, or null when a fact is missing or
// unknown, an interval makes the comparison undecidable, or the predicate is absent.
const OPS = {
  "==": (a, b) => a === b, "!=": (a, b) => a !== b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
  "<": (a, b) => a < b, "<=": (a, b) => a <= b,
};

function compareInterval(lo, hi, op, v) {
  lo = lo === null || lo === undefined ? -Infinity : lo;
  hi = hi === null || hi === undefined ? Infinity : hi;
  if (op === ">" || op === ">=") return OPS[op](lo, v) ? true : (!OPS[op](hi, v) ? false : null);
  if (op === "<" || op === "<=") return OPS[op](hi, v) ? true : (!OPS[op](lo, v) ? false : null);
  if (op === "==") return lo === hi && lo === v ? true : (v < lo || v > hi ? false : null);
  if (op === "!=") { const r = compareInterval(lo, hi, "==", v); return r === null ? null : !r; }
  return null;
}

function compare(x, op, v) {
  if (x === null || x === undefined || x === "unknown") return null;
  if (op === "in") return v.includes(x);
  if (op === "not_in") return !v.includes(x);
  if (typeof x === "object") {
    if (typeof v !== "number") return null;
    return compareInterval(x.min, x.max, op, v);
  }
  if (typeof x !== typeof v) return null;
  return OPS[op](x, v);
}

function evaluate(pred, facts) {
  if (pred === null || pred === undefined) return null;
  if ("all" in pred || "any" in pred) {
    const vals = ("all" in pred ? pred.all : pred.any).map((p) => evaluate(p, facts));
    if ("all" in pred) return vals.includes(false) ? false : (vals.includes(null) ? null : true);
    return vals.includes(true) ? true : (vals.includes(null) ? null : false);
  }
  if ("not" in pred) {
    const v = evaluate(pred.not, facts);
    return v === null ? null : !v;
  }
  return compare(facts[pred.fact], pred.op, pred.value);
}

// Add derived variables (risk group, ...) from the schema's rule tables; explicit facts win.
function derive(facts, schema) {
  const out = { ...facts };
  for (let i = 0; i < 3; i++) {
    for (const [name, spec] of Object.entries((schema && schema.derived) || {})) {
      if (name in facts) continue;
      let value = null, decided = false;
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

if (typeof module !== "undefined") module.exports = { evaluate, derive };
