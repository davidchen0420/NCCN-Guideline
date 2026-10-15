import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph } from "../src/lib/graph";
import { rankPathways } from "../src/lib/pathways";
import { extractFacts, applyFound } from "../src/lib/extract";
import { contradictions, decidingFacts, plausibility, previewAnswer } from "../src/lib/formAssist";
import type { Schema } from "../src/types";

const load = (slug: string) => {
  const b = adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8")));
  return { b, g: buildGraph(b) };
};
const { b: pros, g: prosG } = load("prostate");

describe("paste the record", () => {
  it("reads the public prostate vignettes without a wrong value", () => {
    const cases = JSON.parse(readFileSync("../data/prostate/vignettes/cases_public.json", "utf8")) as { id: string; text: string }[];
    const examples = JSON.parse(readFileSync("../data/prostate/vignettes/examples.json", "utf8")) as { id: string; age: number; facts: Record<string, unknown> }[];
    let right = 0, wrong: string[] = [];
    for (const ex of examples) {
      const c = cases.find((x) => x.id === ex.id)!;
      for (const f of extractFacts(c.text, pros.schema)) {
        const want = f.fact === "__age" ? ex.age : ex.facts[f.fact];
        if (want === undefined) continue;
        if (JSON.stringify(want) === JSON.stringify(f.value)) right++; else wrong.push(`${ex.id} ${f.fact}=${JSON.stringify(f.value)} want ${JSON.stringify(want)}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(right).toBeGreaterThanOrEqual(22);
  });
  it("handles the usual ways values are written", () => {
    const get = (t: string) => Object.fromEntries(extractFacts(t, pros.schema).map((f) => [f.fact, f.value]));
    expect(get("PSA nadir was 0.4; PSA is now 3.1 ng/mL")).toMatchObject({ psa_ng_ml: 3.1 });
    expect(get("PSA at 8 weeks is 0.3 ng/mL")).toMatchObject({ psa_ng_ml: 0.3 });
    expect(get("Gleason 4+3=7, pT3a pN1")).toMatchObject({ grade_group: "3", n_category: "N1" });
    expect(get("cT2b N0 M1b disease")).toMatchObject({ clinical_t_category: "T2b", n_category: "N0", m_category: "M1" });
    expect(get("PSMA PET shows no distant metastases")).toMatchObject({ psma_pet_positive_metastases: false });
    expect(get("Life expectancy >10 years")).toMatchObject({ life_expectancy_years: { gt: 10 } });
    expect(get("Imaging shows 9 bone metastases")).toMatchObject({ bone_metastases_count: 9 });
    expect(get("BRCA2 mutation detected").brca1_2_mutation).toBeUndefined();   // not "BRCA1/2" as written: left to the user
    const { facts, age } = applyFound({}, extractFacts("72-year-old man, PSA 12", pros.schema));
    expect(age).toBe(72);
    expect(facts).toEqual({ psa_ng_ml: 12 });
  });
  it("works from any guideline's schema", () => {
    const { b } = load("nsclc");
    const ecog = Object.keys(b.schema.variables).find((n) => /ecog/.test(n));
    if (ecog) {
      const f = extractFacts("ECOG PS 1, never smoker", b.schema).find((x) => x.fact === ecog);
      expect(f?.value === 1 || f?.value === "1").toBe(true);
    }
    expect(() => extractFacts("anything at all", { variables: {}, derived: {} } as Schema)).not.toThrow();
  });
});

describe("form assistance", () => {
  it("names the details that decide the first branches, and the box each decides", () => {
    const d = decidingFacts(prosG, rankPathways(prosG, {}), {});
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].node).toMatch(/^PROS-/);
    expect(d[0].text.length).toBeGreaterThan(3);
  });
  it("after some entries, ranks the open details by how much of the fit they hold", () => {
    const facts = { clinical_t_category: "T1c", grade_group: "1", psa_ng_ml: 5 };
    const r = rankPathways(prosG, facts);
    const d = decidingFacts(prosG, r, facts);
    expect(d.every((x) => !(x.fact in facts))).toBe(true);
    expect(d.map((x) => x.share)).toEqual([...d.map((x) => x.share)].sort((a, b) => b - a));
  });
  it("previews where an answer leads", () => {
    const facts = { n_category: "N0" };
    const base = rankPathways(prosG, facts);
    const m0 = previewAnswer(prosG, facts, "m_category", "M0", base);
    const m1 = previewAnswer(prosG, facts, "m_category", "M1", base);
    expect(m0.decides?.text).toMatch(/Clinically localized/);
    expect(m1.decides?.text).toMatch(/Metastatic/);
    // an answer that settles no branch yet says so rather than naming one
    expect(previewAnswer(prosG, {}, "n_category", "N0", rankPathways(prosG, {})).decides).toBeUndefined();
  });
  it("flags implausible numbers", () => {
    const spec = pros.schema.variables.psa_ng_ml;
    expect(plausibility("psa_ng_ml", spec, 8)).toBeNull();
    expect(plausibility("psa_ng_ml", spec, 8200)?.level).toBe("warn");
    expect(plausibility("psa_ng_ml", spec, -1)?.level).toBe("error");
    expect(plausibility("positive_cores_percent", pros.schema.variables.positive_cores_percent, 140)?.level).toBe("error");
  });
  it("finds details that contradict each other", () => {
    const c = contradictions({ m_category: "M0", visceral_metastases_present: true }, pros.schema);
    expect(c[0].message).toMatch(/M0/);
    const s = contradictions({ clinical_t_category: "T1c", grade_group: "1", psa_ng_ml: 5, risk_group: "high" }, pros.schema);
    expect(s.some((x) => /states risk group “High”/.test(x.message))).toBe(true);
    expect(contradictions({ m_category: "M1", visceral_metastases_present: true }, pros.schema)).toEqual([]);
  });
});
