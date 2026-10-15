/**
 * The atlas: every guideline placed on one map. A search hub sits at the centre, cancer sites
 * form sectors of a ring around it, guidelines sit on the outer ring, and the references between
 * guidelines are drawn as bundled curves through the middle (hierarchical edge bundling).
 * Opening a guideline lays its algorithm pages out as a radial tree; opening a page shows its
 * boxes where they are printed on the PDF page.
 *
 * Everything here is pure layout in "world" units; atlas/engine.ts draws it.
 */
import { curveBundle, line } from "d3-shape";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import { pageTitle } from "../lib/adapt";

export interface AtlasPageRaw { id: string; a: string; h?: string; s?: number; n: number; d: number; e?: 1 }
export interface AtlasGuidelineRaw {
  slug: string; title: string; category: string; version?: string | null; date?: string | null; site: string;
  boxes: number; encoded: number; sections: string[]; pages: AtlasPageRaw[]; links: [number, number][];
  ext: Record<string, number[]>; aliases?: string[];
}
export interface AtlasRaw { format: string; sites: { id: string; label: string }[]; guidelines: AtlasGuidelineRaw[] }

declare global { interface Window { __ATLAS__?: AtlasRaw | null } }

export type Pt = [number, number];

export interface Site {
  id: string; label: string; color: string; index: number;
  /** angular range of its guidelines (radians, 0 = 12 o'clock, clockwise) */
  a0: number; a1: number; angle: number;
  members: GNode[];
}
export interface PNode {
  id: string; index: number; title: string; section: number | null; start: boolean;
  boxes: number; decisions: number;
}
export interface GNode {
  slug: string; title: string; short: string; category: string; version: string | null; date: string | null;
  site: Site; angle: number; x: number; y: number; r: number; rad: number;
  pages: PNode[]; links: [number, number][]; sections: string[];
  boxes: number; decisions: number; encoded: number; aliases: string[];
  /** guidelines this one cites, with the pages that cite them */
  cites: { slug: string; pages: number[] }[];
  citedBy: string[];
}
export interface XLink { a: GNode; b: GNode; pts: Pt[]; w: number; len: number }

export interface Model {
  sites: Site[]; guidelines: GNode[]; bySlug: Map<string, GNode>; links: XLink[];
  totalPages: number;
}

/** Ring geometry (world units). */
export const R_HUB = 300, R_SITE = 470, R_RING = 770;
const GAP = 1.7;   // empty slots between two sites

/** Muted, map-like tints, one per site (light theme; dark theme lightens them). */
const SITE_COLORS: Record<string, string> = {
  breast: "#b4526f", thoracic: "#3f6f8f", gi: "#ad7826", hereditary: "#7b62a3", gu: "#2f7d6d",
  gyn: "#9a4d86", skin: "#c0683f", sarcoma: "#80694a", neuro: "#4a6db0", endocrine: "#86892b",
  lymphoma: "#3d8757", leukemia: "#b4473f", pediatric: "#c9862f", populations: "#5b7d86", supportive: "#66707c",
};

const SHORT: Record<string, string> = {
  adolescent_and_young_adult_aya_oncology: "AYA Oncology",
  associated_venous_thromboembolic_disease: "Cancer-Associated VTE",
  appendiceal_neoplasms_and: "Appendiceal Neoplasms",
  breast_screening_and_diagnosis: "Breast Screening & Diagnosis",
  central_nervous_system: "CNS Cancers",
  chronic_lymphocytic_leukemia_small_lymphocytic_l: "CLL / SLL",
  esophageal_and_esophagogastric_junction: "Esophageal & EGJ Cancers",
  gastrointestinal_stromal_tumors: "GIST",
  genetic_familial_high_risk_assessment_breast_ova: "Familial Risk: Breast, Ovarian…",
  genetic_familial_high_risk_assessment_colorectal: "Familial Risk: Colorectal, GI…",
  gestational_trophoblastic_neoplasia: "Gestational Trophoblastic",
  hematopoietic_cell_transplantation: "Cell Transplantation (HCT)",
  management_of_car_t_cell_and_lymphocyte_engager: "CAR T & Engager Toxicity",
  management_of_immune_checkpoint_inhibitor_relate: "Checkpoint Inhibitor Toxicity",
  myeloid_lymphoid_neoplasms_with_eosinophilia_and: "Neoplasms with Eosinophilia",
  neuroendocrine_and_adrenal_tumors: "Neuroendocrine & Adrenal",
  ovarian_cancer_fallopian_tube_cancer_primary_per: "Ovarian Cancer",
  pediatric_acute_lymphoblastic_leukemia: "Pediatric ALL",
  pediatric_aggressive_mature_b_cell_lymphomas: "Pediatric Mature B-Cell",
  pediatric_central_nervous_system: "Pediatric CNS",
  prevention_and_treatment_of_related_infections: "Cancer-Related Infections",
  systemic_light_chain_amyloidosis: "Light Chain Amyloidosis",
  thymomas_and_thymic_carcinomas: "Thymomas & Thymic Carcinoma",
  waldenstrom_macroglobulinemia_lymphoplasmacytic: "Waldenström Macroglobulinemia",
  wilms_tumor_nephroblastoma: "Wilms Tumor",
  melanoma_cutaneous: "Cutaneous Melanoma", melanoma_uveal: "Uveal Melanoma",
  mesothelioma_pleural: "Pleural Mesothelioma", mesothelioma_peritoneal: "Peritoneal Mesothelioma",
  dermatofibrosarcoma_protuberans: "Dermatofibrosarcoma",
  in_people_with_hiv: "Cancer in People with HIV",
};

