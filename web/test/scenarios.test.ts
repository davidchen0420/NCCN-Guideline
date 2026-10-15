/**
 * Regression tests from a scripted clinician audit: in three of four realistic cases the top
 * route was clinically wrong or ignored the clinician's input while labelled "Best match".
 * Each block loads the real encoded guideline and states what a clinician would expect.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Bundle } from "../src/types";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph } from "../src/lib/graph";
import { rankPathways, type Pathway } from "../src/lib/pathways";
import { extractFacts, applyFound } from "../src/lib/extract";
import { decidingFacts, previewAnswer, remainingQuestions } from "../src/lib/formAssist";
import { moments, momentsFor, phaseOf, startPhase } from "../src/lib/moments";

const load = (slug: string) => buildGraph(adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"))));
const pages = (p: Pathway) => [...new Set(p.steps.map((s) => s.node.split(":")[0]))];
const last = (p: Pathway) => p.steps[p.steps.length - 1].node;

describe("1. prostate, low-risk paste, start unsure", () => {
  const g = load("prostate");
  const paste = "64-year-old man with low-risk prostate cancer (cT1c, Gleason 3+3, PSA 5 ng/mL), life expectancy about 18 years";
  const facts = applyFound({}, extractFacts(paste, g.bundle.schema)).facts;

  it("reads the paste as low risk with a long life expectancy", () => {
    expect(facts).toMatchObject({ risk_group: "low", life_expectancy_years: 18 });
  });

  it("never starts a route mid-guideline at a page whose gate the facts do not satisfy", () => {
    const r = rankPathways(g, facts, "auto");
    expect(r.paths.length).toBeGreaterThan(0);
    for (const p of r.paths) {
      expect(pages(p), p.id).not.toContain("PROS-5");   // unfavorable intermediate
      expect(pages(p), p.id).not.toContain("PROS-6");   // high / very high
    }
  });

  it("offers the low-risk group (PROS-3) as the best route, or the diagnosis page with N and M as open details", () => {
    const top = rankPathways(g, facts, "auto").paths[0];
    expect(pages(top)).toContain("PROS-3");
    expect(top.steps.some((s) => s.node.startsWith("PROS-3:") && s.kind === "met")).toBe(true);
    expect(top.used).toEqual(expect.arrayContaining(["life_expectancy_years"]));
    expect(top.used.length).toBeGreaterThan(1);   // the risk group, not only the life expectancy
    expect(top.missing).toEqual(expect.arrayContaining(["n_category", "m_category"]));
  });

  it("agrees when the diagnosis page is chosen as the start", () => {
    const auto = rankPathways(g, facts, "auto").paths[0];
    const pros1 = rankPathways(g, facts, "PROS-1").paths[0];
    expect(pages(pros1)).toContain("PROS-3");
    expect(pros1.steps.map((s) => s.node)).toEqual(auto.steps.map((s) => s.node));
    for (const p of rankPathways(g, facts, "PROS-1").paths.slice(0, 3)) expect(pages(p), p.id).not.toContain("PROS-5");
  });
});

describe("1b. the worked prostate examples still get a supported route", () => {
  const g = load("prostate");
  const examples = JSON.parse(readFileSync("../data/prostate/vignettes/examples.json", "utf8")) as { id: string; facts: Record<string, unknown> }[];
  it.each(examples.map((e) => [e.id, e.facts] as const))("%s", (_id, facts) => {
    const r = rankPathways(g, facts as never);
    expect(r.paths.length).toBeGreaterThan(0);
    expect(r.paths[0].used.length).toBeGreaterThan(0);
  });
});

describe("2. NSCLC surveillance", () => {
  const g = load("nsclc");
  const schedule = "NSCL-17:n162_24";

  it("stops at the surveillance schedule: what follows depends on a recurrence that has not happened", () => {
    for (const facts of [{ n_category: "N0" }, { operable: true, n_category: "N0" }, { n_category: "N0", recurrence_pattern: "none" }]) {
      const top = rankPathways(g, facts, "NSCL-17").paths[0];
      expect(last(top), JSON.stringify(facts)).toBe(schedule);
      expect(top.end).toBe("later");
      expect(top.steps.find((s) => s.node === schedule)!.kind).toBe("met");
    }
  });

  it("goes on to the recurrence workup and its therapy when a recurrence is stated", () => {
    const top = rankPathways(g, { n_category: "N0", recurrence_pattern: "distant" }, "NSCL-17").paths[0];
    expect(top.steps.map((s) => s.node)).toEqual(expect.arrayContaining([schedule, "NSCL-17:n361_510", "NSCL-18:n389_24"]));
  });
});

describe("3. B-cell lymphomas, a chosen subtype", () => {
  const g = load("b_cell_lymphomas");
  const FL = "Classic Follicular Lymphoma";

  it("starts on the subtype's own pages instead of the shared diagnostic-testing box", () => {
    const r = rankPathways(g, { guideline_section: FL }, "auto");
    expect(r.paths.length).toBeGreaterThan(0);
    const sec = g.bundle.sections!.pages;
    for (const p of r.paths) {
      expect(p.steps[0].node.startsWith("DIAG-1:"), p.id).toBe(false);
      for (const pg of pages(p)) expect([null, undefined, FL], `${pg} in ${p.id}`).toContain(sec[pg]);
    }
    expect(pages(r.paths[0])[0]).toMatch(/^FOLL-/);
  });

  it("gives each subtype its own routes", () => {
    for (const v of ["Mantle Cell Lymphoma", "Diffuse Large B-Cell Lymphoma", "Burkitt Lymphoma"]) {
      const top = rankPathways(g, { guideline_section: v }, "auto").paths[0];
      expect(pages(top).every((pg) => [null, undefined, v].includes(g.bundle.sections!.pages[pg])), v).toBe(true);
    }
  });

  it("offers no single subtype's follow-up page before a subtype is chosen, and the section's own moments after", () => {
    const all = moments(g);
    expect(all.map((m) => m.page)).toContain("MANT-3");
    const before = momentsFor(g, all, {});
    const sec = g.bundle.sections!.pages;
    for (const m of before) expect(sec[m.page] ?? null, m.page).toBeNull();
    expect(before.map((m) => m.page)).not.toContain("MANT-3");
    expect(before.some((m) => m.phase === "diagnosis")).toBe(true);
    const mantle = momentsFor(g, all, { guideline_section: "Mantle Cell Lymphoma" });
    expect(mantle.map((m) => m.page)).toContain("MANT-3");
    const fl = momentsFor(g, all, { guideline_section: FL });
    expect(fl.some((m) => m.phase === "diagnosis")).toBe(true);
    for (const m of fl) expect([null, undefined, FL]).toContain(sec[m.page]);
  });
});

describe("4. prostate PSA recurrence after prostatectomy", () => {
  const g = load("prostate");

  it("puts the recurrence pages in the recurrence phase by what their entry boxes say", () => {
    const m = moments(g);
    const rec = m.filter((x) => x.phase === "recurrence").map((x) => x.page);
    expect(rec).toEqual(expect.arrayContaining(["PROS-8", "PROS-9", "PROS-10"]));
    expect(startPhase(g, "PROS-9")).toBe("recurrence");
    expect(phaseOf("Radical Prostatectomy PSA")).toBeNull();   // the title alone does not say
  });

  it("reaches the prostatectomy-recurrence page when a PSA recurrence is stated", () => {
    const f = { definitive_treatment_received: "radical_prostatectomy", psa_status: "recurrence" };
    const r = rankPathways(g, f, "PROS-8");
    expect(r.paths[0].steps.map((s) => s.node)).toContain("PROS-9:n342_13");
    expect(r.paths[0].used).toEqual(expect.arrayContaining(["definitive_treatment_received", "psa_status"]));
  });

  it("asks about the PSA when only the prostatectomy is known, and stays on the monitoring schedule until then", () => {
    const f = { definitive_treatment_received: "radical_prostatectomy" };
    const r = rankPathways(g, f, "PROS-8");
    const top = r.paths[0];
    expect(top.end).toBe("later");
    expect(top.steps.map((s) => s.node)).toEqual(["PROS-8:n222_28", "PROS-8:n190_190", "PROS-8:n154_345"]);
    expect(top.laterMissing).toContain("psa_status");
    const asked = decidingFacts(g, r, f).map((d) => d.fact);
    expect(asked).toContain("psa_status");
    expect(asked.indexOf("psa_status")).toBeLessThan(4);
  });
});

describe("5. honest support", () => {
  const b = JSON.parse(readFileSync(new URL("../public/sample-bundle.json", import.meta.url), "utf8")) as Bundle;
  const sample = buildGraph(b);

  it("lists the raw facts that decided a route's met steps, through derived facts", () => {
    const p = rankPathways(sample, { score: 12, age: 70 }).paths[0];
    expect(p.used.sort()).toEqual(["age", "score"]);
    expect(p.missing).toEqual([]);
  });

  it("lists only the facts that were known, and none when nothing decided the route", () => {
    const p = rankPathways(sample, { score: 12 }).paths[0];
    expect(p.used).toEqual(["score"]);
    expect(p.missing).toEqual(["age"]);
    for (const q of rankPathways(sample, {}, "SAMPLE-1").paths) expect(q.used).toEqual([]);
  });

  it("counts a stated classification as used and an unrelated fact as not used", () => {
    const g = load("prostate");
    const p = rankPathways(g, { risk_group: "low", life_expectancy_years: 18, brca1_2_mutation: false }, "PROS-1").paths[0];
    expect(p.used).toEqual(expect.arrayContaining(["risk_group", "life_expectancy_years"]));
    expect(p.used).not.toContain("brca1_2_mutation");
  });
});

describe("6. previews name where the answer actually routes", () => {
  const g = load("prostate");
  const facts = applyFound({}, extractFacts("64-year-old man with low-risk prostate cancer (cT1c, Gleason 3+3, PSA 5 ng/mL), life expectancy about 18 years", g.bundle.schema)).facts;

  it("N1 leads to regional prostate cancer (PROS-7), not an intermediate-risk page", () => {
    const base = rankPathways(g, facts);
    const pv = previewAnswer(g, facts, "n_category", "N1", base);
    expect(pv.decides?.page).toBe("PROS-7");
    expect(pv.decides?.text).toMatch(/\S/);
  });

  it("an answer that changes nothing names no new branch", () => {
    const base = rankPathways(g, { ...facts, n_category: "N0" });
    const pv = previewAnswer(g, { ...facts, n_category: "N0" }, "n_category", "N0", base);
    expect(pv.decides).toBeUndefined();
  });
});

describe("7. honest question count", () => {
  const g = load("prostate");
  const facts = applyFound({}, extractFacts("64-year-old man with low-risk prostate cancer (cT1c, Gleason 3+3, PSA 5 ng/mL), life expectancy about 18 years", g.bundle.schema)).facts;

  it("counts the distinct open details of the top routes only", () => {
    const rk = rankPathways(g, facts);
    const left = remainingQuestions(g, rk, facts);
    const all = decidingFacts(g, rk, facts, 50);
    const names = left.map((d) => d.fact);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThanOrEqual(all.length);
    const top = rk.paths[0].missing;
    for (const m of top) expect(names).toContain(m);
    for (const k of Object.keys(facts)) expect(names).not.toContain(k);
  });

  it("is empty when the top route is fully decided and does not count routes that are out of reach", () => {
    const b = JSON.parse(readFileSync(new URL("../public/sample-bundle.json", import.meta.url), "utf8")) as Bundle;
    const sample = buildGraph(b);
    const f = { score: 12, age: 70 };
    expect(remainingQuestions(sample, rankPathways(sample, f), f)).toEqual([]);
    const f2 = { score: 12 };
    expect(remainingQuestions(sample, rankPathways(sample, f2), f2).map((d) => d.fact)).toEqual(["age"]);
  });
});
