import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { configureLabels, humanName, label, titleCase, valueLabel } from "../src/lib/factMeta";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph } from "../src/lib/graph";

describe("patient-detail labels", () => {
  const schema = { variables: { psa_ng_ml: { type: "number" as const, unit: "ng/ml" }, abnormality_count: { type: "number" as const, unit: "count" } }, derived: {} };
  configureLabels(schema, ["flt3", "ato", "itd"]);
  it("title-cases and capitalises abbreviations", () => {
    expect(humanName("ecog_score")).toBe("ECOG Score");
    expect(humanName("flt3_itd_present")).toBe("FLT3 ITD Present");
    expect(humanName("prior_ato")).toBe("Prior ATO");
    expect(humanName("brca1_2_status")).toBe("BRCA1/2 Status");
    expect(humanName("history_of_lung_cancer")).toBe("History of Lung Cancer");
  });
  it("handles units, comparisons, phrases and mixed-case terms", () => {
    expect(humanName("psa_ng_ml")).toBe("PSA");
    expect(humanName("abnormality_count")).toBe("Abnormality Count");
    expect(humanName("psa_lt_4_dre_normal")).toBe("PSA < 4 DRE Normal");
    expect(humanName("cycle4_pr_and_mets_cr")).toBe("Cycle 4 PR and Mets CR");
    expect(humanName("covid19_vaccine_indicated")).toBe("COVID-19 Vaccine Indicated");
    expect(humanName("hcg_trend")).toBe("hCG Trend");
    expect(humanName("li_fraumeni_syndrome")).toBe("Li-Fraumeni Syndrome");
    expect(humanName("stage_iii_risk")).toBe("Stage III Risk");
    expect(humanName("yp_n_category")).toBe("ypN Category");
  });
  it("title-cases the hand-written labels and enum values", () => {
    expect(label("life_expectancy_years")).toBe("Life Expectancy");
    expect(label("clinical_t_category")).toBe("Clinical T Category");
    expect(valueLabel("radical_prostatectomy")).toBe("Radical Prostatectomy");
    expect(valueLabel("cancer_confirmed")).toBe("Cancer Confirmed");
    expect(titleCase("risk of high-volume disease")).toBe("Risk of High-Volume Disease");
  });
  it("leaves no common abbreviation in lower or title case in any guideline", () => {
    const bad: string[] = [];
    for (const s of readdirSync("../data").filter((x) => existsSync(`../data/${x}/guideline.json`))) {
      const b = adaptGuideline(JSON.parse(readFileSync(`../data/${s}/guideline.json`, "utf8")));
      buildGraph(b);
      for (const n of Object.keys(b.schema.variables)) {
        const l = label(n);
        if (/\b(Ecog|Psa|Ct|Mri|Pet|Hiv|Hpv|Covid|Ldh|Aml|Cll|Egfr|Her2|Brca\d?)\b/.test(l) || /^[a-z]/.test(l) && !/^(hCG|mpMRI|ypN|ypT|yp|yc|eGFR|dMMR|pMMR|irAE|mL|mg|iAMP|qPCR|bZIP|mIU)/.test(l)) bad.push(`${s}:${n} -> ${l}`);
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);
});
