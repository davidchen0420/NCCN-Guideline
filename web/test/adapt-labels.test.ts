/**
 * Every value a clinician can be shown (schema enum values, derived values, the values in box conditions,
 * section names) has a readable label: no underscores, acronyms kept ("dMMR/MSI-H", not "dMMR_MSI_H").
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { label, valueLabel } from "../src/lib/factMeta";
import { humanizeValue } from "../src/lib/terms";

const slugs = readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`)).sort();

function leafValues(p: unknown, out: Set<string>) {
  if (!p || typeof p !== "object") return;
  const o = p as Record<string, unknown>;
  for (const k of ["all", "any"]) if (Array.isArray(o[k])) (o[k] as unknown[]).forEach((x) => leafValues(x, out));
  if (o.not) leafValues(o.not, out);
  if ("fact" in o && "value" in o) for (const v of Array.isArray(o.value) ? o.value : [o.value]) if (typeof v === "string") out.add(v);
}

describe("clinician-readable value labels", () => {
  it("spells the audited examples", () => {
    expect(valueLabel("pMMR_MSS")).toBe("pMMR/MSS");
    expect(valueLabel("dMMR_MSI_H")).toBe("dMMR/MSI-H");
    expect(valueLabel("POLE_POLD1_ultra_hypermutated")).toBe("POLE/POLD1 ultra-hypermutated");
    expect(valueLabel("B_or_T_lymphoblastic_leukemia_lymphoma")).toBe("B- or T-lymphoblastic leukemia/lymphoma");
    expect(valueLabel("uncommon_S768I_L861Q_G719X")).toBe("Uncommon (S768I, L861Q, G719X)");
  });
  it("humanises an unlisted underscored value with its acronyms intact", () => {
    expect(humanizeValue("BRCA1_or_2_carrier")).toBe("BRCA1 or 2 carrier");
    expect(humanizeValue("HER2_low")).toBe("HER2 low");
    expect(humanizeValue("ER_PR_positive")).toBe("ER/PR positive");
    expect(humanizeValue("MSI_H")).toBe("MSI-H");
  });
  it("no label of any enum, derived, condition or section value, or variable name, contains an underscore", () => {
    const bad: string[] = [];
    let n = 0;
    for (const slug of slugs) {
      const f = JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"));
      const vals = new Set<string>();
      for (const [name, spec] of Object.entries<{ values?: string[] }>(f.schema.variables)) {
        for (const v of spec.values ?? []) vals.add(v);
        if (/_/.test(label(name))) bad.push(`${slug} variable ${name} -> ${label(name)}`);
      }
      for (const d of Object.values<{ rules: { if: unknown; then: unknown }[]; else?: unknown }>(f.schema.derived ?? {})) {
        for (const r of d.rules) { if (typeof r.then === "string") vals.add(r.then); leafValues(r.if, vals); }
        if (typeof d.else === "string") vals.add(d.else);
      }
      for (const nd of f.nodes) for (const k of ["predicate", "received_predicate", "link_condition"]) leafValues(nd[k], vals);
      for (const v of f.sections?.values ?? []) vals.add(v);
      for (const v of vals) {
        n++;
        const l = valueLabel(v);
        if (/_/.test(l) || !l.trim()) bad.push(`${slug} ${v} -> ${l}`);
      }
    }
    expect(n).toBeGreaterThan(3000);
    expect(bad.slice(0, 20), `${bad.length} labels with an underscore`).toEqual([]);
  }, 120_000);
});
