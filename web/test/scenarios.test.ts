/**
 * Regression tests from a scripted clinician audit: in three of four realistic cases the top
 * route was clinically wrong or ignored the clinician's input while labelled "Best match".
 * Each block loads the real encoded guideline and states what a clinician would expect.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Bundle } from "../src/types";
import { adaptGuideline, stripMarks } from "../src/lib/adapt";
import { buildGraph } from "../src/lib/graph";
import { boxClass, distinctRecommendations, isActionBox, isRecommendationEnd, PAGE_REF, rankPathways, recommendationOf, shownRoute, stepTier, type Pathway } from "../src/lib/pathways";
import { extractFacts, applyFound } from "../src/lib/extract";
import { decidingFacts, previewAnswer, remainingQuestions, whyNothingFits } from "../src/lib/formAssist";
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

/* ---------------- rectal cancer: a route must reach a treatment, or say honestly why not ---------------- */

const texts = (g: ReturnType<typeof load>, p: Pathway) => p.steps.map((s) => g.node(s.node)?.text ?? "");
const anyText = (g: ReturnType<typeof load>, ps: Pathway[], re: RegExp) => ps.some((p) => texts(g, p).some((t) => re.test(t)));
const REC_PMMR = {
  guideline_section: "pMMR/MSS Rectal Cancer", clinical_t_category: "T3", clinical_n_category: "N1",
  mismatch_repair_status: "pMMR_MSS", distant_metastases_suspected_or_proven: false, disease_resectable: true,
};

describe("8. rectal cancer, new diagnosis, pMMR cT3 N1 M0", () => {
  const g = load("rectal");

  it("the pMMR treatment table of REC-6 is connected to its root", () => {
    expect(g.bundle.roots["REC-6"]).toContain("REC-6:t_root");
    expect(g.kids("REC-6:t_root").length).toBeGreaterThan(0);
    expect(g.kids("REC-6:t0_0_0")).toContain("REC-6:t0_0_1");
    // headings are not steps: the table title passes through
    expect(g.kids("REC-6:t_root")).toEqual(expect.arrayContaining(["REC-6:t0_0_0", "REC-6:t1_0_0"]));
    expect(g.bundle.children["REC-6:t0"]).toBeUndefined();
  });

  it("from REC-2 the route follows the page reference into REC-3 and decides the stage there", () => {
    const top = rankPathways(g, REC_PMMR, "REC-2").paths[0];
    const steps = top.steps.map((s) => s.node);
    expect(steps).toEqual(expect.arrayContaining(["REC-2:n222_687", "REC-3:n214_25", "REC-3:n336_129"]));
    expect(top.steps.find((s) => s.node === "REC-3:n336_129")!.kind).toBe("met");   // T3, N any; T1-2, N1-2; ...
    expect(top.used).toEqual(expect.arrayContaining(["clinical_t_category", "clinical_n_category", "distant_metastases_suspected_or_proven"]));
  });

  it("never ends on a bare page reference as a recommendation", () => {
    const top = rankPathways(g, REC_PMMR, "REC-2").paths[0];
    const lastNode = g.node(top.steps[top.steps.length - 1].node)!;
    if (PAGE_REF.test(lastNode.text)) {
      expect(isRecommendationEnd(top)).toBe(false);
      // REC-3A carries no boxes in the data yet: the route says where it continues
      expect(top.end).toBe("continues");
      expect(top.continuesTo).toBe("REC-3A");
    } else {
      expect(pages(top)).toContain("REC-6");   // the bridge is extracted
    }
  });

  it("from REC-2 the top route reaches the REC-6 treatment options", () => {
    const ps = rankPathways(g, REC_PMMR, "REC-2").paths.slice(0, 6);
    expect(ps.some((p) => pages(p).includes("REC-6"))).toBe(true);
    expect(anyText(g, ps, /Long-course chemo\/RT/)).toBe(true);
  });

  it("from auto the top routes reach the REC-6 treatment options", () => {
    const ps = rankPathways(g, REC_PMMR, "auto").paths.slice(0, 6);
    expect(ps.length).toBeGreaterThan(0);
    expect(ps.some((p) => pages(p).includes("REC-6"))).toBe(true);
    expect(anyText(g, ps, /Long-course chemo\/RT/)).toBe(true);
    expect(anyText(g, ps, /Chemotherapy \(12–16 wk\)/)).toBe(true);
    for (const p of ps) {
      const l = g.node(p.steps[p.steps.length - 1].node)!;
      expect(l.text, p.id).not.toMatch(/^CLINICAL STAGE/);
      if (isRecommendationEnd(p)) expect(boxClass(g, l.full), p.id).not.toBe("heading");
    }
  });

  it("dMMR reaches the REC-14 immunotherapy options", () => {
    const facts = { ...REC_PMMR, guideline_section: "dMMR/MSI-H Rectal Cancer", mismatch_repair_status: "dMMR_MSI_H" };
    const ps = rankPathways(g, facts, "auto").paths.slice(0, 4);
    expect(ps.some((p) => pages(p).includes("REC-14"))).toBe(true);
    expect(anyText(g, ps, /Checkpoint inhibitor immunotherapy/)).toBe(true);
    expect(anyText(g, ps, /Long-course chemo\/RT/)).toBe(true);
  });

  it("synchronous liver-only resectable metastases from REC-7 reach the REC-8 options", () => {
    const facts = { guideline_section: "pMMR/MSS Rectal Cancer", distant_metastases_suspected_or_proven: true, liver_metastases_present: true, lung_metastases_present: false, peritoneal_metastases_present: false, other_site_metastases_present: false, disease_resectable: true };
    const ps = rankPathways(g, facts, "REC-7").paths.slice(0, 3);
    expect(pages(ps[0])).toContain("REC-8");
    expect(anyText(g, ps, /^Chemotherapy \(preferred\)/)).toBe(true);
    expect(anyText(g, ps, /Short-course RT or Long-course chemo\/RT/)).toBe(true);
  });

  it("a recurrence with resectable metachronous metastases reaches the REC-12 options", () => {
    const facts = { ...REC_PMMR, metachronous_metastases_documented: true, prior_chemotherapy_regimen: "none" };
    const ps = rankPathways(g, facts, "REC-11").paths.slice(0, 3);
    expect(pages(ps[0])).toContain("REC-12");
    expect(anyText(g, ps, /Resection and\/or local therapy/i)).toBe(true);
    expect(anyText(g, ps, /Neoadjuvant chemotherapy/)).toBe(true);
  });

  it("a page reference at the end of REC-11 goes on to the page it names", () => {
    // "pMMR/MSS REC-13" has no arrow in the data: the route continues on REC-13's entry boxes
    const facts = { ...REC_PMMR, metachronous_metastases_documented: true, disease_resectable: false };
    const ps = rankPathways(g, facts, "REC-11").paths.slice(0, 3);
    expect(ps.some((p) => pages(p).includes("REC-13"))).toBe(true);
  });
});

