/**
 * Round-3 live clinician audit: the interview asks the question the recommendation card is waiting for,
 * asks nothing about another branch's, another disease's or a later stage's pages, a start that only gives
 * background points to the first page that says what to do, and the model is asked a handful of times
 * over a run of quick answers, not once per answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Facts } from "../src/types";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph, type Graph } from "../src/lib/graph";
import { PHASES, impliedBySection, isContextPage, moments, momentsFor, nextActionPage, nextPageOf, pageOfOtherSection, pointerTitle, reachableFacts, settingsFor } from "../src/lib/moments";
import { rankPathways, reachesRecommendation, recommendationOf, shownRoute } from "../src/lib/pathways";
import { cardSettlers, interviewQuestions } from "../src/lib/openDetails";
import { relevantFacts } from "../src/lib/decide";
import { rulesOnlyTrail, type ScoreFn } from "../src/lib/aiWalk";
import { AiTrailScheduler, needsModel, walkSignature, type WalkInputs } from "../src/lib/useAiTrail";

const slugs = readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`)).sort();
const cache = new Map<string, Graph>();
const load = (slug: string) => {
  let g = cache.get(slug);
  if (!g) cache.set(slug, (g = buildGraph(adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"))))));
  return g;
};

/** What the interview asks for these answers, as the patient form computes it (the scope of the start page; the card's own names are asked beyond it). */
function questions(g: Graph, facts: Facts, start: string) {
  const sv = g.bundle.sections?.variable;
  const scope = start !== "auto" && g.bundle.pages[start] ? reachableFacts(g, [start]) : null;
  const ranking = rankPathways(g, facts, start);
  return interviewQuestions(g, ranking, facts, start, {}, (f) => f !== sv && (!scope || scope.has(f)), (f) => f !== sv);
}
/** Answer the first question with its first (or last) choice, until nothing is asked. */
function interview(g: Graph, facts: Facts, start: string, pick: "first" | "last" = "first", max = 30) {
  let f = { ...facts };
  const asked: string[] = [];
  for (let i = 0; i < max; i++) {
    const q = questions(g, f, start)[0];
    if (!q) break;
    const spec = g.bundle.schema.variables[q.fact];
    const vals = spec.type === "bool" ? [true, false] : spec.type === "enum" ? (spec.values ?? []).filter((v) => v !== "other") : [1];
    asked.push(q.fact);
    f = { ...f, [q.fact]: pick === "first" ? vals[0] : vals[vals.length - 1] };
  }
  return { asked, facts: f };
}
const pageOfNode = (id: string) => id.split(":")[0];
/** The details picking a setting states (REC-2A: distant metastases), added to the chosen disease's own. */
function atSetting(g: Graph, facts: Facts, start: string): Facts {
  const sec = g.bundle.sections;
  const list = sec && typeof facts[sec.variable] === "string" ? momentsFor(g, moments(g), facts) : moments(g);
  const st = PHASES.flatMap((p) => settingsFor(g, list, p.id)).find((x) => x.page === start);
  return { ...facts, ...(st?.implied ?? {}) };
}

