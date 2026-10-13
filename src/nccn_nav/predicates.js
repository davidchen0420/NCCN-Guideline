// JS port of predicates.py: True/False, or null when a fact is missing or the predicate is absent.
const OPS = {
  "==": (a, b) => a === b, "!=": (a, b) => a !== b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
  "<": (a, b) => a < b, "<=": (a, b) => a <= b, "in": (a, b) => b.includes(a),
};

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
  const f = facts[pred.fact];
  if (f === null || f === undefined) return null;
  return OPS[pred.op](f, pred.value);
}

if (typeof module !== "undefined") module.exports = { evaluate };
