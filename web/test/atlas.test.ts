import { describe, expect, it } from "vitest";
import { buildModel, displayTitle, layoutGuideline, pointAt, searchIndex, R_RING, type AtlasRaw } from "../src/atlas/model";
import { atlasHash, parseAtlasHash } from "../src/atlas/Atlas";

const page = (id: string, extra: Record<string, unknown> = {}) => ({ id, a: `${id.toUpperCase()} TITLE OF THE PAGE`, n: 6, d: 3, ...extra });
const raw: AtlasRaw = {
  format: "oncocarta-atlas/1",
  sites: [{ id: "gu", label: "Genitourinary" }, { id: "supportive", label: "Supportive Care" }],
  guidelines: [
    { slug: "prostate", title: "Prostate Cancer", category: "Treatment", site: "gu", boxes: 30, encoded: 9, sections: [],
      pages: [page("PROS-1", { e: 1 }), page("PROS-2"), page("PROS-3"), page("PROS-4")], links: [[0, 1], [1, 2], [1, 3], [3, 2]],
      ext: { survivorship: [2] }, aliases: ["PSA"] },
    { slug: "kidney", title: "Kidney Cancer", category: "Treatment", site: "gu", boxes: 10, encoded: 4, sections: ["Clear Cell", "Non-Clear Cell"],
      pages: [page("KID-1", { e: 1, s: 0 }), page("KID-2", { s: 1 })], links: [[0, 1]], ext: {}, aliases: ["RCC"] },
    { slug: "survivorship", title: "Survivorship", category: "Supportive Care", site: "supportive", boxes: 5, encoded: 1, sections: [],
      pages: [page("SURV-1", { e: 1 })], links: [], ext: { prostate: [0] }, aliases: [] },
  ],
};

describe("atlas model", () => {
  const m = buildModel(raw);
  it("places every guideline on the ring, clockwise in site order", () => {
    expect(m.guidelines.map((g) => g.slug)).toEqual(["prostate", "kidney", "survivorship"]);
    const angles = m.guidelines.map((g) => g.angle);
    expect([...angles].sort((a, b) => a - b)).toEqual(angles);
    for (const g of m.guidelines) expect(Math.abs(Math.hypot(g.x, g.y) - R_RING)).toBeLessThan(60);
    expect(m.sites[0].a0).toBeLessThan(m.sites[0].a1);
  });
  it("links citing guidelines both ways and bundles the curves", () => {
    expect(m.bySlug.get("survivorship")!.citedBy).toEqual(["prostate"]);
    expect(m.links).toHaveLength(2);
    const l = m.links[0];
    expect(l.pts[0]).toEqual([l.a.x, l.a.y]);
    const end = l.pts[l.pts.length - 1];
    expect(Math.hypot(end[0] - l.b.x, end[1] - l.b.y)).toBeLessThan(1e-6);
    expect(pointAt(l.pts, 0)).toEqual(l.pts[0]);
  });
  it("titles pages the way the reader does", () => {
    expect(m.bySlug.get("prostate")!.pages[0].title).toBe("PROS-1 Title of the Page");
    expect(displayTitle("Chronic Lymphocytic Leukemia_Small Lymphocytic Lymphoma")).toBe("Chronic Lymphocytic Leukemia/Small Lymphocytic Lymphoma");
    expect(displayTitle("Melanoma Uveal")).toBe("Uveal Melanoma");
  });
  it("lays a guideline's pages out as a tree from its start pages", () => {
    const l = layoutGuideline(m.bySlug.get("prostate")!);
    expect(l.pages.map((p) => p.depth)).toEqual([1, 2, 3, 3]);
    expect(l.tree).toEqual([[0, 1], [1, 2], [1, 3]]);
    expect(l.cross).toEqual([[3, 2]]);
    const k = layoutGuideline(m.bySlug.get("kidney")!);
    expect(k.sections.map((s) => s.name)).toEqual(["Clear Cell", "Non-Clear Cell"]);
  });
  it("searches titles, abbreviations, sections and page codes", () => {
    const find = searchIndex(m);
    expect(find("rcc")[0]).toMatchObject({ kind: "guideline", slug: "kidney" });
    expect(find("prost")[0]).toMatchObject({ kind: "guideline", slug: "prostate" });
    expect(find("pros-3")[0]).toMatchObject({ kind: "page", page: "PROS-3" });
    expect(find("non clear")[0]).toMatchObject({ kind: "section", slug: "kidney", section: 1 });
    expect(find("genito")[0]).toMatchObject({ kind: "site", site: "gu" });
    expect(find("zzz")).toEqual([]);
  });
  it("round-trips places through the URL hash", () => {
    for (const f of [{ level: 0 }, { level: 0, site: "gu" }, { level: 1, slug: "prostate" }, { level: 2, slug: "prostate", page: "PROS-3" }] as const) {
      expect(parseAtlasHash(atlasHash(f), m)).toEqual(f.level === 0 && !("site" in f) ? { level: 0 } : f);
    }
    expect(parseAtlasHash("#atlas/nope", m)).toEqual({ level: 0 });
    expect(parseAtlasHash("#atlas/prostate/NOPE-1", m)).toEqual({ level: 1, slug: "prostate" });
  });
});