describe("the first question is one the recommendation card names as settling it", () => {
  it("rectal, metastatic start (REC-2A): the metastatic sites the card names, not 'Disease Resectable'", () => {
    const g = load("rectal");
    const facts = atSetting(g, { guideline_section: "pMMR/MSS Rectal Cancer" }, "REC-2A");
    expect(facts.distant_metastases_suspected_or_proven).toBe(true);
    const q = questions(g, facts, "REC-2A");
    expect(cardSettlers(g, facts, "REC-2A").slice(0, 4)).toEqual(["liver_metastases_present", "lung_metastases_present", "peritoneal_metastases_present", "other_site_metastases_present"]);
    expect(q.slice(0, 4).map((d) => d.fact)).toEqual(["liver_metastases_present", "lung_metastases_present", "peritoneal_metastases_present", "other_site_metastases_present"]);
    // answering them (and nothing else) reaches the treatment
    const done = interview(g, facts, "REC-2A");
    const r = rankPathways(g, done.facts, "REC-2A");
    const rec = recommendationOf(g, shownRoute(g, r, null)!, r.paths);
    expect(rec.tier).toBe("treatment");
    expect(cardSettlers(g, done.facts, "REC-2A")).toEqual([]);
  });
  it("colon, metastatic start (COL-2A): the interview goes on until the card has nothing left to name", () => {
    const g = load("colon");
    const facts = atSetting(g, { guideline_section: "pMMR/MSS Colon Cancer" }, "COL-2A");
    for (const pick of ["first", "last"] as const) {
      const done = interview(g, facts, "COL-2A", pick);
      expect(done.asked.length, pick).toBeGreaterThan(1);
      expect(cardSettlers(g, done.facts, "COL-2A").filter((f) => done.facts[f] === undefined && questions(g, done.facts, "COL-2A").some((d) => d.fact === f)), pick).toEqual([]);
    }
    // the card names "Metastases Appeared" after M1: that is the next question
    const after = { ...facts, m_category: "M1" } as Facts;
    const names = cardSettlers(g, after, "COL-2A");
    if (names.length) expect(questions(g, after, "COL-2A")[0].fact).toBe(names[0]);
  });

  it("every guideline, every disease, every setting: the first question is among the details the card names (when it names any)", () => {
    let runs = 0, named = 0;
    const bad: string[] = [];
    for (const slug of slugs) {
      const g = load(slug);
      const all = moments(g);
      const sec = g.bundle.sections;
      const lists = sec ? sec.values.map((v) => [v, momentsFor(g, all, { [sec.variable]: v })] as const) : [["", all] as const];
      for (const [section, list] of lists) {
        const seen = new Set<string>();
        for (const ph of PHASES) for (const st of settingsFor(g, list, ph.id)) {
          if (seen.has(st.page)) continue;
          seen.add(st.page);
          const facts: Facts = { ...(sec ? { [sec.variable]: section, ...impliedBySection(g, section) } : {}), ...st.implied };
          const qs = questions(g, facts, st.page);
          const settle = cardSettlers(g, facts, st.page);
          runs++;
          if (!settle.length) continue;
          named++;
          if (!qs.length || !settle.includes(qs[0].fact)) bad.push(`${slug} [${section}] ${st.page}: first=${qs[0]?.fact} card names ${settle.join(",")}`);
        }
      }
    }
    expect(runs).toBeGreaterThan(400);
    expect(named).toBeGreaterThan(150);
    expect(bad).toEqual([]);
  }, 300_000);
});

describe("no question about a page the answers rule out, another disease's page, or a later stage", () => {
  it("NSCLC stage IA: 'Histology' (a metastatic biomarker page, NSCL-19) is not asked", () => {
    const g = load("nsclc");
    const facts = { m_category: "M0", n_category: "N0", clinical_t_category: "T1b", tumor_location: "peripheral", operable: true, contralateral_lung_nodule: false } as Facts;
    const qs = questions(g, facts, "NSCL-1");
    expect(qs.map((d) => d.fact)).not.toContain("histology");
    expect(qs.map((d) => pageOfNode(d.node)).filter((p) => p === "NSCL-19")).toEqual([]);
    // the questions that open that branch come first (pleural disease would reach it)
    expect(qs.map((d) => d.fact)).toEqual(expect.arrayContaining(["pleural_or_disseminated_metastases"]));
  });
  it("ovarian stage III (OV-1): nothing from the less common ovarian cancers' pages (LCOC)", () => {
    const g = load("ovarian_cancer_fallopian_tube_cancer_primary_per");
    const facts = {
      guideline_section: "Epithelial Ovarian Cancer/Fallopian Tube Cancer/ Primary Peritoneal Cancer", figo_stage: "III", pelvic_mass_on_exam: true,
      poor_surgical_candidate: false, optimal_cytoreduction_likely: true, histologic_diagnosis_available: true, referred_after_recent_surgery: false,
    } as Facts;
    const qs = questions(g, facts, "OV-1");
    expect(qs.map((d) => d.fact)).not.toEqual(expect.arrayContaining(["tumor_behavior"]));
    for (const d of qs) expect(pageOfNode(d.node), d.fact).not.toMatch(/^LCOC/);
  });
  it("follicular lymphoma, new patient: 'Response Category' (found at restaging) is not asked", () => {
    const g = load("b_cell_lymphomas");
    const facts = { guideline_section: "Classic Follicular Lymphoma", ann_arbor_stage: "III", candidate_for_clinical_trial: false, symptomatic: true } as Facts;
    for (const start of ["auto", "FOLL-1"]) {
      const done = interview(g, facts, start);
      expect(done.asked, start).not.toContain("response_category");
    }
  });
  it("library-wide: no question is for another disease's page, and none is a detail defined as found only later at a first workup", () => {
    const bad: string[] = [];
    let runs = 0;
    for (const slug of slugs) {
      const g = load(slug);
      const all = moments(g);
      const sec = g.bundle.sections;
      const lists = sec ? sec.values.map((v) => [v, momentsFor(g, all, { [sec.variable]: v })] as const) : [["", all] as const];
      for (const [section, list] of lists) {
        const seen = new Set<string>();
        for (const ph of PHASES) for (const st of settingsFor(g, list, ph.id)) {
          if (seen.has(st.page)) continue;
          seen.add(st.page);
          const facts: Facts = { ...(sec ? { [sec.variable]: section, ...impliedBySection(g, section) } : {}), ...st.implied };
          const other = pageOfOtherSection(g, facts);
          runs++;
          for (const d of questions(g, facts, st.page)) if (other(d.page)) bad.push(`${slug} [${section}] ${st.page}: ${d.fact} is for ${d.page}`);
        }
      }
    }
    expect(runs).toBeGreaterThan(400);
    expect(bad).toEqual([]);
  }, 300_000);
});

