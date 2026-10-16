/**
 * Library-wide integrity of the encoded guidelines as the viewer reads them: tables stay
 * connected to their roots, references to pages with no boxes are counted (the data is being
 * re-extracted; the count may only go down), and no route ends on a page reference or a heading
 * as if it were a recommendation.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph, resolveRef, type Graph } from "../src/lib/graph";
import { moments } from "../src/lib/moments";
import { boxClass, isRecommendationEnd, PAGE_REF, rankPathways } from "../src/lib/pathways";

/** Boxes with nothing after them that point at a page with no entry boxes (an empty algorithm
 * page, or a footnote page that carries a flow). Lower this as the data agent re-extracts those
 * pages; it must never go up. */
const EMPTY_TARGET_BASELINE = 106;

/** Guidelines whose pages are being re-extracted by other work; they wire their own leaf boxes
 * when that lands (page_spec wire --all). Take a slug out of this list once it is done. */
const WIRING_PENDING = new Set([
  "b_cell_lymphomas", "hodgkin_lymphoma", "t_cell_lymphomas", "cutaneous_lymphomas",
  "chronic_lymphocytic_leukemia_small_lymphocytic_l", "pediatric_aggressive_mature_b_cell_lymphomas",
  "pediatric_hodgkin_lymphoma", "castleman_disease", "histiocytic_neoplasms", "survivorship", "in_people_with_hiv",
  "kaposi_sarcoma", "adolescent_and_young_adult_aya_oncology", "palliative_care", "related_fatigue", "smoking_cessation",
  "systemic_mastocytosis", "biliary_tract", "genetic_familial_high_risk_assessment_breast_ova",
  "genetic_familial_high_risk_assessment_colorectal", "ovarian_cancer_fallopian_tube_cancer_primary_per", "prostate",
  "prostate_early_detection", "thyroid_carcinoma",
]);

