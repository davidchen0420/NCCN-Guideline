/**
 * Reads the canonical per-guideline file (data/<slug>/guideline.json, format
 * "nccn-guideline/1", built by nccn_nav.bundle) into the viewer's Bundle.
 *
 * Everything is taken as resolved by the data: page ids ("PROS-F 2 of 5"), footnotes with the
 * page that defines each letter, typed links (page / discussion / external guideline),
 * continuations from leaves to the linked page's entry boxes, decision types, effective
 * conditions with their review status, "already received" conditions of options, the link
 * conditions of entry boxes, sections of multi-disease guidelines and page sizes.
 */
import type { BEdge, BNode, Bundle, Doc, FlowPage, Pred, Schema } from "../types";

interface GPage {
  id: string; code: string; part: number | null; parts: number | null; pdf_page: number; kind: string;
  title?: string; heading?: string | null; section?: string | null; size?: [number, number];
  content_band?: [number, number]; text: string; tables?: string[]; footnotes?: Record<string, string>;
}
interface GLink { type: "page" | "discussion" | "external_guideline"; code: string | null; part?: number | null; page?: string | null; pdf_page?: number | null; guideline?: string }
interface GNode {
  id: string; page: string; text: string; bbox: [number, number, number, number]; role: string;
  footnotes: { mark: string; page: string | null; text: string | null; resolved_by?: string }[];
  links: GLink[]; decision_type?: "condition" | "option" | "other" | null;
  predicate?: Pred | null; predicate_status?: string | null; section_clause?: boolean;
  received_predicate?: Pred | null; link_condition?: Pred | null; reached_from?: string[]; review_note?: string;
  bbox_matches_pdf?: boolean;
}
export interface GuidelineFile {
  format: string; built?: string;
  guideline: { slug: string; title: string; category?: string; version?: string; version_date?: string; pdf_sha256?: string; pdf_pages?: number };
  sections: { variable: string; values: string[]; pages: Record<string, string> } | null;
  pages: GPage[]; nodes: GNode[];
  edges: { src: string; dst: string; evidence: string }[];
  continuations: { src: string; dst: string; page: string }[];
  entries: string[];
  schema: Schema;
  quality?: Record<string, unknown>;
  /** added by the offline build: hand-encoded example patients */
  viewer_examples?: Bundle["examples"];
}

export const isGuidelineFile = (x: unknown): x is GuidelineFile =>
  !!x && typeof x === "object" && typeof (x as GuidelineFile).format === "string" && (x as GuidelineFile).format.startsWith("nccn-guideline/");

const EVIDENCE: Record<string, BEdge["cls"]> = { two_methods: "agreed", image_checked: "verified", table_text_checked: "verified", single_source: "unsure" };
const REVIEW: Record<string, BNode["review"]> = { model_reviewed: "reviewed", inherited_from_link: "inherited", section_only: "section", rejected: "rejected" };
const DOC_KINDS: Record<string, string> = { principles: "principles", staging: "staging", discussion: "discussion", other: "reference" };
const HEADER_ROLES = new Set(["page_heading", "column_header", "table_title"]);

const ACRONYMS = new Set(["PSA", "ADT", "CRPC", "CSPC", "RT", "RP", "MDT", "BCR", "BRCA", "DNA", "MRI", "PET", "CT", "PSMA", "ARPI", "HRR", "FDA", "TNM", "AJCC", "NCCN", "HIV", "AIDS", "CNS", "GIST", "AML", "ALL", "CLL", "SLL", "CML", "MDS", "MPN", "NSCLC", "SCLC", "HER2", "ER", "PR", "DCIS", "LCIS", "AYA", "HPV", "EGFR", "ALK", "ROS1", "BRAF", "KRAS", "MSI", "MMR", "PD-L1", "HCT", "GVHD", "VTE", "CAR", "T-CELL", "B-CELL", "NK", "UK", "US", "APL", "ELN", "BPDCN", "ATO", "ATRA", "CBF", "FLT3", "IDH1", "IDH2", "NPM1", "TKI", "MRD", "ECOG", "LDCT", "NHL", "CNS", "GTN", "MPNST", "DLBCL", "MCL", "CTCL", "HL", "LCS", "MSI-H", "DMMR", "HCC", "RCC", "SCC", "BCC", "GI", "GU", "NET", "NETS", "SBRT", "IMRT", "EBRT"]);
const SMALL = new Set(["and", "or", "for", "of", "the", "in", "to", "with", "on", "a", "an", "by", "at", "vs"]);

