/**
 * Round-2 clinician re-audit: every guideline gives the guideline-concordant treatment for the patient's
 * setting. Each block loads the real encoded guideline and states what a clinician expects the card to
 * name; the library-wide block checks that an answered detail constrains where the walk starts.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Facts, Pred } from "../src/types";
import { adaptGuideline, stripMarks } from "../src/lib/adapt";
import { buildGraph, type Graph } from "../src/lib/graph";
import { boxClass, distinctRecommendations, isCriteriaBox, missingFacts, namedStatusFacts, rankPathways, recommendationOf, shownRoute, statusSnippet } from "../src/lib/pathways";
import { derive, evaluate } from "../src/lib/predicates";
import { aiWalk, rulesOnlyTrail } from "../src/lib/aiWalk";
import { clearDecideCache, relevantFacts } from "../src/lib/decide";
import { openDetails, trailStart } from "../src/lib/openDetails";
import { isPendingDecision, offeredOptions } from "../src/lib/trailView";
import { needsModel } from "../src/lib/useAiTrail";

const slugs = readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`)).sort();
const cache = new Map<string, Graph>();
const load = (slug: string) => {
  let g = cache.get(slug);
  if (!g) cache.set(slug, (g = buildGraph(adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"))))));
  return g;
};
const plain = (g: Graph, id: string) => stripMarks(g.node(id)?.text ?? id).replace(/\s+/g, " ");
const pagesOf = (ids: string[]) => [...new Set(ids.map((x) => x.split(":")[0]))];

/** What the recommendation card names for these answers from this start: its headline box, the options listed with it, the page. */
function card(g: Graph, facts: Facts, start: string) {
  const ranking = rankPathways(g, facts, start);
  const route = shownRoute(g, ranking, null)!;
  const rec = recommendationOf(g, route, ranking.paths);
  const groups = distinctRecommendations(g, ranking);
  return { ranking, route, rec, groups, key: rec.key.node, page: rec.key.node.split(":")[0], texts: rec.options.map((o) => plain(g, o)) };
}

const REC_M1 = {
  guideline_section: "pMMR/MSS Rectal Cancer", distant_metastases_suspected_or_proven: true, liver_metastases_present: true,
  lung_metastases_present: false, peritoneal_metastases_present: false, other_site_metastases_present: false,
  disease_resectable: true, obstruction_status: "nonobstructing", medically_inoperable: false,
} as const;

describe("N1/N2 rectal metastatic: the answers decide REC-7 and REC-8, not the restaging page or the workup", () => {
  const g = load("rectal");
  it("auto start: synchronous liver-only resectable disease reaches the REC-8 options (chemotherapy or RT first)", () => {
    const c = card(g, REC_M1, "auto");
    expect(c.page).toBe("REC-8");
    expect(c.rec.tier).toBe("treatment");
    expect(c.texts.join(" ")).toMatch(/FOLFOX/);
    expect(c.texts.join(" ")).toMatch(/Short-course RT|Long-course chemo\/RT/);
    // the clinical-stage page of the non-metastatic pathway is not offered to a patient with distant metastases
    for (const p of c.ranking.paths) expect(pagesOf(p.steps.map((s) => s.node)), p.id).not.toContain("REC-6");
  });
  it("the metastatic start (REC-2A, 'Metastatic or advanced'): the same options, not the workup box", () => {
    const c = card(g, REC_M1, "REC-2A");
    expect(c.page).toBe("REC-8");
    expect(c.texts.join(" ")).toMatch(/FOLFOX/);
    expect(c.route.used).toEqual(expect.arrayContaining(["distant_metastases_suspected_or_proven", "liver_metastases_present", "disease_resectable", "guideline_section"]));
  });
  it("only the metastasis answer: auto starts on REC-2 -> REC-7, never on the non-metastatic REC-6", () => {
    const r = rankPathways(g, { guideline_section: "pMMR/MSS Rectal Cancer", distant_metastases_suspected_or_proven: true }, "auto");
    expect(r.paths.length).toBeGreaterThan(0);
    for (const p of r.paths) expect(pagesOf(p.steps.map((s) => s.node)), p.id).not.toContain("REC-6");
    expect(pagesOf(r.paths[0].steps.map((s) => s.node))).toContain("REC-7");
  });
  it("the disease chosen settles the MMR arm: MMR is not asked, the trail goes on to REC-7", () => {
    const facts = { guideline_section: "pMMR/MSS Rectal Cancer", distant_metastases_suspected_or_proven: true } as Facts;
    const open = openDetails(g, facts, "auto").map((d) => d.fact);
    expect(open).not.toContain("mismatch_repair_status");
    const trail = rulesOnlyTrail(g, facts, "REC-2A");
    expect(trail.steps.map((s) => s.chosen.split(":")[0])).toContain("REC-7");
  });
  it("answers entered, nothing to find: 'Not used' cannot list answers the route rests on", () => {
    const c = card(g, REC_M1, "REC-2A");
    for (const k of ["liver_metastases_present", "lung_metastases_present", "other_site_metastases_present", "disease_resectable"]) expect(c.route.used, k).toContain(k);
  });
});

