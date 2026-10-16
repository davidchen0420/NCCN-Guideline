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

/** Boxes with nothing after them that point at a page with no entry boxes. What is left are pointers
 * on purpose: "Footnotes on X-nA" / "References on X" notes that name a genuine footnote or reference
 * page (about 40), and the boxes that name a reference or definition page (APL-7 references, GENE-20
 * references, INTCL-3 references, MFSS-5 lymph node classification, PBCL-4 staging, CRIT-8A criteria);
 * reports/misclassified-pages.md says why for each. Lower this when more pages are re-extracted;
 * it must never go up. */
const EMPTY_TARGET_BASELINE = 53;

/** Sections of a multi-disease guideline whose own pages lead into each other (a recurrence box
 * sends the reader back to the first page: OV-6 -> OV-1, INTRA-2 -> INTRA-1, AGT-2 -> AGT-1), so
 * sectionStartPages (web/src/lib/graph.ts: own pages that no other own page leads to) finds no start
 * and rankPathways(auto) falls back to the first page of the guideline, which belongs to another
 * disease. The data is right; the start rule needs a cycle fallback. Take a section out of this list
 * when that is fixed (the test below fails if one of them starts to have its own route). */
const NO_OWN_START_YET = new Set<string>([]);

/** Guidelines whose pages are being re-extracted by other work; they wire their own leaf boxes
 * when that lands (page_spec wire --all). Take a slug out of this list once it is done. */
const WIRING_PENDING = new Set<string>([]);

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

  it("(f) every section of a multi-disease guideline has a route, and one through its own pages", () => {
    const none: string[] = [], notOwn: string[] = [], stale: string[] = [];
    let runs = 0;
    for (const slug of slugs) {
      const g = load(slug), b = g.bundle;
      if (!b.sections) continue;
      for (const v of b.sections.values) {
        runs++;
        const r = rankPathways(g, { [b.sections.variable]: v }, "auto");
        if (!r.paths.length) { none.push(`${slug}: ${v}`); continue; }
        // a section with algorithm pages of its own (pages with entry boxes) must be entered through them
        const ownPages = Object.entries(b.sections.pages ?? {}).filter(([p, s]) => s === v && (b.roots[p] ?? []).length);
        if (!ownPages.length) continue;
        const own = r.paths.some((p) => p.steps.some((s) => (b.sections!.pages?.[s.node.split(":")[0]] ?? null) === v));
        const known = NO_OWN_START_YET.has(`${slug}|${v}`);
        if (!own && !known) notOwn.push(`${slug}: ${v} (own pages ${ownPages.map(([p]) => p).join(", ")}; routes start at ${[...new Set(r.paths.map((p) => p.steps[0].node.split(":")[0]))].join(", ")})`);
        if (own && known) stale.push(`${slug}|${v}`);
      }
    }
    expect(runs).toBeGreaterThan(150);
    expect(none, "section values with no route at all").toEqual([]);
    expect(notOwn, "section values whose routes never enter their own pages").toEqual([]);
    expect(stale, "listed in NO_OWN_START_YET but now fine: take them out").toEqual([]);
  }, 120_000);

  it("(f) every survivorship subtype is a route of its own pages (Fertility, Healthy Lifestyles, Supplement Use, Employment have a principles page as their start)", () => {
    const g = load("survivorship"), b = g.bundle;
    expect(b.sections!.values.length).toBe(17);
    for (const v of b.sections!.values) {
      const r = rankPathways(g, { [b.sections!.variable]: v }, "auto");
      expect(r.paths.length, v).toBeGreaterThan(0);
      expect(r.paths.some((p) => p.steps.some((s) => b.sections!.pages?.[s.node.split(":")[0]] === v)), v).toBe(true);
    }
  });

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