/** "WORKUP FOR M1 CRPCxx,ddd" -> "Workup for M1 CRPC": title case, acronyms and stage codes kept. */
export const stripMarks = (raw: string) =>
  raw.trim()
    .replace(/(?<=[A-Z0-9)\]])(?:[a-z]{1,3}|\d{1,2})(?:[,-](?:[a-z]{1,3}|\d{1,2}))*$/, "")   // trailing marks: "INDUCTIONe,f,g"
    .replace(/\b([A-Z]{4,})[a-z]{1,3}(?:,[a-z]{1,3})*(?=\s)/g, "$1")                         // glued inside: "SURVEILLANCEvv and"
    .trim();
export function smartTitle(raw: string): string {
  const text = stripMarks(raw);
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (!letters || letters.replace(/[^A-Z]/g, "").length / letters.length < 0.8) {
    // Mixed case: only words printed in capitals that are not abbreviations get title case.
    return text.replace(/\b[A-Z][A-Z-]{4,}\b/g, (w) => (ACRONYMS.has(w) ? w : w[0] + w.slice(1).toLowerCase()));
  }
  const words = text.split(/\s+/);
  return words.map((w, i) => {
    const core = w.replace(/[^A-Za-z0-9-]/g, "");
    if (/[a-z]/.test(core)) return w;   // "Lung-RADS" as printed
    if (ACRONYMS.has(core.toUpperCase()) || /\d/.test(core) || /^[A-Z]+-[A-Z0-9]{1,3}$/.test(core)) return w;   // page codes: AML-A
    if (i > 0 && SMALL.has(core.toLowerCase()) && !(core === "A" && i === words.length - 1)) return w.toLowerCase();
    return w.replace(/[A-Za-z]+/g, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());
  }).join(" ");
}

function docTitle(kind: string, page: GPage): string {
  const lines = page.text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (page.heading) return smartTitle(page.heading);
  if (kind === "discussion") {
    const h = lines.slice(0, 30).find((l) => l.length > 3 && l.length <= 70 && /^[A-Z]/.test(l) && !/[.,;:]$/.test(l) && l.split(" ").length <= 9 && !/^(NCCN|Version|Page|This discussion)/i.test(l));
    return h ?? `Discussion ${page.code}`;
  }
  return lines[0] ? smartTitle(lines[0]) : page.code;
}

/** The page's own title: its first line (the printed title, footnote marks dropped), else the
 * extracted heading; skipping fragments and the guideline's running title. */
function flowTitle(p: GPage, guideline: string): string {
  return pageTitle(p.text.split("\n").find((l) => l.trim()) ?? "", p.heading, p.title, guideline, p.id);
}
/** The title of an algorithm page from its first text line, extracted heading or running title. */
export function pageTitle(firstLine: string, heading: string | null | undefined, title: string | null | undefined, guideline: string, id: string): string {
  const first = stripMarks(firstLine);
  const ok = (t?: string | null) => !!t && t.trim().length >= 12 && !/[/:-]$/.test(t.trim()) && t.trim().toLowerCase() !== guideline.toLowerCase();
  const pick = [first, heading ?? "", title ?? ""].find(ok) ?? first ?? id;
  return smartTitle(pick || id);
}

