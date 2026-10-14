import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { adaptGuideline, isGuidelineFile, smartTitle, type GuidelineFile } from "../src/lib/adapt";
import { buildGraph, resolveRef } from "../src/lib/graph";
import { rankPathways } from "../src/lib/pathways";

const DATA = new URL("../../data/", import.meta.url);
const load = (slug: string) => JSON.parse(readFileSync(new URL(`${slug}/guideline.json`, DATA), "utf8")) as GuidelineFile;
const examples = JSON.parse(readFileSync(new URL("prostate/vignettes/examples.json", DATA), "utf8"));

describe("guideline.json adapter (prostate)", () => {
  const file = load("prostate");
  const b = adaptGuideline(file);
  const g = buildGraph(b);
  it("recognises the format and keeps every algorithm page", () => {
    expect(isGuidelineFile(file)).toBe(true);
    expect(Object.keys(b.pages)).toHaveLength(18);
    expect(b.pages["PROS-2"].title).toMatch(/Initial Risk Stratification/);
    expect(b.pages["PROS-3"].pdf).toBe(14);
  });
  it("keeps footnote source pages, typed links and multi-page documents", () => {
    const as = g.node("PROS-3:n154_109")!;
    expect(as.footnotes[0][2]).toBe(19); // PROS-7A is PDF page 20 (0-based 19)
    expect(as.decision).toBe("option");
    expect(b.docs["PROS-F"].pages).toHaveLength(5);
    expect(resolveRef(g, "PROS-F")).toEqual({ type: "doc", code: "PROS-F" });
  });
  it("continues table rows onto the linked page", () => {
    expect(b.children["PROS-2:t0_0_5"]).toEqual(["PROS-3:n272_26", "PROS-3:n492_25"]);
  });
  it("carries options' received conditions and rejected reviews", () => {
    expect(g.node("PROS-3:n270_109")!.received).toBeTruthy();
    expect([...g.nodes.values()].filter((n) => n.review === "rejected").length).toBe(4);
  });
  it("routes the example patients", () => {
    const ex = (id: string) => examples.find((e: { id: string }) => e.id === id).facts;
    const v1 = rankPathways(g, ex("V1")).paths[0];
    expect(v1.likelihood).toBeGreaterThan(0.6);
    expect(v1.steps.some((s) => s.node === "PROS-3:n392_109" && s.kind === "inferred")).toBe(true); // RP received
    const v7 = rankPathways(g, ex("V7"));
    expect(v7.paths.length).toBeGreaterThan(0);
  });
});

describe("all published guidelines", () => {
  const slugs = readdirSync(DATA).filter((s) => existsSync(new URL(`${s}/guideline.json`, DATA)));
  it("finds 91", () => expect(slugs.length).toBe(91));
  it("adapts every guideline and walks every start page", () => {
    for (const slug of slugs) {
      const b = adaptGuideline(load(slug));
      const g = buildGraph(b);
      for (const [id, kids] of Object.entries(b.children)) for (const k of kids) expect(g.node(k), `${slug} ${id} -> ${k}`).toBeTruthy();
      const start = g.flowPages.find((p) => (b.roots[p] ?? []).length);
      if (start) {
        const r = rankPathways(g, {}, start);
        expect(r.paths.length, `${slug} ${start}`).toBeGreaterThan(0);
      }
    }
  }, 120_000);
});

it("title-cases headings but keeps acronyms and stage codes", () => {
  expect(smartTitle("WORKUP FOR M1 CRPCxx,ddd")).toBe("Workup for M1 CRPC");
});
