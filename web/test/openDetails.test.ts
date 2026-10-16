/**
 * One definition of "what is still open": whatever the decision trail or the recommendation card
 * says answering would settle, the interview must be able to ask (openDetails), and what was
 * answered is never open.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Facts } from "../src/types";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph, type Graph } from "../src/lib/graph";
import { moments } from "../src/lib/moments";
import { rankPathways, recommendationOf } from "../src/lib/pathways";
import { rulesOnlyTrail } from "../src/lib/aiWalk";
import { openDetails, trailStart } from "../src/lib/openDetails";
import { remainingQuestions } from "../src/lib/formAssist";

const load = (slug: string) => buildGraph(adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"))));
const slugs = readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`)).sort();

describe("openDetails", () => {
  const prostate = load("prostate");

  it("is the interview's deciders plus whatever the trail stops for", () => {
    const facts: Facts = { clinical_t_category: "T2b", grade_group: "3", psa_ng_ml: 12 };
    const ranking = rankPathways(prostate, facts, "auto");
    const names = openDetails(prostate, facts, "auto", { ranking }).map((d) => d.fact);
    for (const d of remainingQuestions(prostate, ranking, facts)) expect(names).toContain(d.fact);
    for (const m of ranking.paths[0].missing) expect(names).toContain(m);
    const trail = rulesOnlyTrail(prostate, facts, trailStart(ranking, "auto"));
    for (const m of trail.missing ?? []) expect(names).toContain(m);
  });

  it("never lists what was answered, including 'don't know'", () => {
    const facts: Facts = { clinical_t_category: "T2b", grade_group: "3", psa_ng_ml: 12, life_expectancy_years: "unknown" };
    const names = openDetails(prostate, facts, "auto").map((d) => d.fact);
    for (const k of Object.keys(facts)) expect(names).not.toContain(k);
  });

  it("before anything is entered it asks what the first branches turn on", () => {
    expect(openDetails(prostate, {}, "auto").length).toBeGreaterThan(0);
  });

  it("everything the trail or the best route says would settle it can be asked, in every guideline", () => {
    let checked = 0;
    for (const slug of slugs) {
      const g = load(slug);
      const cases: [Facts, string][] = [[{}, "auto"], ...moments(g).slice(0, 6).map((m) => [{}, m.page] as [Facts, string])];
      for (const ex of (g.bundle.examples ?? []).slice(0, 2)) cases.push([ex.facts as Facts, "auto"]);
      for (const [facts, start] of cases) {
        const ranking = rankPathways(g, facts, start);
        const top = ranking.paths[0];
        if (!top) continue;
        const open = new Set(openDetails(g, facts, start, { ranking, limit: 200 }).map((d) => d.fact));
        const vars = g.bundle.schema.variables;
        const trail = rulesOnlyTrail(g, facts, trailStart(ranking, start));
        // What lies behind the treatment the best route recommends now (the margin of a resection, a later
        // recurrence) is for when the patient is there: it is not asked now.
        const rec = recommendationOf(g, top, ranking.paths);
        const treatmentFirst = rec.found && rec.tier === "treatment" && rec.index + 1 < top.steps.length;
        const behind = treatmentFirst && top.steps.findIndex((s) => s.node === trail.end) > rec.index;
        const said = [...(!behind && (trail.stoppedFor === "ask" || trail.stoppedFor === "not-enough") ? trail.missing ?? [] : []), ...top.missing, ...(treatmentFirst ? [] : top.laterMissing)].filter((m) => vars[m] && facts[m] === undefined);
        for (const m of said) expect(open.has(m), `${slug} ${start}: ${m} is said to settle it but is not asked`).toBe(true);
        checked += said.length;
      }
    }
    expect(checked).toBeGreaterThan(50);
  }, 300_000);
});