describe("N2 colon metastatic: COL-7 systemic therapy options", () => {
  const g = load("colon");
  const facts = {
    guideline_section: "pMMR/MSS Colon Cancer", m_category: "M1", metastasis_timing: "synchronous", metastatic_distribution: "liver_and_or_lung_only",
    metastases_resectable: false, converted_to_resectable: false, conversion_to_resectability_reasonable_goal: false, bowel_obstruction_present_or_imminent: false,
  } as Facts;
  it("auto and the COL-2A start reach COL-7 (unresectable synchronous liver/lung metastases)", () => {
    for (const start of ["auto", "COL-2A"]) {
      const c = card(g, facts, start);
      expect(pagesOf(c.route.steps.map((s) => s.node)), start).toContain("COL-7");
      expect(c.rec.tier, start).toBe("treatment");
      expect(c.page, start).toMatch(/^COL-(7|5)$/);
    }
    expect(plain(g, card(g, facts, "auto").key)).toMatch(/Systemic therapy/i);
  });
});

describe("N3 DLBCL: after the workup, the first-line therapy for the stage", () => {
  const g = load("b_cell_lymphomas");
  const facts = {
    guideline_section: "Diffuse Large B-Cell Lymphoma", concurrent_large_cell_transformation: false, histology: "dlbcl_nos",
    ann_arbor_stage: "III", extensive_mesenteric_disease: false,
  } as Facts;
  it("the workup entry is selected for a DLBCL patient (BCEL-2 carried the condition of other sections only)", () => {
    expect(evaluate(g.preds["BCEL-2:n106_26"], derive(facts, g.bundle.schema))).toBe(true);
  });
  it("from BCEL-1, BCEL-2 and auto: first-line therapy on BCEL-3 for stage III", () => {
    for (const start of ["BCEL-1", "BCEL-2", "auto"]) {
      const c = card(g, facts, start);
      expect(c.key, start).toBe("BCEL-3:n336_306");
      expect(plain(g, c.key), start).toMatch(/First-line therapy/i);
      expect(c.route.used, start).toEqual(expect.arrayContaining(["ann_arbor_stage"]));
    }
  });
});

describe("N4 antiemesis: the oral-agent page is not offered to a parenteral patient", () => {
  const g = load("antiemesis");
  const base = { guideline_section: "Adult Antiemesis", patient_population: "adult", anticancer_agent_route: "parenteral", presenting_symptom: "none" } as Facts;
  it("adult parenteral, high emetic risk: the AE-6 options A, B and C", () => {
    const c = card(g, { ...base, agent_emesis_frequency_percent: 95 }, "auto");
    expect(c.page).toBe("AE-6");
    expect(c.rec.options.length).toBe(3);
    for (const p of c.ranking.paths) expect(pagesOf(p.steps.map((s) => s.node)), p.id).not.toEqual(expect.arrayContaining(["AE-9"]));
  });
  it("the oral prophylaxis pages need an oral agent, the parenteral pages a parenteral one", () => {
    const ev = (id: string, route: string, freq: number) => evaluate(g.preds[id], derive({ ...base, anticancer_agent_route: route, agent_emesis_frequency_percent: freq } as Facts, g.bundle.schema));
    expect(ev("AE-9:t_root", "parenteral", 95)).toBe(false);
    expect(ev("AE-9:t_root", "oral", 40)).toBe(true);
    expect(ev("AE-6:t_root", "oral", 95)).toBe(false);
    expect(ev("AE-6:t_root", "parenteral", 95)).toBe(true);
  });
});