/** "Genetic_Familial High-Risk Assessment Breast…" -> "Genetic/Familial High-Risk Assessment: Breast…" */
export function displayTitle(t: string) {
  return t.replace(/_/g, "/").replace(/^(Genetic\/Familial High-Risk Assessment) /, "$1: ")
    .replace(/^Melanoma (Cutaneous|Uveal)$/, "$1 Melanoma").replace(/^Mesothelioma (Pleural|Peritoneal)$/, "$1 Mesothelioma");
}

export const CATEGORY_LABEL: Record<string, string> = {
  Treatment: "Treatment", "Detection Prevention Risk Reduction": "Detection, prevention & risk",
  "Supportive Care": "Supportive care", "Specific Populations": "Specific populations",
};

/** Angle (0 = up, clockwise) to a point on a circle. */
export const polar = (a: number, r: number): Pt => [Math.sin(a) * r, -Math.cos(a) * r];

export function buildModel(raw: AtlasRaw): Model {
  const sites: Site[] = raw.sites.map((s, index) => ({ ...s, index, color: SITE_COLORS[s.id] ?? "#6b6860", a0: 0, a1: 0, angle: 0, members: [] }));
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const other: Site = { id: "other", label: "Other", index: sites.length, color: "#6b6860", a0: 0, a1: 0, angle: 0, members: [] };
  const guidelines: GNode[] = raw.guidelines.map((g) => {
    const site = siteById.get(g.site) ?? other;
    const pages: PNode[] = g.pages.map((p, index) => ({
      id: p.id, index, section: p.s ?? null, start: !!p.e, boxes: p.n, decisions: p.d,
      title: pageTitle(p.a, p.h, null, g.title, p.id),
    }));
    const node: GNode = {
      slug: g.slug, title: displayTitle(g.title), short: SHORT[g.slug] ?? displayTitle(g.title), category: g.category,
      version: g.version ?? null, date: g.date ?? null, site, angle: 0, x: 0, y: 0, rad: R_RING,
      r: 6 + 2.6 * Math.sqrt(Math.max(1, pages.length)),
      pages, links: g.links, sections: g.sections, boxes: g.boxes, encoded: g.encoded,
      decisions: pages.reduce((n, p) => n + p.decisions, 0), aliases: g.aliases ?? [],
      cites: Object.entries(g.ext).map(([slug, pg]) => ({ slug, pages: pg })), citedBy: [],
    };
    site.members.push(node);
    return node;
  });
  if (other.members.length) sites.push(other);
  const bySlug = new Map(guidelines.map((g) => [g.slug, g]));
  for (const g of guidelines) {
    g.cites = g.cites.filter((c) => bySlug.has(c.slug));
    for (const c of g.cites) bySlug.get(c.slug)!.citedBy.push(g.slug);
  }

  // Ring: one slot per guideline, GAP slots between sites; big guidelines alternate in and out
  // so neighbours do not touch.
  const live = sites.filter((s) => s.members.length);
  const slots = guidelines.length + GAP * live.length;
  const step = (Math.PI * 2) / slots;
  let a = GAP * step / 2;
  let k = 0;
  for (const s of live) {
    s.a0 = a - step / 2;
    for (const g of s.members) {
      g.angle = a;
      g.rad = R_RING + (k++ % 2 ? 26 : -8) + (g.r > 20 ? 10 : 0);
      [g.x, g.y] = polar(a, g.rad);
      a += step;
    }
    s.a1 = a - step / 2;
    s.angle = (s.a0 + s.a1) / 2;
    a += GAP * step;
  }

  // Bundled references: guideline -> its site -> hub -> other site -> guideline.
  const curve = line<Pt>().curve(curveBundle.beta(0.8));
  const links: XLink[] = [];
  for (const g of guidelines) {
    for (const c of g.cites) {
      const b = bySlug.get(c.slug)!;
      const sa = polar(g.site.angle, R_SITE), sb = polar(b.site.angle, R_SITE);
      const ctrl: Pt[] = g.site === b.site
        ? [[g.x, g.y], polar(g.site.angle, R_SITE + 160), [b.x, b.y]]
        : [[g.x, g.y], sa, [0, 0], sb, [b.x, b.y]];
      const pts = samplePath(curve, ctrl);
      links.push({ a: g, b, pts, w: c.pages.length, len: polyLength(pts) });
    }
  }
  return { sites, guidelines, bySlug, links, totalPages: guidelines.reduce((n, g) => n + g.pages.length, 0) };
}

