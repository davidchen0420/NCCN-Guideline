import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { derive, evaluate } from "../src/lib/predicates";
import type { Pred, Schema } from "../src/types";

// parity.json is produced by the Python implementation (tests/make_parity_fixture.py)
const fx = JSON.parse(readFileSync(new URL("./parity.json", import.meta.url), "utf8")) as {
  preds: Record<string, Pred>; facts: Record<string, unknown>[]; schema: Schema;
  evaluate: Record<string, (boolean | null)[]>; derive: Record<string, unknown>[];
};

describe("predicates match the Python implementation", () => {
  for (const [name, pred] of Object.entries(fx.preds)) {
    it(`evaluate: ${name}`, () => {
      expect(fx.facts.map((f) => evaluate(pred, f))).toEqual(fx.evaluate[name]);
    });
  }
  it("derive", () => {
    expect(fx.facts.map((f) => derive(f, fx.schema))).toEqual(fx.derive);
  });
  it("an absent predicate is undecidable", () => {
    expect(evaluate(null, { a: 1 })).toBeNull();
  });
});