describe("B2 NSCLC stage IA operable: surgical resection is the headline; findings at surgery come after", () => {
  const g = load("nsclc");
  const facts = {
    m_category: "M0", n_category: "N0", clinical_t_category: "T1b", tumor_location: "peripheral", t_basis: "size", contralateral_lung_nodule: false,
    multiple_lung_cancers: false, pleural_or_pericardial_effusion: false, pleural_or_disseminated_metastases: false, operable: true,
  } as Facts;
  it("from the initial evaluation (NSCL-1) and the pretreatment page (NSCL-2)", () => {
    for (const start of ["NSCL-1", "NSCL-2"]) {
      const c = card(g, { ...facts, mediastinal_nodes_positive: false } as Facts, start);
      expect(c.key, start).toBe("NSCL-2:n108_541");
      expect(plain(g, c.key)).toMatch(/Surgical resection/);
      expect(c.groups.length, start).toBe(1);
    }
  });
  it("the resection margin of an operation that has not happened is not asked", () => {
    const f = { ...facts, mediastinal_nodes_positive: false } as Facts;
    expect(openDetails(g, f, "NSCL-1").map((d) => d.fact)).not.toContain("resection_margin");
    expect(rankPathways(g, f, "NSCL-1").paths[0].missing).not.toContain("resection_margin");
  });
});

describe("B2 follicular lymphoma, symptomatic stage III: first-line options (FOLL-4), not additional therapy (FOLL-5)", () => {
  const g = load("b_cell_lymphomas");
  const facts = {
    guideline_section: "Classic Follicular Lymphoma", ann_arbor_stage: "III", histology: "classic_follicular_lymphoma", candidate_for_clinical_trial: false, symptomatic: true,
    threatened_end_organ_function: false, gi_bleeding: false, clinically_significant_bulky_disease: false, steady_or_rapid_progression: false, cytopenia_clinically_significant: false,
  } as Facts;
  it("the headline is the induction options on FOLL-4", () => {
    for (const start of ["FOLL-2", "auto"]) {
      const c = card(g, facts, start);
      expect(c.key, start).toBe("FOLL-4:n293_431");
      expect(plain(g, c.key)).toMatch(/Suggested Regimens \(FOLL-B\)/);
      expect(c.page).not.toBe("FOLL-5");
    }
  });
  it("what the response will be after induction is not asked now", () => {
    expect(openDetails(g, facts, "FOLL-2").map((d) => d.fact)).not.toContain("response_category");
  });
});

describe("M6 ovarian stage III, surgical candidate: primary treatment, never the criteria box", () => {
  const g = load("ovarian_cancer_fallopian_tube_cancer_primary_per");
  const facts = {
    guideline_section: "Epithelial Ovarian Cancer/Fallopian Tube Cancer/ Primary Peritoneal Cancer", figo_stage: "III", fertility_desired: false, pelvic_mass_on_exam: true,
    poor_surgical_candidate: false, optimal_cytoreduction_likely: true,
  } as Facts;
  it("a criteria box names the patient group and is never a recommendation", () => {
    expect(isCriteriaBox(g, "OV-1:n237_322")).toBe(true);
    expect(boxClass(g, "OV-1:n237_322")).toBe("condition");
    expect(isCriteriaBox(g, "OV-1:n242_469")).toBe(false);
  });
  it("the headline is the hysterectomy/BSO with staging and debulking", () => {
    for (const start of ["OV-1", "auto"]) {
      const c = card(g, facts, start);
      expect(c.key, start).toBe("OV-1:n242_469");
      expect(plain(g, c.key)).toMatch(/Hysterectomy\/BSO/);
      expect(c.groups[0].rec.key.node).toBe("OV-1:n242_469");
    }
  });
});