describe("9. when nothing fits", () => {
  const g = load("rectal");
  // REC-7 is the page for suspected or proven distant metastases; the entered details deny them
  const facts = { guideline_section: "pMMR/MSS Rectal Cancer", distant_metastases_suspected_or_proven: false };

  it("no route is left, and no further question is asked", () => {
    const r = rankPathways(g, facts, "REC-7");
    expect(r.paths).toEqual([]);
    expect(decidingFacts(g, r, facts)).toEqual([]);
    expect(remainingQuestions(g, r, facts)).toEqual([]);
  });

  it("names the entry box that the details make false, and the detail to change", () => {
    const why = whyNothingFits(g, facts, "REC-7")!;
    expect(why).not.toBeNull();
    expect(why.page).toBe("REC-7");
    expect(why.node).toBe("REC-7:n287_24");
    expect(why.text).toMatch(/Suspected or proven metastatic/);
    expect(why.facts).toEqual(["distant_metastases_suspected_or_proven"]);   // the section holds; the M1 setting is what fails
  });

  it("changing that detail brings routes back", () => {
    const why = whyNothingFits(g, facts, "REC-7")!;
    const fixed = { ...facts, [why.facts[0]]: true };
    expect(rankPathways(g, fixed, "REC-7").paths.length).toBeGreaterThan(0);
    expect(whyNothingFits(g, fixed, "REC-7")).toBeNull();
  });

  it("still asks questions while nothing has been entered", () => {
    expect(decidingFacts(g, rankPathways(g, {}, "auto"), {}).length).toBeGreaterThan(0);
  });
});

