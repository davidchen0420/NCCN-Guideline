import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Bundle } from "../src/types";
import { buildGraph, pathSets, resolveRef } from "../src/lib/graph";
import { autoStep, startWalk } from "../src/lib/walk";
import { cardWidth, layoutPage } from "../src/lib/layout";
import { parseInline } from "../src/lib/parseBox";

const bundle = JSON.parse(readFileSync(new URL("../public/sample-bundle.json", import.meta.url), "utf8")) as Bundle;
const g = buildGraph(bundle);

describe("graph", () => {
  it("resolves page references to pages and documents", () => {
    expect(resolveRef(g, "SAMPLE-2")).toEqual({ type: "flow", page: "SAMPLE-2" });
    expect(resolveRef(g, "SAMPLE-A")).toEqual({ type: "doc", code: "SAMPLE-A" });
    expect(resolveRef(g, "MS-1")).toEqual({ type: "doc", code: "MS-1" });
    expect(resolveRef(g, "NOPE-9")).toEqual({ type: "none" });
  });

  it("recognises the guideline's own page prefix as a reference", () => {
    const inl = parseInline("see Principles of Scoring (SAMPLE-A) and SAMPLE-2");
    expect(inl.filter((x) => x.t === "link" || x.t === "ref")).toHaveLength(2);
  });

  it("indexes where a document is cited from", () => {
    const hits = g.refIndex.get("SAMPLE-A") ?? [];
    expect(hits.map((h) => h.via).sort()).toEqual(expect.arrayContaining(["box", "footnote"]));
  });

  it("selecting an answer lights its ancestors and descendants across pages", () => {
    const p = pathSets(g, ["SAMPLE-1:n3"]);
    expect(p.nodes.has("SAMPLE-1:n1")).toBe(true);
    expect(p.nodes.has("SAMPLE-2:n5")).toBe(true);
    expect(p.nodes.has("SAMPLE-1:n4")).toBe(false);
  });
});

describe("guided walk", () => {
  it("follows the branches the facts decide, across pages", () => {
    const w = startWalk(g, "SAMPLE-1", null, { score: 12, age: 70 })!;
    expect(w.path.map((s) => s.node)).toEqual(["SAMPLE-1:n1", "SAMPLE-1:n2", "SAMPLE-1:n3", "SAMPLE-2:n1", "SAMPLE-2:n2", "SAMPLE-2:n4"]);
    expect(w.path.filter((s) => s.by === "predicate")).toHaveLength(2);
  });
  it("stops where the facts do not decide", () => {
    const w = startWalk(g, "SAMPLE-1", null, {})!;
    expect(w.at).toBe("SAMPLE-1:n1");
    expect(autoStep(g, w, { score: 3 }).at).toBe("SAMPLE-1:n5");
  });
});

describe("layout", () => {
  const flow = bundle.pages["SAMPLE-1"];
  const parsed = Object.fromEntries(flow.nodes.map((n) => [n.id, g.parsed.get(`SAMPLE-1:${n.id}`)!]));
  const heights = Object.fromEntries(flow.nodes.map((n, i) => [n.id, 60 + 40 * (i % 3)]));
  const lay = layoutPage(flow, heights, parsed, bundle.top);
  const cards = Object.values(lay.cards);
  it("places every box without overlap", () => {
    expect(cards).toHaveLength(flow.nodes.filter((n) => n.kind === "box").length);
    for (const a of cards) for (const b of cards) {
      if (a === b) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  });
  it("keeps the PDF's left-to-right order of columns", () => {
    const col = (id: string) => lay.cards[id].col;
    expect(col("n3")).toBeLessThanOrEqual(col("n5"));
  });
  it("sizes cards from their text", () => {
    expect(cardWidth(parsed["n1"])).toBeLessThanOrEqual(cardWidth(parsed["n3"]));
  });
});
