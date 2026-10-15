import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph } from "../src/lib/graph";
import { carryOver, moments, momentsFor, phaseOf, reachableFacts, startPhase } from "../src/lib/moments";

const load = (slug: string) => buildGraph(adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"))));
const pros = load("prostate");

describe("clinical moments", () => {
  it("reads the phase from a page title", () => {
    expect(phaseOf("Workup for Second Biochemical Recurrence (BCR2)")).toBe("recurrence");
    expect(phaseOf("Relapsed/Refractory Disease")).toBe("recurrence");
    expect(phaseOf("Metastatic Castration-Resistant Prostate Cancer")).toBe("advanced");
    expect(phaseOf("Surveillance After Completion")).toBe("followup");
    expect(phaseOf("Subsequent Therapy")).toBe("later");
    expect(phaseOf("Initial Risk Stratification")).toBeNull();
  });

  it("finds prostate's start page and its later moments", () => {
    const m = moments(pros);
    expect(m.find((x) => x.phase === "diagnosis")?.page).toBe("PROS-1");
    expect(m.filter((x) => x.phase === "recurrence").map((x) => x.page)).toContain("PROS-8");
    expect(m.some((x) => x.phase === "advanced")).toBe(true);
    expect(startPhase(pros, "auto")).toBeNull();
    expect(startPhase(pros, "PROS-1")).toBe("diagnosis");
    expect(startPhase(pros, "PROS-8")).toBe("recurrence");
  });

  it("every guideline has a diagnosis moment, and a section limits the moments to its pages", () => {
    const slugs = readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`));
    for (const slug of slugs) {
      const g = load(slug);
      const m = moments(g);
      expect(m.some((x) => x.phase === "diagnosis"), slug).toBe(true);
      const sec = g.bundle.sections;
      if (sec) {
        for (const v of sec.values) {
          const mine = momentsFor(g, m, { [sec.variable]: v });
          if (mine === m) continue;   // no moments of its own: all are offered
          for (const x of mine) expect([undefined, null, v], `${slug} ${x.page}`).toContain(sec.pages[x.page]);
        }
      }
    }
  });

  it("a later moment's form holds fewer details than the whole schema, and those its branches use", () => {
    const all = Object.keys(pros.bundle.schema.variables);
    const rec = reachableFacts(pros, ["PROS-8"]);
    expect(rec.size).toBeGreaterThan(3);
    expect([...rec].filter((f) => all.includes(f)).length).toBeLessThan(all.length);
  });

  it("carries over the details describing the patient then, and releases them back at diagnosis", () => {
    const vars = pros.bundle.schema.variables;
    const cur = Object.keys(vars).find((k) => (vars[k].time ?? "current") === "current" && /life_expectancy/.test(k))!;
    const dx = Object.keys(vars).find((k) => vars[k].time === "at_diagnosis")!;
    const facts = { [cur]: 15, [dx]: vars[dx].type === "number" ? 5 : (vars[dx].values ?? [true])[0] };
    const held = carryOver(pros, "auto", "PROS-8", facts, []);
    expect(held).toEqual([cur]);
    // moving between later moments keeps what is held; back to diagnosis releases it
    expect(carryOver(pros, "PROS-8", "PROS-10", facts, held)).toEqual(held);
    expect(carryOver(pros, "PROS-8", "PROS-1", facts, held)).toEqual([]);
    expect(carryOver(pros, "PROS-8", "auto", facts, held)).toEqual(held);
  });
});

describe("which guidelines offer the choice", () => {
  it("disease guidelines do, screening and supportive care do not", async () => {
    const { followsDisease } = await import("../src/lib/moments");
    expect(followsDisease("Prostate Cancer")).toBe(true);
    expect(followsDisease("Lung Cancer Screening")).toBe(false);
    expect(followsDisease("Cancer-Related Fatigue")).toBe(false);
  });
});
