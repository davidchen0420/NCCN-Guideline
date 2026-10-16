import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { THRESHOLDS, casesForNode, evaluableNodes, loadGraph, metrics, report, rng, score, type Case } from "./ai-eval-lib";
import { derive, evaluate } from "../src/lib/predicates";
import { branchChildren } from "../src/lib/decide";

const g = loadGraph(JSON.parse(readFileSync("../data/prostate/guideline.json", "utf8")));

describe("ai-eval labelled set", () => {
  it("labels are the encoding's own verdicts, definite, and cover more than one label", () => {
    const rand = rng(7);
    let seenNone = false, seenArm = false, n = 0;
    for (const node of evaluableNodes(g)) {
      for (const c of casesForNode(g, "prostate", node, 3, rand)) {
        n++;
        const full = derive(c.facts, g.bundle.schema);
        const verdicts = branchChildren(g, node).conds.map((k) => evaluate(g.preds[k], full));
        expect(verdicts).not.toContain(null);
        const trueArms = branchChildren(g, node).conds.filter((_, i) => verdicts[i] === true);
        expect(trueArms.length).toBeLessThanOrEqual(1);
        expect(c.truth).toBe(trueArms[0] ?? "none");
        if (c.truth === "none") seenNone = true; else seenArm = true;
      }
    }
    expect(n).toBeGreaterThan(20);
    expect(seenArm).toBe(true);
    expect(seenNone).toBe(true);
  });

  it("is repeatable for a seed", () => {
    const node = evaluableNodes(g)[0];
    expect(casesForNode(g, "prostate", node, 3, rng(3))).toEqual(casesForNode(g, "prostate", node, 3, rng(3)));
  });
});

describe("ai-eval metrics", () => {
  const mk = (id: string, truth: string, pred: string, p: number): ReturnType<typeof score> => {
    const c: Case = { id, slug: "s", node: "n", facts: {}, truth, children: ["a", "b"] };
    return score(c, new Map([["a", pred === "a" ? p : 1 - p], ["b", pred === "b" ? p : 1 - p], ["none", 0]]));
  };
  const rows = [mk("1", "a", "a", 0.95), mk("2", "a", "a", 0.9), mk("3", "b", "a", 0.9), mk("4", "none", "a", 0.6), mk("5", "b", "b", 0.55)];
  const m = metrics(rows);

  it("accuracy, bins and calibration", () => {
    expect(m.accuracy).toBeCloseTo(3 / 5);
    expect(m.bins).toHaveLength(10);
    expect(m.bins.reduce((a, b) => a + b.n, 0)).toBe(5);
    expect(m.bins[9].n).toBe(3);                   // 0.95, 0.9, 0.9
    expect(m.bins[5]).toMatchObject({ n: 1, acc: 1 });      // 0.55, right
    expect(m.bins[6]).toMatchObject({ n: 1, acc: 0 });      // 0.6 starts the next bin, wrong
    expect(m.ece).toBeGreaterThan(0);
  });

  it("auto-follow precision and recall by threshold", () => {
    expect(m.follow.map((f) => f.threshold)).toEqual(THRESHOLDS);
    const at = (t: number) => m.follow.find((f) => f.threshold === t)!;
    expect(at(0.5)).toMatchObject({ followed: 5, correct: 3, wrong: 2 });
    expect(at(0.85)).toMatchObject({ followed: 3, correct: 2, wrong: 1 });
    expect(at(0.85).precision).toBeCloseTo(2 / 3);
    expect(at(0.85).recall).toBeCloseTo(2 / 4);    // four cases have a true arm
    expect(at(0.99)).toMatchObject({ followed: 0, precision: null });
  });

  it("failed requests are left out and the report renders", () => {
    const withFail = [...rows, score({ id: "x", slug: "s", node: "n", facts: {}, truth: "a", children: [] }, null)];
    const mm = metrics(withFail);
    expect(mm.total).toBe(6);
    expect(mm.answered).toBe(5);
    const md = report(mm, { mode: "mock", server: "", model: null, seed: 1, limit: 6, errors: 1, perNode: 1, date: "2026-01-01", guidelines: 1 });
    expect(md).toContain("Mock run");
    expect(md).toContain("| Threshold | Followed |");
  });
});
