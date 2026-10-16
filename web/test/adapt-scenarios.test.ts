/**
 * Data fixes from the clinician audit (reports of Wave 3), each checked against the PDF page it cites:
 * antiemesis AE-3..AE-8, breast BINV-1, NSCLC NSCL-18..NSCL-21/38, prostate PROS-9, ovarian OV-1.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph } from "../src/lib/graph";
import { rankPathways, type Pathway } from "../src/lib/pathways";

const load = (slug: string) => buildGraph(adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"))));
const pagesOf = (p: Pathway) => [...new Set(p.steps.map((s) => s.node.split(":")[0]))];
const last = (p: Pathway) => p.steps[p.steps.length - 1].node;

describe("B5 antiemesis: the emetic-risk level is decided by the frequency (AE-3 >90% high, >30-90% moderate, AE-4 10-30% low, AE-5 <10% minimal)", () => {
  const g = load("antiemesis");
  const base = { guideline_section: "Adult Antiemesis", patient_population: "adult", anticancer_agent_route: "parenteral" } as const;
  const top = (freq: number) => rankPathways(g, { ...base, agent_emesis_frequency_percent: freq }, "auto").paths[0];

  it("95% -> the high-risk list (AE-3), then the AE-6 regimens A, B and C", () => {
    const r = rankPathways(g, { ...base, agent_emesis_frequency_percent: 95 }, "auto");
    expect(r.paths.length).toBe(3);
    for (const p of r.paths) {
      expect(pagesOf(p)).toEqual(["AE-3", "AE-6"]);
      expect(p.steps.find((s) => s.node === "AE-3:t0_0_0")!.kind).toBe("met");
      expect(p.missing).toEqual([]);
    }
    expect(r.paths.map(last).sort()).toEqual(["AE-6:t0_0_1", "AE-6:t0_1_1", "AE-6:t0_2_1"]);
  });
  it("50% -> moderate (AE-3, then AE-7); exactly 30% is still low (AE-4 prints 10%-30%)", () => {
    expect(pagesOf(top(50))).toEqual(["AE-3", "AE-7"]);
    expect(pagesOf(top(30))).toContain("AE-4");
    expect(top(30).steps.some((s) => s.node === "AE-8:n188_24")).toBe(true);
  });
  it("20% -> low (AE-4, then the AE-8 low-risk prophylaxis); 5% -> minimal (AE-5, then AE-8 'no routine prophylaxis')", () => {
    expect(pagesOf(top(20)).slice(0, 2)).toEqual(["AE-4", "AE-8"]);
    const t = top(5);
    expect(pagesOf(t).slice(0, 2)).toEqual(["AE-5", "AE-8"]);
    expect(t.steps.some((s) => s.node === "AE-8:n304_132")).toBe(true);
  });
  it("no other level's list or regimens are offered for a frequency", () => {
    for (const [freq, other] of [[95, ["AE-4", "AE-5", "AE-7"]], [50, ["AE-4", "AE-5", "AE-6"]], [5, ["AE-3", "AE-4", "AE-6", "AE-7"]]] as const) {
      const r = rankPathways(g, { ...base, agent_emesis_frequency_percent: freq }, "auto");
      for (const p of r.paths.slice(0, 3)) for (const pg of other) expect(pagesOf(p), `${freq}% ${p.id}`).not.toContain(pg);
    }
  });
});

describe("M2 breast BINV-1: the arms after 'Criteria for preoperative systemic therapy (BINV-L)' are the clinician's decision", () => {
  const g = load("breast");
  const facts = { guideline_section: "Invasive Breast Cancer", diagnosis_category: "invasive_breast_cancer", m_category: "M0", clinical_t_category: "T2", clinical_n_category: "N0" } as const;
  it("uses the judgment fact on both arms, and the derived criteria only where the page lists them (BINV-12 entry)", () => {
    expect(g.preds["BINV-1:n310_549"]).toEqual({ fact: "considering_preop_systemic_therapy", op: "==", value: true });
    expect(g.preds["BINV-1:n210_549"]).toEqual({ fact: "considering_preop_systemic_therapy", op: "==", value: false });
    expect(JSON.stringify(g.preds["BINV-12:n168_24"])).toContain("preop_systemic_criteria_met");
    expect(JSON.stringify(g.preds["BINV-2:n278_21"])).not.toContain("preop_systemic_criteria_met");
  });
  it("a cT2 N0 patient is not routed by the cT2+ rule: the route waits at the criteria box for the judgment", () => {
    const p = rankPathways(g, facts, "BINV-1").paths;
    expect(p.length).toBe(1);
    expect(last(p[0])).toBe("BINV-1:n261_461");
  });
  it("'not considering' leads to the locoregional options (BINV-2/3), 'considering' to the BINV-12 workup", () => {
    const no = rankPathways(g, { ...facts, considering_preop_systemic_therapy: false }, "BINV-1").paths;
    expect(no.some((p) => pagesOf(p).includes("BINV-2"))).toBe(true);
    expect(no.every((p) => !pagesOf(p).includes("BINV-12"))).toBe(true);
    const yes = rankPathways(g, { ...facts, considering_preop_systemic_therapy: true }, "BINV-1").paths;
    expect(pagesOf(yes[0])).toContain("BINV-12");
  });
  it("the 'Metastatic (M1)' box no longer carries footnote a's text", () => {
    expect(g.node("BINV-1:n399_23")!.text).toBe("Metastatic (M1) invasive breast cancer");
  });
});

describe("B3 NSCLC (NSCL-18, -20, -21, -38)", () => {
  const g = load("nsclc");
  const negatives = { alk_fusion: false, ros1_fusion: false, braf_v600e: false, kras_g12c: false, ntrk_fusion: false, met_exon14_skipping: false, ret_fusion: false, nrg1_fusion: false, erbb2_mutation: false };
  it("distant recurrence with multiple lesions reaches advanced/metastatic disease (NSCL-19), not 'nothing fits'", () => {
    const facts = { recurrence_pattern: "distant", metastatic_lesion_pattern: "multiple", localized_symptoms: false, diffuse_brain_metastases: false, bone_metastasis: false, pleural_or_disseminated_metastases: false } as const;
    const r = rankPathways(g, facts, "NSCL-18");
    expect(r.paths.length).toBeGreaterThan(0);
    expect(r.paths[0].steps.slice(0, 3).map((s) => s.node)).toEqual(["NSCL-18:n389_24", "NSCL-18:n440_120", "NSCL-18:n447_301"]);
    expect(pagesOf(r.paths[0])).toContain("NSCL-19");
    expect(g.node("NSCL-18:n440_120")!.text).toBe("Pleural metastases or disseminated metastases");
    expect(g.node("NSCL-18:n423_120")!.text).toBe("Limited metastasis");
  });
  it("limited metastasis still leads to NSCL-15", () => {
    const r = rankPathways(g, { recurrence_pattern: "distant", metastatic_lesion_pattern: "limited", localized_symptoms: false, diffuse_brain_metastases: false, bone_metastasis: false }, "NSCL-18");
    expect(pagesOf(r.paths[0])).toContain("NSCL-15");
  });
  it("EGFR exon 19 deletion with the other drivers negative reaches NSCL-21 (osimertinib), not the PD-L1 page, and never asks for Response Status", () => {
    const facts = { histology: "adenocarcinoma", m_category: "M1c", egfr_mutation: "exon19_deletion", pdl1_tps_percent: 20, ...negatives } as const;
    const r = rankPathways(g, facts, "auto");
    expect(r.paths.length).toBeGreaterThan(0);
    for (const p of r.paths) {
      expect(pagesOf(p), p.id).toContain("NSCL-21");
      expect(pagesOf(p), p.id).not.toContain("NSCL-38");
      expect(p.missing, p.id).not.toContain("response_status");
    }
    expect(r.paths.some((p) => p.steps.some((s) => s.node === "NSCL-21:n115_252"))).toBe(true);   // Osimertinib (preferred)
  });
  it("a patient with no driver and PD-L1 >=1% still reaches NSCL-38", () => {
    const r = rankPathways(g, { histology: "adenocarcinoma", m_category: "M1c", egfr_mutation: "negative", pdl1_tps_percent: 20, ...negatives }, "auto");
    expect(pagesOf(r.paths[0])).toContain("NSCL-38");
  });
});

describe("M5 prostate PROS-9: observation is the life expectancy <=5 y arm; EBRT +/- ADT is the arm for >5 y or unknown", () => {
  const g = load("prostate");
  const bcr = { definitive_treatment_received: "radical_prostatectomy", psa_status: "recurrence", current_treatment_phase: "initial_definitive_therapy" } as const;
  const has = (r: ReturnType<typeof rankPathways>, node: string) => r.paths.some((p) => p.steps.some((s) => s.node === node));
  it("life expectancy 3 y: observation only", () => {
    const r = rankPathways(g, { ...bcr, life_expectancy_years: 3 }, "PROS-8");
    expect(r.paths.length).toBe(1);
    expect(last(r.paths[0])).toBe("PROS-9:n444_196");
  });
  it(">10 y: EBRT +/- ADT first and no observation", () => {
    const r = rankPathways(g, { ...bcr, life_expectancy_years: { min: 10, max: null, min_open: true, max_open: false } }, "PROS-8");
    expect(last(r.paths[0])).toBe("PROS-9:n179_481");
    expect(r.paths[0].steps.some((s) => s.node === "PROS-9:n149_348")).toBe(true);
    expect(has(r, "PROS-9:n444_196")).toBe(false);
  });
  it("unknown life expectancy: observation is a possibility that asks for the life expectancy, and EBRT +/- ADT is reachable", () => {
    const r = rankPathways(g, bcr, "PROS-8");
    const obs = r.paths.find((p) => p.steps.some((s) => s.node === "PROS-9:n444_196"))!;
    expect(obs.steps.find((s) => s.node === "PROS-9:n434_100")!.kind).toBe("unknown");
    expect(obs.missing).toContain("life_expectancy_years");
    expect(has(r, "PROS-9:n149_348")).toBe(true);
  });
});

describe("M6 ovarian OV-1: the page heading is not a recommendation", () => {
  const g = load("ovarian_cancer_fallopian_tube_cancer_primary_per");
  it("'Workup, Findings, and Primary Treatment (OV-3)' is a heading that the arrow passes through to OV-3", () => {
    expect(g.node("OV-1:n371_469")!.kind).toBe("header");
    expect(g.kids("OV-1:n371_24")).toContain("OV-3:n151_24");
  });
  it("no route of the section ends on it", () => {
    const sec = "Epithelial Ovarian Cancer/Fallopian Tube Cancer/ Primary Peritoneal Cancer";
    for (const facts of [{ guideline_section: sec, figo_stage: "III", pelvic_mass_on_exam: true, histologic_diagnosis_available: true, referred_after_recent_surgery: false }, { guideline_section: sec, histologic_diagnosis_available: true }]) {
      for (const p of rankPathways(g, facts, "OV-1").paths) expect(last(p), p.id).not.toBe("OV-1:n371_469");
    }
  });
  it("library scan: no all-capitals box in the heading band of an algorithm page, without a condition, is typed as a step, leaf or decision", () => {
    const bad: string[] = [];
    for (const slug of readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`))) {
      const f = JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"));
      const algo = new Set(f.pages.filter((p: { kind: string }) => p.kind === "algorithm").map((p: { id: string }) => p.id));
      for (const n of f.nodes) {
        if (!algo.has(n.page) || /^(page_heading|column_header|table_title|table_root|note)$/.test(n.role) || n.predicate || n.bbox[1] > 104) continue;
        const letters = n.text.replace(/[^A-Za-z]/g, "");
        if (letters.length >= 5 && (letters.match(/[A-Z]/g) ?? []).length / letters.length >= 0.9) bad.push(`${slug} ${n.id} ${n.role}: ${n.text.slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  }, 60_000);
  it("other headings that were typed as boxes are headings now", () => {
    expect(load("anal_carcinoma").node("ANAL-3:n86_24")!.kind).toBe("header");
    expect(load("breast").node("BINV-18:n101_126")!.kind).toBe("header");
    expect(load("breast_screening_and_diagnosis").node("BSCR-5:n86_682")!.kind).toBe("header");
  });
});