export function adaptGuideline(file: GuidelineFile): Bundle {
  const pagesById = new Map(file.pages.map((p) => [p.id, p]));
  const pdfIndex = (id: string | null | undefined) => (id && pagesById.has(id) ? pagesById.get(id)!.pdf_page - 1 : undefined);
  const flowIds = file.pages.filter((p) => p.kind === "algorithm").map((p) => p.id);
  const flowSet = new Set(flowIds);

  // Cross-guideline page prefixes ("DIS-A" -> distress_management) from the typed links.
  const prefixes: Record<string, string> = {};
  for (const n of file.nodes) for (const l of n.links) {
    if (l.type === "external_guideline" && l.guideline && l.code) prefixes[l.code.split("-")[0]] = l.guideline;
  }

  const pages: Record<string, FlowPage> = {};
  for (const id of flowIds) {
    const p = pagesById.get(id)!;
    pages[id] = {
      nodes: [], edges: [], counts: {}, title: flowTitle(p, file.guideline.title), pdf: p.pdf_page - 1,
      size: p.size, band: p.content_band, section: p.section ?? null,
    };
  }
  const links = new Set<string>();
  const children: Record<string, string[]> = {};
  // Box ids are "<printed code>:<local>"; on multi-part pages ("GALL-4 3 of 3") the viewer needs
  // "<page id>:<local>", so ids are remapped and edges, continuations and entries follow the map.
  const idMap = new Map<string, string>();
  for (const n of file.nodes) {
    const fp = pages[n.page];
    if (!fp) continue;
    const short = n.id.slice(n.id.indexOf(":") + 1);
    const full = `${n.page}:${short}`;
    if (!idMap.has(n.id)) idMap.set(n.id, full);
    const pageLinks: string[] = [];
    const ext: { slug: string; code: string | null }[] = [];
    for (const l of n.links) {
      if (l.type === "external_guideline") { if (l.guideline) ext.push({ slug: l.guideline, code: l.code }); continue; }
      const target = l.page && flowSet.has(l.page) ? l.page : l.code;
      if (target && !pageLinks.includes(target)) pageLinks.push(target);
      if (target && target !== n.page) links.add(`${n.page}\u0000${target}`);
    }
    const header = HEADER_ROLES.has(n.role);
    fp.nodes.push({
      id: short, kind: header ? "header" : "box", text: n.text, bbox: n.bbox,
      pred: n.predicate ?? null, links: pageLinks, role: n.role,
      review: n.predicate_status ? REVIEW[n.predicate_status] ?? null : null,
      // A letter whose text was not found anywhere keeps its badge, so cards still match the page.
      footnotes: n.footnotes.map((f) => [f.mark, f.text ?? "(The text of this footnote was not found in the guideline.)", pdfIndex(f.page)] as [string, string, number?]),
      decision: n.decision_type ?? null, received: n.received_predicate ?? null,
      linkCond: n.link_condition ?? null, reviewNote: n.review_note, sectionClause: !!n.section_clause, ext,
    });
    if (!header) children[full] = [];
  }
  const map = (id: string) => idMap.get(id);
  for (const e of file.edges) {
    const src = map(e.src), dst = map(e.dst);
    if (!src || !dst || !(src in children) || !(dst in children)) continue;
    const page = src.slice(0, src.indexOf(":"));
    const fp = pages[page];
    const cls = EVIDENCE[e.evidence] ?? "unsure";
    fp.counts[cls] = (fp.counts[cls] ?? 0) + 1;
    fp.edges.push({ src: src.slice(page.length + 1), dst: dst.slice(dst.indexOf(":") + 1), cls });
    children[src].push(dst);
  }
  for (const c of file.continuations) {
    const src = map(c.src), dst = map(c.dst);
    if (src && dst && src in children && dst in children && !children[src].includes(dst)) children[src].push(dst);
  }
  const roots: Record<string, string[]> = Object.fromEntries(flowIds.map((id) => [id, [] as string[]]));
  for (const e of file.entries) {
    const full = map(e);
    if (!full || !(full in children)) continue;
    roots[full.slice(0, full.indexOf(":"))]?.push(full);
  }

  const docs: Record<string, Doc> = {};
  for (const p of file.pages) {
    const kind = DOC_KINDS[p.kind];
    if (!kind || !p.text.trim()) continue;
    const d = docs[p.code] ??= { code: p.code, kind, title: "", pages: [] };
    d.pages.push({ text: p.text, tables: p.tables ?? [], pdf: p.pdf_page - 1 });
    if (!d.title) d.title = docTitle(p.kind, p);
  }

  const first = flowIds.length ? pagesById.get(flowIds[0])! : file.pages[0];
  const gl = file.guideline;
  return {
    pages, children, roots, docs, schema: file.schema,
    links: [...links].map((x) => x.split("\u0000") as [string, string]),
    preds_draft: true,
    w: first?.size?.[0] ?? 792, h: first?.size?.[1] ?? 612,
    top: first?.content_band?.[0] ?? 85, bottom: first?.content_band?.[1] ?? 560,
    title: `${gl.title}${gl.version ? ` · v${gl.version}` : ""}`,
    pdf_pages: gl.pdf_pages ?? file.pages.length,
    pdf_candidates: [],
    examples: file.viewer_examples ?? [],
    guideline: gl, sections: file.sections ?? null, prefixes, structured: true,
  };
}
