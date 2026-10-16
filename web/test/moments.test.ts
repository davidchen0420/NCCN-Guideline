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
  }, 60_000);   // loads all 91 guidelines

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

describe("first pages, needs and questions", () => {
  it("finds the first page of a loop (NSCL-11 leads back to NSCL-1) and ignores its inherited entry condition", () => {
    const nsclc = load("nsclc");
    expect(moments(nsclc).filter((m) => m.phase === "diagnosis").map((m) => m.page)).toEqual(expect.arrayContaining(["DIAG-1", "NSCL-1"]));
    expect(nsclc.preds["NSCL-1:n276_24"], "the stage IVA condition of the box that loops back is not a gate on the first page").toBeUndefined();
  });

  it("a title or entry that names two needs serves both; a risk of recurrence is not a recurrence", async () => {
    const { statesOfTitle } = await import("../src/lib/graph");
    expect(statesOfTitle("Stage IV (M1) or Recurrent Disease")).toEqual(["recurrence", "advanced"]);
    expect(statesOfTitle("T3, N0 at high risk for systemic recurrence")).toEqual([]);
    expect(statesOfTitle("Subsequent Treatment after locally advanced disease")).toEqual(["advanced"]);
    const breast = load("breast");
    expect(moments(breast).filter((m) => m.page === "BINV-18").map((m) => m.phase).sort()).toEqual(["advanced", "recurrence"]);
  });

  it("a page where all treatment ends and the schedules begin is the follow-up, whatever its title", () => {
    const colon = load("colon");
    expect(moments(colon).some((m) => m.page === "COL-8" && m.phase === "followup")).toBe(true);
    expect(moments(colon).some((m) => m.page === "COL-4" && m.phase === "diagnosis" && m.post)).toBe(true);
  });

  it("what is only known later is not asked at a first workup", async () => {
    const { askableQuestions, impliedBySection, isLaterStage } = await import("../src/lib/moments");
    const { rankPathways } = await import("../src/lib/pathways");
    const rectal = load("rectal");
    const facts: Record<string, unknown> = { guideline_section: "pMMR/MSS Rectal Cancer", distant_metastases_suspected_or_proven: false, clinical_t_category: "T3", clinical_n_category: "N1", ...impliedBySection(rectal, "pMMR/MSS Rectal Cancer") };
    const q = askableQuestions(rectal, rankPathways(rectal, facts, "REC-2"), facts, "REC-2", (f) => f !== "guideline_section").map((d) => d.fact);
    for (const f of ["mismatch_repair_status", "pathologic_t_category", "pathologic_n_category", "polyp_invasive_cancer", "histologic_grade", "restaging_emvi_present", "clinical_complete_response"])
      expect(q, f).not.toContain(f);
    expect(isLaterStage(rectal, "REC-2", "REC-10")).toBe(true);
    expect(isLaterStage(rectal, "REC-10", "REC-10")).toBe(false);
    expect(isLaterStage(rectal, "auto", "REC-10")).toBe(false);
  });

  it("a workup page with no condition of its own asks what decides where it leads", async () => {
    const { askableQuestions } = await import("../src/lib/moments");
    const { rankPathways } = await import("../src/lib/pathways");
    const hodg = load("hodgkin_lymphoma");
    const q = askableQuestions(hodg, rankPathways(hodg, {}, "HODG-1"), {}, "HODG-1").map((d) => d.fact);
    expect(q.length).toBeGreaterThan(0);
  });

  it("labels: section prefixes and cut-off titles are tidied; raw enum values are not shown", async () => {
    const { sectionLabeller, vlabel } = await import("../src/lib/valueText");
    const { tidyTitle } = await import("../src/lib/moments");
    const lab = sectionLabeller(["Survivorship : Fertility", "Survivorship: Fatigue"]);
    expect(lab("Survivorship : Fertility")).toBe("Fertility");
    expect(sectionLabeller(["Adult Glioma: A", "Meningiomas"])("Adult Glioma: A")).toBe("Adult Glioma: A");
    expect(tidyTitle("Adjuvant Treatment (Up to 6 Mo Perioperative")).toBe("Adjuvant Treatment");
    expect(tidyTitle("Stage Iv or Relapsed Disease")).toBe("Stage IV or Relapsed Disease");
    for (const v of ["pMMR_MSS", "dMMR_MSI_H", "POLE_POLD1_ultra_hypermutated", "B_or_T_lymphoblastic_leukemia_lymphoma"]) expect(vlabel(v), v).not.toContain("_");
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