/** Run a d3 curve and flatten its Bézier segments into points (for partial drawing and particles). */
function samplePath(curve: ReturnType<typeof line<Pt>>, ctrl: Pt[]): Pt[] {
  const out: Pt[] = [];
  let cx = 0, cy = 0;
  const ctx = {
    moveTo(x: number, y: number) { out.push([x, y]); cx = x; cy = y; },
    lineTo(x: number, y: number) { out.push([x, y]); cx = x; cy = y; },
    bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, u = 1 - t;
        out.push([u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y]);
      }
      cx = x; cy = y;
    },
    closePath() { /* open path */ },
  };
  curve.context(ctx as unknown as CanvasRenderingContext2D)(ctrl);
  return out;
}

export function polyLength(pts: Pt[]) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return n;
}
/** Point at fraction t of a polyline. */
export function pointAt(pts: Pt[], t: number, len = polyLength(pts)): Pt {
  let want = Math.max(0, Math.min(1, t)) * len;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (want <= d || i === pts.length - 1) {
      const f = d ? Math.min(1, want / d) : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    }
    want -= d;
  }
  return pts[pts.length - 1];
}

/* ---------------- level 1: a guideline's algorithm pages ---------------- */

export interface L1Page { p: PNode; x: number; y: number; angle: number; depth: number; parent: number | null; order: number }
export interface L1Layout {
  slug: string; R: number; maxDepth: number; pages: L1Page[];
  tree: [number, number][]; cross: [number, number][];
  sections: { index: number; name: string; a0: number; a1: number }[];
}

/** Radial tidy tree over the page links: start pages hang off the guideline, every other page off
 * the first page that links to it (breadth first). Extra links are drawn as cross links. */
