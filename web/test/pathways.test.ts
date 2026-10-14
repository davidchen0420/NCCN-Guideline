import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import type { Bundle } from "../src/types";
import { buildGraph } from "../src/lib/graph";
import { missingFacts, rankPathways } from "../src/lib/pathways";

const bundle = JSON.parse(readFileSync(new URL("../public/sample-bundle.json", import.meta.url), "utf8")) as Bundle;
const g = buildGraph(bundle);
const nodes = (p: { steps: { node: string }[] }) => p.steps.map((s) => s.node);

describe("ranked pathways", () => {
  it("follows a fully decided route with every criterion met", () => {
    const r = rankPathways(g, { score: 12, age: 70 });
    expect(r.paths).toHaveLength(1);
    const [p] = r.paths;
    expect(nodes(p)).toEqual(["SAMPLE-1:n1", "SAMPLE-1:n2", "SAMPLE-1:n3", "SAMPLE-2:n1", "SAMPLE-2:n2", "SAMPLE-2:n4"]);
    expect(p.likelihood).toBe(1);
    expect([p.met, p.open]).toEqual([2, 0]);
    expect(p.confidence).toBeGreaterThan(80); // draft conditions lower the encoding score a little
    expect(p.confidence).toBeLessThan(100);
    expect(r.nextBest).toBeNull();
  });

  it("splits likelihood across arms the facts cannot decide yet, and names the missing fact", () => {
    const r = rankPathways(g, { score: 12 });
    expect(r.paths).toHaveLength(2);
    expect(r.paths.map((p) => p.likelihood)).toEqual([0.5, 0.5]);
    r.paths.forEach((p) => { expect(p.missing).toEqual(["age"]); expect(p.open).toBe(1); });
    expect(r.nextBest).toEqual({ fact: "age", share: 1 });
  });

  it("prunes arms the facts contradict", () => {
    const r = rankPathways(g, { score: 3 });
    expect(r.paths.map(nodes)).toEqual([["SAMPLE-1:n1", "SAMPLE-1:n2", "SAMPLE-1:n4", "SAMPLE-1:n5"]]);
    expect(r.ruledOut).toBeGreaterThanOrEqual(1);
  });

  it("respects open interval bounds (score > 10)", () => {
    const r = rankPathways(g, { score: { min: 10, max: null, min_open: true, max_open: false }, age: 50 });
    expect(nodes(r.paths[0])).toContain("SAMPLE-2:n5");
    expect(r.paths[0].steps.find((s) => s.node === "SAMPLE-1:n3")?.kind).toBe("met");
  });

  it("needs facts in auto mode but can start from a chosen page without any", () => {
    expect(rankPathways(g, {}).paths).toHaveLength(0);
    const r = rankPathways(g, {}, "SAMPLE-1");
    expect(r.paths.length).toBeGreaterThan(1);
    expect(r.paths.reduce((a, p) => a + p.likelihood, 0)).toBeCloseTo(1);
    expect(r.nextBest?.fact).toBe("score");
  });

  it("marks an arm without a condition as not encoded when its siblings have conditions", () => {
    const b2 = JSON.parse(JSON.stringify(bundle)) as Bundle;
    const n3 = b2.pages["SAMPLE-2"].nodes.find((n) => n.id === "n3")!;
    n3.pred = null;
    const g2 = buildGraph(b2);
    const open = rankPathways(g2, { score: 12 });
    const route = open.paths.find((p) => nodes(p).includes("SAMPLE-2:n3"))!;
    expect(route.steps.find((s) => s.node === "SAMPLE-2:n3")!.kind).toBe("uncoded");
    expect(route.uncoded).toBe(1);
    expect(route.open).toBe(1); // counted as open, never as met
    // once the conditioned sibling is ruled out, the remaining arm is the "otherwise" branch
    const other = rankPathways(g2, { score: 12, age: 50 });
    expect(other.paths[0].steps.find((s) => s.node === "SAMPLE-2:n3")!.kind).toBe("otherwise");
  });

  it("lists raw facts behind a derived condition", () => {
    expect(missingFacts(g, { fact: "tier", op: "==", value: "high" }, {})).toEqual(["score"]);
    expect(missingFacts(g, { fact: "late_stage_stated", op: "==", value: true }, {})).toEqual([]);
  });
});

// The processed prostate bundle is licensed-derived and gitignored; run when it has been built.
const REAL = new URL("../../private/viz/bundle.json", import.meta.url);
describe.skipIf(!existsSync(REAL))("prostate examples", () => {
  const b = existsSync(REAL) ? (JSON.parse(readFileSync(REAL, "utf8")) as Bundle) : null;
  const rg = b ? buildGraph(b) : null;
  const ex = (id: string) => b!.examples!.find((e) => e.id === id)!;
  it("V1 low risk after prostatectomy lands on monitoring", () => {
    const top = rankPathways(rg!, ex("V1").facts).paths[0];
    expect(top.likelihood).toBeGreaterThan(0.7);
    expect(rg!.node(top.steps[top.steps.length - 1].node)!.text).toMatch(/Monitoring/);
    expect(top.open).toBe(0);
  });
  it("V7 recurrence with metastases starts from the PSA recurrence page", () => {
    const r = rankPathways(rg!, ex("V7").facts);
    expect(r.entries.every((e) => e.startsWith("PROS-9:"))).toBe(true);
  });
});