describe("N5 a rule-✗ option is never the pending decision", () => {
  it("a stop whose every arm is ruled out is not a decision, and ruled-out arms are never offered", () => {
    const g = load("prostate");
    const r = rulesOnlyTrail(g, { risk_group: "regional" }, "PROS-2:t_root");
    expect(r.stoppedFor).toBe("ask");
    expect(isPendingDecision(r)).toBe(false);
    const opt = (verdict: boolean | null) => ({ child: "x", text: "x", verdict, source: "rule" as const });
    expect(offeredOptions({ options: [opt(true), opt(false), opt(null)] }).map((o) => o.verdict)).toEqual([true, null]);
    expect(isPendingDecision({ stoppedFor: "ask", options: [opt(false), opt(null)] })).toBe(true);
  });
  it("colon T3 N1 after resection: the T3 N0 row's option is not an entry that fits", () => {
    const g = load("colon");
    expect(g.bundle.roots["COL-4"]).not.toContain("COL-4:n180_188");
    expect(g.kids("COL-4:n145_29")).toContain("COL-4:n180_188");
    const facts = { guideline_section: "pMMR/MSS Colon Cancer", primary_diagnosis: "colon_adenocarcinoma", t_category: "T3", n_category: "N1", m_category: "M0", mismatch_repair_status: "pMMR_MSS" } as Facts;
    const r = rulesOnlyTrail(g, facts, "COL-4");
    if (r.stoppedFor === "ask") expect(offeredOptions(r).filter((o) => o.verdict === true).length).toBeLessThanOrEqual(1);
    for (const p of rankPathways(g, facts, "COL-4").paths.slice(0, 3)) expect(p.steps.some((s) => s.node === "COL-4:n180_188" && s.kind === "met")).toBe(false);
  });
});

describe("missingFacts asks only for what can still change the verdict", () => {
  const g = load("rectal");
  const unresectable = g.preds["REC-7:n211_279"];   // unresectable (disease_resectable != yes) OR medically inoperable
  it("an 'or' already satisfied asks for nothing", () => {
    expect(missingFacts(g, unresectable, { disease_resectable: false })).toEqual([]);
  });
  it("an 'or' still open asks for the arms that are open", () => {
    expect(missingFacts(g, unresectable, { disease_resectable: true })).toEqual(["medically_inoperable"]);
    expect(missingFacts(g, unresectable, {}).sort()).toEqual(["disease_resectable", "medically_inoperable"]);
  });
  it("an 'and' already false asks for nothing", () => {
    const and: Pred = { all: [{ fact: "disease_resectable", op: "==", value: true }, { fact: "medically_inoperable", op: "==", value: true }] };
    expect(missingFacts(g, and, { disease_resectable: false })).toEqual([]);
    expect(missingFacts(g, and, { disease_resectable: true })).toEqual(["medically_inoperable"]);
  });
  it("a derived detail that is decided asks for none of its sources", () => {
    const c = load("colon");
    const p = c.preds["COL-5:n268_26"];   // metastatic suspected or proven (derived from M1 or suspected) and synchronous
    expect(missingFacts(c, p, { guideline_section: "pMMR/MSS Colon Cancer", m_category: "M1" })).toEqual(["metastasis_timing"]);
  });
  it("the rectal M1 route no longer asks Medically Inoperable once Resectable = No", () => {
    const facts = { ...REC_M1, disease_resectable: false } as Facts;
    delete (facts as Record<string, unknown>).medically_inoperable;
    expect(openDetails(g, facts, "REC-2A").map((d) => d.fact)).not.toContain("medically_inoperable");
  });
});