export function layoutGuideline(g: GNode): L1Layout {
  const n = g.pages.length;
  const out = new Map<number, number[]>();
  for (const [a, b] of g.links) (out.get(a) ?? out.set(a, []).get(a)!).push(b);
  const parent = new Array<number | null>(n).fill(null);
  const seen = new Array<boolean>(n).fill(false);
  const roots: number[] = [];
  const queue: number[] = [];
  const visit = (i: number) => { seen[i] = true; queue.push(i); };
  g.pages.forEach((p, i) => { if (p.start) { roots.push(i); visit(i); } });
  if (!roots.length && n) { roots.push(0); visit(0); }
  const bfs = () => {
    while (queue.length) {
      const i = queue.shift()!;
      for (const j of (out.get(i) ?? []).sort((x, y) => x - y)) if (!seen[j]) { parent[j] = i; visit(j); }
    }
  };
  bfs();
  for (let i = 0; i < n; i++) if (!seen[i]) { roots.push(i); visit(i); bfs(); }   // pages only reached through a cycle

  type T = { i: number; children: T[] };
  const nodes: T[] = g.pages.map((_, i) => ({ i, children: [] }));
  const root: T = { i: -1, children: [] };
  for (let i = 0; i < n; i++) (parent[i] === null ? root : nodes[parent[i]!]).children.push(nodes[i]);
  const sortKids = (t: T) => { t.children.sort((a, b) => a.i - b.i); t.children.forEach(sortKids); };
  sortKids(root);
  const h = hierarchy(root);
  const maxDepth = Math.max(1, h.height);
  const R = Math.max(70, Math.min(170, 46 + Math.sqrt(n) * 13));
  tree<T>().size([Math.PI * 2, R]).separation((a, b) => (a.parent === b.parent ? 1 : 1.6) / Math.max(1, a.depth))(h);
  const first = h.children?.[0] as HierarchyPointNode<T> | undefined;
  const rot = g.angle - (first ? first.x : 0);   // the first start page points away from the hub
  const pages: L1Page[] = new Array(n);
  let order = 0;
  h.each((d) => {
    if (d.data.i < 0) return;
    const pd = d as HierarchyPointNode<T>;
    const ang = pd.x + rot;
    const [x, y] = polar(ang, pd.y);
    pages[d.data.i] = { p: g.pages[d.data.i], x: g.x + x, y: g.y + y, angle: ang, depth: d.depth, parent: parent[d.data.i], order: order++ };
  });
  const tset = new Set(parent.map((p, i) => (p === null ? "" : `${p}>${i}`)));
  const cross = g.links.filter(([a, b]) => !tset.has(`${a}>${b}`) && !tset.has(`${b}>${a}`));
  const tr = parent.flatMap((p, i) => (p === null ? [] : [[p, i] as [number, number]]));

  // Section arcs: the angular spread of each section's pages (only when the guideline has sections).
  const sections: L1Layout["sections"] = [];
  if (g.sections.length > 1) {
    g.sections.forEach((name, index) => {
      const angs = pages.filter((q) => q.p.section === index).map((q) => q.angle);
      if (!angs.length) return;
      // the pages of a section are contiguous in the tree almost always; take the tightest arc
      const s = angs.map((x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((x, y) => x - y);
      let gap = 0, at = 0;
      for (let i = 0; i < s.length; i++) {
        const d = (i + 1 < s.length ? s[i + 1] : s[0] + 2 * Math.PI) - s[i];
        if (d > gap) { gap = d; at = i; }
      }
      const a0 = s[(at + 1) % s.length], a1 = s[at] < a0 ? s[at] + 2 * Math.PI : s[at];
      sections.push({ index, name, a0, a1 });
    });
  }
  return { slug: g.slug, R, maxDepth, pages, tree: tr, cross, sections };
}

/* ---------------- search ---------------- */

export type SearchHit =
  | { kind: "guideline"; slug: string; label: string; sub: string; score: number }
  | { kind: "site"; site: string; label: string; sub: string; score: number }
  | { kind: "page"; slug: string; page: string; label: string; sub: string; score: number }
  | { kind: "section"; slug: string; section: number; label: string; sub: string; score: number };

type NoScore<T> = T extends unknown ? Omit<T, "score"> : never;
interface Doc { hit: NoScore<SearchHit>; words: string[]; weight: number }

const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

export function searchIndex(m: Model) {
  const docs: Doc[] = [];
  for (const s of m.sites) docs.push({ hit: { kind: "site", site: s.id, label: s.label, sub: `${s.members.length} guidelines` }, words: words(s.label), weight: 3 });
  for (const g of m.guidelines) {
    docs.push({ hit: { kind: "guideline", slug: g.slug, label: g.title, sub: `${g.site.label} · ${g.pages.length} algorithm pages` }, words: words(`${g.title} ${g.short} ${g.aliases.join(" ")} ${g.slug.replace(/_/g, " ")}`), weight: 4 });
    g.sections.forEach((name, section) => docs.push({ hit: { kind: "section", slug: g.slug, section, label: name, sub: `Section of ${g.short}` }, words: words(name), weight: 2 }));
    for (const p of g.pages) docs.push({ hit: { kind: "page", slug: g.slug, page: p.id, label: p.title, sub: `${p.id} · ${g.short}` }, words: words(`${p.title} ${p.id}`), weight: 1 });
  }
  return (q: string, limit = 9): SearchHit[] => {
    const qs = words(q);
    if (!qs.length) return [];
    const hits: SearchHit[] = [];
    for (const d of docs) {
      let score = d.weight * 10;
      let ok = true;
      for (const t of qs) {
        const i = d.words.findIndex((w) => w.startsWith(t));
        if (i < 0) { ok = false; break; }
        score += (d.words[i] === t ? 6 : 2) - Math.min(i, 8) * 0.4;
      }
      if (ok) hits.push({ ...d.hit, score: score - d.words.length * 0.05 } as SearchHit);
    }
    hits.sort((a, b) => b.score - a.score);
    // keep a mix: guidelines and sites first, then sections and pages
    return hits.slice(0, limit);
  };
}