describe("10. page references and headings are never presented as the recommendation", () => {
  const plausible: Record<string, Record<string, unknown>> = {
    colon: { guideline_section: "pMMR/MSS Colon Cancer", primary_diagnosis: "colon_adenocarcinoma", t_category: "T3", n_category: "N1", m_category: "M0" },
    prostate: { clinical_t_category: "T1c", n_category: "N0", m_category: "M0", psa_ng_ml: 5, grade_group: "1", life_expectancy_years: 18 },
    nsclc: { histology: "adenocarcinoma", clinical_t_category: "T2a", n_category: "N0", m_category: "M0", thoracic_definitive_therapy_feasible: true },
    breast: { guideline_section: "Invasive Breast Cancer", diagnosis_category: "invasive_breast_cancer", clinical_t_category: "T2", clinical_n_category: "N0", m_category: "M0", er_status: "positive", pr_status: "positive", her2_status: "negative" },
  };
  const HONEST = new Set(["leaf", "later", "open", "continues", "limit"]);

  it.each(Object.keys(plausible))("%s: from every diagnosis start the routes end at a recommendation or say they are open", (slug) => {
    const g = load(slug);
    const starts = [...moments(g).filter((m) => m.phase === "diagnosis").map((m) => m.page), "auto"];
    let routes = 0;
    for (const start of starts) {
      const r = rankPathways(g, plausible[slug], start);
      for (const p of r.paths.slice(0, 5)) {
        routes++;
        const l = g.node(p.steps[p.steps.length - 1].node)!;
        expect(HONEST.has(p.end), `${start} ${p.id}`).toBe(true);
        if (isRecommendationEnd(p)) {
          expect(PAGE_REF.test(l.text), `${slug} ${start}: "${l.text}" ends ${p.end}`).toBe(false);
          expect(["heading", "pageref"], `${slug} ${start}: ${l.full} ends ${p.end}`).not.toContain(boxClass(g, l.full));
        }
        if (p.end === "continues") expect(p.continuesTo).toBeTruthy();
      }
    }
    expect(routes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- the recommendation is the treatment

describe("11. the headline is the treatment, not the follow-up or a side row", () => {
  const text = (g: ReturnType<typeof load>, id: string) => stripMarks(g.node(id)!.text).replace(/\s+/g, " ");
  /** What the first recommendation card shows: the headline box and every option the guideline lists at that step. */
  const top = (g: ReturnType<typeof load>, facts: Record<string, unknown>, start = "auto") => {
    const r = rankPathways(g, facts, start);
    const groups = distinctRecommendations(g, r);
    expect(groups.length, "a recommendation").toBeGreaterThan(0);
    const rec = groups[0].rec;
    return { r, group: groups[0], rec, texts: rec.options.map((o) => text(g, o)), page: rec.key.node.split(":")[0] };
  };

  it("rectal pMMR cT3N1M0: long-course chemoRT or short-course RT, and TNT, on REC-6; aspirin is only alongside", () => {
    const g = load("rectal");
    const facts = { guideline_section: "pMMR/MSS Rectal Cancer", distant_metastases_suspected_or_proven: false, clinical_t_category: "T3", clinical_n_category: "N1", mismatch_repair_status: "pMMR_MSS" };
    const { rec, texts, page, group } = top(g, facts);
    expect(page).toBe("REC-6");
    expect(rec.tier).toBe("treatment");
    expect(rec.options.length).toBeGreaterThanOrEqual(3);
    expect(texts.some((t) => /Long-course chemo\/RT/.test(t) && /Short-course RT/.test(t))).toBe(true);
    expect(texts.some((t) => /^Chemotherapy \(12–16 wk\) • FOLFOX or CAPEOX/.test(t))).toBe(true);   // chemotherapy first, then chemoRT: total neoadjuvant therapy
    expect(rec.alongside.map((a) => text(g, a)).join(" ")).toMatch(/aspirin/i);
    expect(texts.join(" ")).not.toMatch(/aspirin/i);
    expect(rec.then.length).toBeGreaterThan(0);
  });

  it("rectal dMMR cT3: the checkpoint inhibitor is among the options, not buried behind the re-evaluation schedule", () => {
    const g = load("rectal");
    const facts = { guideline_section: "dMMR/MSI-H Rectal Cancer", distant_metastases_suspected_or_proven: false, clinical_t_category: "T3", clinical_n_category: "N1", mismatch_repair_status: "dMMR_MSI_H" };
    const { rec, texts } = top(g, facts);
    expect(texts.some((t) => /checkpoint inhibitor/i.test(t))).toBe(true);
    expect(rec.tier).toBe("treatment");
    expect(texts.join(" ")).not.toMatch(/Re-evaluate disease status/i);
  });

  it("colon pMMR T3 N1 M0 after resection: adjuvant chemotherapy, never the surveillance schedule", () => {
    const g = load("colon");
    const facts = { guideline_section: "pMMR/MSS Colon Cancer", primary_diagnosis: "colon_adenocarcinoma", t_category: "T3", n_category: "N1", m_category: "M0", mismatch_repair_status: "pMMR_MSS" };
    for (const start of ["auto", "COL-4"]) {
      const { rec, texts, page } = top(g, facts, start);
      expect(["COL-4", "COL-10"], start).toContain(page);
      expect(rec.tier, start).toBe("treatment");
      expect(texts.join(" "), start).toMatch(/CAPEOX|FOLFOX|capecitabine|fluorouracil/i);
      expect(texts.join(" "), start).not.toMatch(/History and physical/i);
    }
  });

  it("prostate unfavorable intermediate (cT2b, GG3, PSA 12, LE 12 y): RP and RT + ADT are both shown as options", () => {
    const g = load("prostate");
    const facts = { clinical_t_category: "T2b", grade_group: "3", psa_ng_ml: 12, life_expectancy_years: 12, n_category: "N0", m_category: "M0" };
    const { rec, texts, page } = top(g, facts);
    expect(page).toBe("PROS-5");
    expect(texts.some((t) => /^RP\b/.test(t))).toBe(true);
    expect(texts.some((t) => /RT\+ ?ADT/.test(t))).toBe(true);
    expect(rec.options.length).toBe(2);
  });

  it("the card's route stands for the whole group: the options are one recommendation, not several", () => {
    const g = load("prostate");
    const r = rankPathways(g, { clinical_t_category: "T2b", grade_group: "3", psa_ng_ml: 12, life_expectancy_years: 12, n_category: "N0", m_category: "M0" });
    const groups = distinctRecommendations(g, r);
    expect(groups.length).toBe(1);
    expect(groups[0].routes.length).toBe(2);
    expect(shownRoute(g, r, null)!.id).toBe(groups[0].route.id);
  });
});

describe("12. library-wide: the headline of the top routes", () => {
  const slugs = readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`)).sort();
  /** Deterministic details for every schema variable: the first enum value, true, a middling number. */
  const filled = (g: ReturnType<typeof load>) => {
    const out: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(g.bundle.schema?.variables ?? {})) {
      if (spec.type === "bool") out[k] = true;
      else if (spec.type === "number") out[k] = 10;
      else if (spec.values?.length) out[k] = spec.values[0];
    }
    return out;
  };
  const SETTLED = new Set(["met", "otherwise", "inferred"]);

  it("is never a follow-up box when an earlier treatment box follows the last settled decision, and never a side row beside a table's condition rows", () => {
    let routes = 0, followups = 0, sideRowsAvoided = 0;
    for (const slug of slugs) {
      const g = load(slug);
      const starts = ["auto", ...moments(g).map((m) => m.page).slice(0, 5)];
      for (const facts of [filled(g), {}] as Record<string, unknown>[]) {
        for (const start of new Set(starts)) {
          const r = rankPathways(g, facts as never, start);
          for (const p of r.paths.slice(0, 6)) {
            routes++;
            const rec = recommendationOf(g, p, r.paths);
            const label = `${slug} ${start} ${p.id.slice(-40)}`;
            if (rec.tier === "followup") {
              followups++;
              let settled = -1;
              p.steps.forEach((s, i) => { if (i < rec.index && SETTLED.has(s.kind)) settled = i; });
              for (let j = settled + 1; j < rec.index; j++)
                expect(isActionBox(g, p.steps[j].node) && stepTier(g, p.steps[j].node) === "treatment", `${label}: ${p.steps[j].node} is a treatment ahead of the follow-up headline`).toBe(false);
            }
            // a recommendation row printed beside a treatment table's condition rows is alongside, never a route of its own
            for (const s of p.steps) {
              const parents = g.parents[s.node] ?? [];
              const n = g.node(s.node)!;
              if (n.role === "table_rec" && !n.decision && !g.preds[s.node] && parents.some((q) => g.kids(q).some((k) => g.node(k)?.role === "table_condition"))) {
                expect(false, `${label}: side row ${s.node} is on a route`).toBe(true);
              }
            }
            for (const a of p.alongside) {
              expect(p.steps.some((s) => s.node === a), `${label}: ${a} is both on the route and alongside`).toBe(false);
              sideRowsAvoided++;
            }
            if (rec.options.length > 1) expect(new Set(rec.options).size).toBe(rec.options.length);
            expect(rec.options).toContain(rec.key.node);
          }
        }
      }
    }
    expect(routes).toBeGreaterThan(500);
    expect(sideRowsAvoided).toBeGreaterThan(0);
    console.log("headline library stats", JSON.stringify({ routes, followups, sideRowsAvoided }));
  }, 600_000);
});