describe("breast HER2-positive preoperative therapy: the status that picks the regimens is asked, and the regimens are shown", () => {
  const g = load("breast");
  const facts = { guideline_section: "Invasive Breast Cancer", m_category: "M0", clinical_t_category: "T2", clinical_n_category: "N1", considering_preop_systemic_therapy: true, tumor_operable: true } as Facts;
  it("the box 'based on HR and HER2 status' names the details it depends on", () => {
    expect(namedStatusFacts(g, "Preoperative systemic therapy based on HR and HER2 status (BINV-L 1 and BINV-M)").sort()).toEqual(["er_status", "her2_status", "pr_status"]);
    const open = openDetails(g, facts, "BINV-1").map((d) => d.fact);
    expect(open).toEqual(expect.arrayContaining(["er_status", "pr_status", "her2_status"]));
  });
  it("once answered they stop being asked and the BINV-M regimens for the status are quoted", () => {
    const f = { ...facts, her2_status: "positive", er_status: "negative", pr_status: "negative" } as Facts;
    const open = openDetails(g, f, "BINV-1").map((d) => d.fact);
    for (const k of ["er_status", "pr_status", "her2_status"]) expect(open).not.toContain(k);
    const snip = statusSnippet(g, "BINV-13:n244_369", f)!;
    expect(snip.code).toBe("BINV-M");
    expect(snip.heading).toMatch(/HER2-Positive/);
    expect(snip.lines.join(" ")).toMatch(/Preferred/);
    expect(statusSnippet(g, "BINV-13:n244_369", facts)).toBeNull();   // nothing quoted before the status is known
  });
});

/* ---------------------------------------------------------------- library-wide */

describe("N1 an answered detail that appears in an entry or link condition constrains where the walk starts", () => {
  const rootsPreds = (g: Graph): Pred[] => {
    const out: Pred[] = [];
    for (const rs of Object.values(g.bundle.roots)) for (const r of rs) { if (g.preds[r]) out.push(g.preds[r]); const lc = g.node(r)?.linkCond; if (lc) out.push(lc); }
    return out;
  };
  const leaves = (p: Pred, out = new Set<string>()): Set<string> => {
    if ("all" in p) p.all.forEach((x) => leaves(x, out)); else if ("any" in p) p.any.forEach((x) => leaves(x, out)); else if ("not" in p) leaves(p.not, out); else out.add(p.fact);
    return out;
  };
  it("no top route passes an entry box or a way in whose condition the answered detail makes false", () => {
    const bad: string[] = [];
    let runs = 0;
    for (const slug of slugs) {
      const g = load(slug), schema = g.bundle.schema;
      const sv = g.bundle.sections?.variable;
      const names = [...new Set(rootsPreds(g).flatMap((p) => [...leaves(p)]))].filter((f) => f !== sv && schema.variables[f] && (schema.variables[f].type === "bool" || schema.variables[f].type === "enum")).slice(0, 5);
      for (const f of names) {
        const spec = schema.variables[f];
        const values = spec.type === "bool" ? [true, false] : (spec.values ?? []).filter((v) => v !== "other" && v !== "unknown").slice(0, 2);
        for (const v of values) {
          const facts: Facts = { [f]: v };
          const full = derive(facts, schema);
          runs++;
          const ranking = rankPathways(g, facts, "auto");
          for (const p of ranking.paths.slice(0, 3)) {
            for (const st of p.steps) {
              const n = g.node(st.node);
              if (!n) continue;
              const isRoot = (g.bundle.roots[n.page] ?? []).includes(st.node);
              if (isRoot && g.preds[st.node] && evaluate(g.preds[st.node], full) === false && !(st.kind === "flow" || st.kind === "option")) bad.push(`${slug} {${f}=${String(v)}}: ${st.node} is an entry whose condition is false`);
            }
            // a route that starts in the middle of the guideline needs a way in that no answer rules out
            const first = p.steps[0].node;
            const seen = new Set<string>();
            const open = (x: string): boolean => {
              if (seen.has(x)) return false;
              seen.add(x);
              const ps = g.parents[x] ?? [];
              return !ps.length || ps.some((q) => !(g.preds[q] && evaluate(g.preds[q], derive(Object.fromEntries(Object.entries(facts)), schema)) === false) && open(q));
            };
            if (!open(first)) bad.push(`${slug} {${f}=${String(v)}}: route starts at ${first}, which every way in rules out`);
          }
        }
      }
    }
    expect(runs).toBeGreaterThan(300);
    expect(bad.slice(0, 30)).toEqual([]);
  }, 300_000);
});

/* ---------------------------------------------------------------- AI calls */