const slugs = readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`)).sort();
const all = new Map<string, Graph>();
const load = (slug: string) => {
  let g = all.get(slug);
  if (!g) all.set(slug, (g = buildGraph(adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"))))));
  return g;
};

const HEADING = /^(page_heading|column_header|table_title|table_root)$/;

describe("library integrity", () => {
  it("the library has its 91 guidelines", () => {
    expect(slugs.length).toBeGreaterThanOrEqual(91);
  });

  it("(a) every table root reaches its rows", () => {
    const bad: string[] = [];
    for (const slug of slugs) {
      const b = load(slug).bundle;
      const reach = new Set<string>();
      const stack = Object.values(b.roots).flat();
      while (stack.length) {
        const x = stack.pop()!;
        if (reach.has(x)) continue;
        reach.add(x);
        stack.push(...(b.children[x] ?? []));
      }
      for (const [page, fp] of Object.entries(b.pages)) {
        const cells = fp.nodes.filter((n) => n.kind === "box" && /^table_/.test(n.role ?? ""));
        const lost = cells.filter((n) => !reach.has(`${page}:${n.id}`));
        if (lost.length) bad.push(`${slug} ${page}: ${lost.length}/${cells.length} cells unreachable`);
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it("(a) table titles pass through: REC-6 and PROS-18 tables hang off their roots", () => {
    const rec = load("rectal");
    expect(rec.kids("REC-6:t_root")).toEqual(expect.arrayContaining(["REC-6:t0_0_0", "REC-6:t1_0_0"]));
    expect(rec.node("REC-6:t0")?.kind).toBe("header");
    expect(rec.kids("REC-6:t0")).toEqual([]);   // the title itself is not a step
    const pros = load("prostate");
    expect(pros.kids("PROS-18:t_root")).toContain("PROS-18:t1_0_0");
    expect(pros.kids("PROS-18:t1_0_0")).toContain("PROS-18:t1_0_1");
  });

  it("(b) links to pages with no entry boxes do not increase", () => {
    const found: string[] = [];
    for (const slug of slugs) {
      const g = load(slug), b = g.bundle;
      for (const [page, fp] of Object.entries(b.pages)) {
        for (const n of fp.nodes) {
          const full = `${page}:${n.id}`;
          if (n.kind === "header" || (b.children[full] ?? []).length) continue;
          for (const l of n.links) {
            if (l === page) continue;
            const empty = b.pages[l] ? !(b.roots[l] ?? []).length : !["doc", "external"].includes(resolveRef(g, l).type);
            if (empty) found.push(`${slug} ${full} -> ${l}`);
          }
        }
      }
    }
    console.log(`links to pages with no entry boxes: ${found.length} (baseline ${EMPTY_TARGET_BASELINE})`);
    expect(found.length).toBeLessThanOrEqual(EMPTY_TARGET_BASELINE);
  }, 120_000);

  it("(c) from every start page no route ends on a page reference or a heading as a recommendation", () => {
    const bad: string[] = [];
    let runs = 0;
    for (const slug of slugs) {
      const g = load(slug), b = g.bundle;
      const values = b.sections ? b.sections.values : [null];
      for (const m of moments(g)) {
        for (const v of values) {
          const facts = v ? { [b.sections!.variable]: v } : {};
          runs++;
          for (const p of rankPathways(g, facts, m.page).paths) {
            const last = g.node(p.steps[p.steps.length - 1].node);
            const ref = !!last && (PAGE_REF.test(last.text) || HEADING.test(last.role ?? "") || last.kind === "header");
            if (ref && isRecommendationEnd(p)) bad.push(`${slug} from ${m.page}${v ? ` (${v})` : ""}: ${last!.id} "${last!.text.slice(0, 40)}" ends ${p.end}`);
            // the class the engine uses agrees with what the box is
            if (p.end === "leaf") expect(boxClass(g, p.steps[p.steps.length - 1].node), p.id).toBe("recommendation");
            if (p.end === "continues") expect(p.continuesTo, p.id).toBeTruthy();
          }
        }
      }
    }
    expect(runs).toBeGreaterThan(1000);
    expect(bad).toEqual([]);
  }, 120_000);

  it("(d) no leaf box names an algorithm page with entry boxes and stops there (outside the guidelines being re-extracted)", () => {
    const bad: string[] = [];
    for (const slug of slugs) {
      if (WIRING_PENDING.has(slug)) continue;
      const g = load(slug), b = g.bundle;
      for (const [page, fp] of Object.entries(b.pages)) {
        for (const n of fp.nodes) {
          const full = `${page}:${n.id}`;
          // notes ("For X, see BINV-20"), headings and column headers are pointers, not steps
          if (n.kind === "header" || /^(note|page_heading|column_header)$/.test(n.role ?? "") || (b.children[full] ?? []).length) continue;
          for (const l of n.links) if (l !== page && (b.roots[l] ?? []).length) bad.push(`${slug} ${full} -> ${l}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it("(e) with each guideline's example patients, no moment's top route is a bare page reference ending as a recommendation", () => {
    const bad: string[] = [];
    let runs = 0;
    for (const slug of slugs) {
      const g = load(slug), b = g.bundle;
      const file = `../data/${slug}/vignettes/examples.json`;
      const examples = [...(b.examples ?? []), ...(existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { id: string; facts: Record<string, unknown> }[]) : [])];
      const values = b.sections ? b.sections.values : [null];
      for (const m of moments(g)) {
        // the guideline's own example patients; where it has none, a patient who has only chosen the disease
        const patients = examples.length ? examples.map((e) => ({ id: e.id, facts: e.facts })) : values.map((v) => ({ id: String(v), facts: v ? { [b.sections!.variable]: v } : {} }));
        for (const pt of patients) {
          runs++;
          const top = rankPathways(g, pt.facts as never, m.page).paths[0];
          if (!top) continue;
          const last = g.node(top.steps[top.steps.length - 1].node);
          const ref = !!last && (PAGE_REF.test(last.text) || HEADING.test(last.role ?? "") || last.kind === "header");
          if (ref && isRecommendationEnd(top)) bad.push(`${slug} ${m.page} (${pt.id}): ${last!.id} "${last!.text.slice(0, 40)}" ends ${top.end}`);
        }
      }
    }
    expect(runs).toBeGreaterThan(1000);
    expect(bad).toEqual([]);
  }, 120_000);
});