describe("a start that only gives background points to the first page that says what to do", () => {
  const g = load("survivorship");
  it("fatigue: the definition page (SFAT-1) is background; the next step is the screening page", () => {
    expect(isContextPage(g, "SFAT-1")).toBe(true);
    expect(isContextPage(g, "SFAT-5")).toBe(false);
    expect(nextActionPage(g, "SFAT-1")).toBe("SFAT-2");
    expect(pointerTitle(g, "SFAT-2")).toBe("Screening");
    expect(nextActionPage(g, "SFAT-5")).toBeNull();
    const r = rankPathways(g, { guideline_section: "Survivorship: Fatigue" }, "SFAT-1");
    expect(nextPageOf(g, r)).toBe("SFAT-2");
  });
  it("fatigue: the interview asks the screening page's deciding question", () => {
    const facts = { guideline_section: "Survivorship: Fatigue" } as Facts;
    const qs = questions(g, facts, "SFAT-1");
    expect(qs.map((d) => d.fact)).toEqual(["fatigue_score"]);
    expect(qs[0].page).toBe("SFAT-2");
    // once answered, nothing more is asked
    expect(questions(g, { ...facts, fatigue_score: 6 }, "SFAT-1")).toEqual([]);
  });
  it("library-wide: a setting that starts at a background page either points on or has nowhere to go", () => {
    let seenContext = 0;
    for (const slug of slugs) {
      const gg = load(slug);
      const all = moments(gg);
      const sec = gg.bundle.sections;
      const lists = sec ? sec.values.map((v) => [v, momentsFor(gg, all, { [sec.variable]: v })] as const) : [["", all] as const];
      for (const [, list] of lists) for (const ph of PHASES) for (const st of settingsFor(gg, list, ph.id)) {
        if (!isContextPage(gg, st.page)) continue;
        seenContext++;
        const next = nextActionPage(gg, st.page);
        if (next) {
          expect(next, `${slug} ${st.page}`).not.toBe(st.page);
          expect(isContextPage(gg, next), `${slug} ${st.page} -> ${next}`).toBe(false);
        }
      }
    }
    expect(seenContext).toBeGreaterThan(5);
  });
});