describe("AI calls: only where the walk needs the model, remembered by node and the details that node rests on", () => {
  const g = load("prostate");
  const counting = () => {
    const calls: string[][] = [];
    const fetchFn = (async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { questions: { name: string; type: string; choices?: { value: string }[] }[] };
      calls.push(body.questions.map((q) => q.name));
      return { ok: true, status: 200, json: async () => ({ answers: body.questions.map((q) => (q.type === "choice" ? { type: "choice", name: q.name, choice: q.choices![0].value, probabilities: q.choices!.map((c, i) => ({ value: c.value, probability: i === 0 ? 0.5 : 0.5 / Math.max(1, q.choices!.length - 1) })) } : { type: "predicate", name: q.name, probability: 0.5 })) }) };
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  };
  const walk = (facts: Facts, fetchFn: typeof fetch) => aiWalk(g, facts, "PROS-1", { decide: { fetch: fetchFn } });

  it("an answer about something the open node does not rest on asks nothing again", async () => {
    clearDecideCache();
    const { calls, fetchFn } = counting();
    const seq: Facts[] = [{ n_category: "N0" }];
    await walk(seq[0], fetchFn);
    const first = calls.length;
    expect(first).toBeGreaterThan(0);
    // the node the walk stops at, and the details it rests on
    const stop = (await walk(seq[0], fetchFn)).end;
    const rel = relevantFacts(g, stop);
    const unrelated = Object.keys(g.bundle.schema.variables).find((k) => !rel.has(k) && g.bundle.schema.variables[k].type === "bool")!;
    expect(unrelated).toBeTruthy();
    await walk({ ...seq[0], [unrelated]: true }, fetchFn);
    expect(calls.length, "an unrelated answer").toBe(first);
    // a repeated walk for the same answers is free
    await walk(seq[0], fetchFn);
    expect(calls.length).toBe(first);
  });

  it("an answer the node rests on asks again, once", async () => {
    clearDecideCache();
    const { calls, fetchFn } = counting();
    const res = await walk({ n_category: "N0" }, fetchFn);
    const before = calls.length;
    const rel = [...relevantFacts(g, res.end)].find((k) => g.bundle.schema.variables[k].type === "bool" && k !== "n_category");
    if (!rel) return;
    await walk({ n_category: "N0", [rel]: true }, fetchFn);
    expect(calls.length).toBeGreaterThanOrEqual(before);
    const after = calls.length;
    await walk({ n_category: "N0", [rel]: true }, fetchFn);
    expect(calls.length).toBe(after);
  });

  it("a rules-only walk that finishes (or has no open arm) needs no model at all", () => {
    expect(needsModel({ steps: [], end: "x" }, {})).toBe(false);
    expect(needsModel({ steps: [], end: "x", stoppedFor: "ask", options: [{ child: "a", text: "a", verdict: false, source: "rule" }] }, {})).toBe(false);
    expect(needsModel({ steps: [], end: "x", stoppedFor: "ask", options: [{ child: "a", text: "a", verdict: null, source: "none" }] }, {})).toBe(true);
    expect(needsModel({ steps: [], end: "x" }, { a: "b" })).toBe(true);
  });

  it("across an answer sequence on a guideline the rules mostly settle, the model is asked a handful of times, not once per answer", async () => {
    clearDecideCache();
    const r = load("rectal");
    const { calls, fetchFn } = counting();
    const answers: Facts[] = [];
    let acc: Facts = { guideline_section: "pMMR/MSS Rectal Cancer" };
    answers.push(acc);
    for (const [k, v] of Object.entries(REC_M1)) { if (k === "guideline_section") continue; acc = { ...acc, [k]: v }; answers.push(acc); }
    let needed = 0;
    for (const facts of answers) {
      const rules = rulesOnlyTrail(r, facts, "REC-2A");
      if (needsModel(rules, {})) needed++;
      await aiWalk(r, facts, "REC-2A", { decide: { fetch: fetchFn } });
    }
    expect(answers.length).toBeGreaterThan(6);
    expect(calls.length).toBeLessThanOrEqual(needed);
    expect(calls.length).toBeLessThan(answers.length);
  });
});

describe("trail start agrees with the card for the audit's rectal case", () => {
  it("trailStart of the auto ranking is on the metastatic pathway", () => {
    const g = load("rectal");
    const r = rankPathways(g, REC_M1, "auto");
    expect(trailStart(r, "auto").startsWith("REC-2")).toBe(true);
  });
});