describe("AI calls over an answer sequence", () => {
  const g = load("prostate");
  const START = "PROS-2";
  const THRESHOLD = 0.85;
  /** a scorer that counts the requests it is asked for and always gives an even split (so the walk stops there and asks) */
  const counting = () => {
    const nodes: string[] = [];
    const score: ScoreFn = async (_g, _f, ids) => {
      nodes.push(...ids);
      return new Map(ids.map((id) => [id, new Map((g.kids(id) ?? []).map((k) => [k, 1 / Math.max(1, g.kids(id).length)] as const))] as const));
    };
    return { nodes, score };
  };
  const inputs = (facts: Facts, score: ScoreFn, interviewing: boolean, factsChanged = true): WalkInputs | null => {
    const rules = rulesOnlyTrail(g, facts, START, {});
    if (!needsModel(rules, {})) return null;
    return {
      g, facts, start: START, overrides: {}, threshold: THRESHOLD, sig: walkSignature(g, facts, START, {}, THRESHOLD, rules), factsChanged, interviewing,
      debounceMs: 400, interviewIdleMs: 1000, score,
    };
  };
  const answers = (): Facts[] => {
    const seq: Facts[] = [];
    let acc: Facts = {};
    for (const [k, v] of Object.entries({ m_category: "M0", n_category: "N0", clinical_t_category: "T2b", grade_group: 2, psa_ng_ml: 7, life_expectancy_years: 12, ecog_score: 0, symptomatic_metastases: false, hereditary_risk: false, brca_mutation: false } as Record<string, unknown>)) {
      if (!g.bundle.schema.variables[k]) continue;
      acc = { ...acc, [k]: v }; seq.push(acc);
    }
    return seq;
  };
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("ten quick answers during the interview ask the model at most three times", async () => {
    const { nodes, score } = counting();
    const done: unknown[] = [];
    const sched = new AiTrailScheduler((d) => done.push(d));
    const seq = answers();
    expect(seq.length).toBeGreaterThanOrEqual(6);
    for (const facts of seq) {
      const i = inputs(facts, score, true);
      if (i) sched.update(i, false); else sched.cancel();
      await vi.advanceTimersByTimeAsync(150);   // the next answer comes quickly
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.length).toBeLessThanOrEqual(3);
    expect(sched.starts).toBeLessThanOrEqual(3);
    expect(done.length).toBeGreaterThan(0);
    sched.cancel();
  });

  it("an answer the asked boxes do not rest on asks nothing again, even after the quiet wait", async () => {
    const { nodes, score } = counting();
    const sched = new AiTrailScheduler(() => { /* result not needed here */ });
    const base: Facts = { m_category: "M0", n_category: "N0", clinical_t_category: "T2b" };
    const first = inputs(base, score, false)!;
    expect(first).toBeTruthy();
    sched.update(first, false);
    await vi.advanceTimersByTimeAsync(2000);
    const before = nodes.length;
    expect(before).toBeGreaterThan(0);
    const rules = rulesOnlyTrail(g, base, START, {});
    const rel = relevantFacts(g, rules.end);
    const unrelated = Object.keys(g.bundle.schema.variables).find((k) => !rel.has(k) && g.bundle.schema.variables[k].type === "bool" && base[k] === undefined)!;
    expect(unrelated).toBeTruthy();
    const next = inputs({ ...base, [unrelated]: true }, score, false)!;
    expect(next.sig).toBe(first.sig);
    sched.update(next, false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(nodes.length).toBe(before);
    sched.cancel();
  });

  it("outside the interview (the recommendation is open) it waits only the short debounce", async () => {
    const { nodes, score } = counting();
    const sched = new AiTrailScheduler(() => { /* result not needed here */ });
    const i = inputs({ m_category: "M0", n_category: "N0", clinical_t_category: "T2b" }, score, false)!;
    sched.update(i, false);
    await vi.advanceTimersByTimeAsync(300);
    expect(nodes.length).toBe(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(nodes.length).toBeGreaterThan(0);
    sched.cancel();
  });

  it("while questions are being answered the wait is the long one, and opening the recommendation shortens it", async () => {
    const { nodes, score } = counting();
    const sched = new AiTrailScheduler(() => { /* result not needed here */ });
    const facts: Facts = { m_category: "M0", n_category: "N0", clinical_t_category: "T2b" };
    sched.update(inputs(facts, score, true)!, false);
    await vi.advanceTimersByTimeAsync(700);
    expect(nodes.length).toBe(0);
    // the recommendation tab opens: the short wait counts from the last answer
    sched.update(inputs(facts, score, false, false)!, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(nodes.length).toBeGreaterThan(0);
    sched.cancel();
  });
});
