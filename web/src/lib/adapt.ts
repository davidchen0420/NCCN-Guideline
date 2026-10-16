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

const ACRONYMS = new Set(["PSA", "ADT", "CRPC", "CSPC", "RT", "RP", "MDT", "BCR", "BRCA", "DNA", "MRI", "PET", "CT", "PSMA", "ARPI", "HRR", "FDA", "TNM", "AJCC", "NCCN", "HIV", "AIDS", "CNS", "GIST", "AML", "ALL", "CLL", "SLL", "CML", "MDS", "MPN", "NSCLC", "SCLC", "HER2", "ER", "PR", "DCIS", "LCIS", "AYA", "HPV", "EGFR", "ALK", "ROS1", "BRAF", "KRAS", "MSI", "MMR", "PD-L1", "HCT", "GVHD", "VTE", "CAR", "T-CELL", "B-CELL", "NK", "UK", "US", "APL", "ELN", "BPDCN", "ATO", "ATRA", "CBF", "FLT3", "IDH1", "IDH2", "NPM1", "TKI", "MRD", "ECOG", "LDCT", "NHL", "CNS", "GTN", "MPNST", "DLBCL", "MCL", "CTCL", "HL", "LCS", "MSI-H", "DMMR", "HCC", "RCC", "SCC", "BCC", "GI", "GU", "NET", "NETS", "SBRT", "IMRT", "EBRT", "NLPHL", "NMIBC", "MIBC", "LAMN", "HAMN", "BCS", "GOG", "PTEN", "CS", "PHTS", "HR", "LMS", "GCT", "MF", "SS", "TURBT", "BCG", "RAI", "TSH", "NSAID", "MS"]);
const SMALL = new Set(["and", "or", "for", "of", "the", "in", "to", "with", "on", "a", "an", "by", "at", "vs"]);

/** Footnote marks glued to the end of a box's text ("INDUCTIONe,f,g", "(ST-1)a"). Only after a word
 * printed in capitals (two or more capitals, no lower case), so ordinary words and staging codes
 * keep their letters: "Low", "High", "cT1c", "T1c", "M1b". */
const trailingMarks = (s: string) => {
  const m = s.match(/^([\s\S]*?)(\S*[A-Z0-9)\]])((?:[a-z]{1,3}|\d{1,2})(?:[,-](?:[a-z]{1,3}|\d{1,2}))*)$/);
  if (!m) return s;
  const word = m[2];
  const caps = (word.match(/[A-Z]/g) ?? []).length;
  return caps >= 2 && !/[a-z]/.test(word) ? m[1] + word : s;
};

/** Control characters and private-use glyphs the PDF text layer leaves in (U+0007 bullets in
 * references, U+FFFD, U+E000-F8FF). U+0017 is the sub-bullet parseBox reads, so it stays here. */
const JUNK = /[\u0000-\u0008\u000b\u000c\u000e-\u0016\u0018-\u001f\u007f\ufffd\ue000-\uf8ff]/g;
/** A footnote letter as printed: "m", "gg", "bbb" (NCCN doubles the letter after z). */
const MARK = `(?:${"abcdefghijklmnopqrstuvwxyz".split("").map((c) => `${c}{1,3}`).join("|")})`;
const COMMA_MARKS = new RegExp(`([A-Za-z0-9%)\\]]),${MARK}(?:,${MARK})*(?=[\\s.;:)\\]]|$)`, "g");   // "alterations,m start", "DOSE,l"
const PAREN_MARKS = new RegExp(`\\)${MARK}(?:,${MARK})*(?=[\\s.;:,\\]]|$)`, "g");                   // "(>=1%)rr", "(category 1)bbb"
const SPACED_MARKS = new RegExp(`(\\s)(${MARK}(?:,${MARK})+)(?=[\\s.;:)\\]]|$)`, "g");                   // " h,hh,ii,jj or RT"
const ASCENDING_MARKS = /([A-Za-z0-9)\]])([a-z](?:,[a-z]){2,})(?=[\s.;:)\]]|$)/g;                      // "Syndromeq,r,s,t,u,v": three or more single letters in alphabetical order
const ascending = (xs: string[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
const distinct = (xs: string[]) => new Set(xs).size === xs.length;
const GLUED_WORDS = "(?:or|and|if|to|for|with|in|of|an|the)";
/** Compound words the PDF wrapped at the hyphen ("first- line", "ultra- hypermutated"); a conjunction after the
 * hyphen is a suspended hyphen ("PCR- and", "ER- or", "Pre- and Post-Test") and stays. */
const HYPHEN_WRAP = /(^|[^A-Za-z0-9])([A-Za-z]{2,})- (?!(?:and|or|to|vs|nor|but)\b)([a-z])/g;
/** FDA biosimilar suffix split from its drug: "amivantamab- vmjw" (the four letters have no vowel pattern of a word). */
const DRUG_SUFFIX = /\b([A-Za-z]+(?:mab|cept|stim|grastim|poetin|alfa|beta|ase|tide|ept))- ([a-z]{4})\b/g;
const VOWELLESS_SUFFIX = /\b([A-Za-z]{4,})- ([bcdfghjklmnpqrstvwxz]{3,4})\b/g;

/** String-only cleanups shared by box text, titles and displayed text. Never needs the box's footnote list. */
function tidy(s: string): string {
  let t = s
    .replace(JUNK, "")
    .replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ")
    .replace(ASCENDING_MARKS, (all, pre: string, seq: string) => (ascending(seq.split(",")) ? pre : all))
    .replace(COMMA_MARKS, "$1")
    .replace(new RegExp(`([A-Za-z0-9])\\)(${GLUED_WORDS})(?=\\s)`, "g"), "$1) $2")
    .replace(PAREN_MARKS, ")")
    .replace(SPACED_MARKS, (all, sp: string, seq: string) => (distinct(seq.split(",")) ? sp : all))
    .replace(new RegExp(`([a-zA-Z]),(${GLUED_WORDS})(?=\\s)`, "g"), "$1, $2")                  // "therapy,if", "isavuconazole,an"
    .replace(DRUG_SUFFIX, "$1-$2")
    .replace(VOWELLESS_SUFFIX, "$1-$2")
    .replace(HYPHEN_WRAP, (_m, p: string, a: string, b: string) => `${p}${a}-${b}`)
    .replace(/([A-Za-z])\/ (?=[a-z])/g, "$1/")                                                // "persistence/ recurrence", "and/ or"
    .replace(/\n[ \t]*\.[ \t]*(?=\n|$)/g, "").replace(/^[ \t]*\.[ \t]*\n/, "");                                           // a stray "." line
  return t;
}

/** Footnote marks and extraction debris removed from a box's text, for display. */
export const stripMarks = (raw: string) =>
  tidy(trailingMarks(raw.trim()))
    .replace(/\b([A-Z]{4,})[a-z]{1,3}(?:,[a-z]{1,3})*(?=\s)/g, "$1")                         // glued inside: "SURVEILLANCEvv and"
    .replace(/[ \t]*\u0017[ \t]*/g, " · ").replace(/^ · /, "").replace(/ · (?=\n|$)/g, "")   // sub-bullets (parseBox reads them from the raw text)
    .trim();

/** The text of one box as the viewer keeps it: debris dropped and the box's own footnote letters removed where
 * they are glued to a word ("ozogamicinq,r,s", "therapygg,kk"). `marks` are the letters the box lists. */
export function cleanBoxText(raw: string, marks: string[] = []): string {
  let t = raw.replace(JUNK, "");
  const known = [...new Set(marks.filter((m) => /^[a-z]{1,3}$/.test(m)))].sort((a, b) => b.length - a.length);
  if (known.length > 1) {
    const M = `(?:${known.join("|")})`;
    // two or more different letters in a row, glued to the word before them
    t = t.replace(new RegExp(`([A-Za-z0-9%.)\\]])(${M})((?:,${M})+)(?=[\\s.;:,)\\]±]|$)`, "g"), (all, pre: string, first: string, rest: string) =>
      distinct([first, ...rest.split(",").slice(1)]) ? pre : all);
  }
  const doubled = known.filter((m) => m.length > 1);
  if (doubled.length) t = t.replace(new RegExp(`\\.(?:${doubled.join("|")})(?=\\s+[A-Z]|$)`, "g"), ".");   // "patients.gg See BINV-K"
  return tidy(t);
}
/** Acronyms learned from one guideline's own text: words printed in capitals that are printed more often in capitals than as an ordinary word
 * (lower case or Capitalised) there, and either sit inside mixed-case text, are defined in parentheses, or come up
 * at least twice ("ALCL", "NLPHL", "KIT"). A shouted heading word ("SELLAR") that is written normally elsewhere is not one. */
export function learnAcronyms(texts: Iterable<string>): Set<string> {
  const ordinary = new Map<string, number>(), strong = new Set<string>(), count = new Map<string, number>();
  for (const t of texts) {
    for (const line of t.split("\n")) {
      const mixed = /[a-z]{3}/.test(line);
      for (const w of line.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
        if (/^[A-Za-z]?[a-z]+$/.test(w)) ordinary.set(w.toLowerCase(), (ordinary.get(w.toLowerCase()) ?? 0) + 1);
        else if (/^[A-Z][A-Z0-9]{1,5}$/.test(w) && /[A-Z]{2}/.test(w)) {
          count.set(w, (count.get(w) ?? 0) + 1);
          if (mixed) strong.add(w);
        }
      }
      for (const m of line.matchAll(/\(([A-Z][A-Z0-9]{1,5})\)/g)) strong.add(m[1]);
    }
  }
  const out = new Set<string>();
  for (const [w, n] of count) if (n > (ordinary.get(w.toLowerCase()) ?? 0) && (strong.has(w) || (n >= 2 && w.length <= 5))) out.add(w);
  return out;
}

/** A title cut by a line break keeps its parentheses balanced: an unclosed "(Up to 6" is dropped, and a stray ")" ends what came before. */
export function balanced(t: string): string {
  let depth = 0, open = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "(") { if (!depth) open = i; depth++; }
    else if (t[i] === ")") { if (depth) depth--; else return balanced(t.slice(i + 1).trim()); }
  }
  return depth && open >= 0 ? t.slice(0, open).trim() : t;
}

const ROMAN = /^(?:II|III|IV|VI|VII|VIII|IX|XI|XII|(?:I{1,3}|IV)[ABC]\d?)$/;   // numerals and stages: IV, IIIA
const isAcr = (w: string, acr?: Set<string>) => ACRONYMS.has(w) || ROMAN.test(w) || !!acr?.has(w);
const TOKEN = /[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*[-/]?/g;

/** "WORKUP FOR M1 CRPCxx,ddd" -> "Workup for M1 CRPC": title case; acronyms (listed, or learned from the guideline),
 * stage codes, roman numerals and page codes stay; a word after an acronym's hyphen is lower case
 * ("ER- AND/OR PR-POSITIVE; HER2-NEGATIVE" -> "ER- and/or PR-positive; HER2-negative"). */
export function smartTitle(raw: string, acr?: Set<string>): string {
  const text = balanced(stripMarks(raw)
    .replace(/([A-Za-z]{2,})- (?!(?:and|or|to|vs|nor|but)\b)(?=[A-Za-z])/gi, "$1-")        // "Post- Consolidation" (a wrapped compound)
    .replace(/\s*\(\s*see\b[^)]*\)?\s*$/i, ""));                                           // a trailing "(SEE BINV-28 FOR ...)" pointer
  const letters = text.replace(/[^A-Za-z]/g, "");
  const shouting = !!letters && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.8;
  const toks = text.match(TOKEN) ?? [];
  const lastTok = toks[toks.length - 1];
  // Mixed case: a long word printed in capitals changes, and so do the short capitals next to it ("(UP TO 6 MO PERIOPERATIVE TREATMENT)"); digits are transparent.
  const caps = toks.map((t) => (!/[a-z]/.test(t) ? t.replace(/[-/]+$/, "") : ""));
  const change = caps.map((c) => !!c && !isAcr(c, acr) && c.replace(/[^A-Z]/g, "").length >= 5);
  const shout = (c: string) => !!c && !isAcr(c, acr) && /[A-Z]/.test(c) && !/\d/.test(c);
  for (const order of [1, -1]) {
    for (let k = order > 0 ? 0 : toks.length - 1, carry = false; k >= 0 && k < toks.length; k += order) {
      if (change[k]) carry = true;
      else if (carry && shout(caps[k])) change[k] = true;
      else if (carry && !/^\d+$/.test(toks[k])) carry = false;
    }
  }
  let seen = 0;
  return text.replace(TOKEN, (tok) => {
    const isFirst = seen === 0;
    const at = seen++;
    if (/[a-z]/.test(tok)) return tok;                                                     // "Lung-RADS", "Hodgkin" as printed
    const core = tok.replace(/[-/]+$/, "");
    if (!shouting && !change[at] && !isAcr(core, acr)) return tok;                          // mixed case: only runs of long shouted words change
    if (/^[A-Z]+-[A-Z0-9]{1,3}$/.test(core)) return tok;                                    // page codes: AML-A, MFSS-3A
    const parts = tok.split(/([-/])/);
    let prevKeep = false;
    return parts.map((w, i) => {
      if (i % 2 || !w) return w;
      const keep = isAcr(w, acr) || /\d/.test(w);
      const result =
        keep ? w
        : w === "A" && tok === lastTok ? w
        : (i > 0 || !isFirst) && SMALL.has(w.toLowerCase()) ? w.toLowerCase()
        : i > 0 && parts[i - 1] === "-" && prevKeep ? w.toLowerCase()
        : w[0] + w.slice(1).toLowerCase();
      prevKeep = keep;
      return result;
    }).join("");
  });
}

function docTitle(kind: string, page: GPage, acr?: Set<string>): string {
  const lines = page.text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (page.heading) return smartTitle(page.heading, acr);
  if (kind === "discussion") {
    const h = lines.slice(0, 30).find((l) => l.length > 3 && l.length <= 70 && /^[A-Z]/.test(l) && !/[.,;:]$/.test(l) && l.split(" ").length <= 9 && !/^(NCCN|Version|Page|This discussion)/i.test(l)
      && balanced(l) === l && !/\d{2,}$/.test(l));
    return h ?? `Discussion ${page.code}`;
  }
  return lines[0] ? smartTitle(lines[0], acr) : page.code;
}

/** The page's own title: its first line (the printed title, footnote marks dropped), else the
 * extracted heading; skipping fragments and the guideline's running title. A title that wraps
 * ("ADJUVANT TREATMENT (UP TO 6 / MO PERIOPERATIVE TREATMENT)") is read to the closing parenthesis. */
function flowTitle(p: GPage, guideline: string, acr?: Set<string>): string {
  const lines = p.text.split("\n").map((l) => l.trim()).filter(Boolean);
  let first = lines[0] ?? "";
  for (let i = 1; i < 3 && i < lines.length && (first.match(/\(/g) ?? []).length > (first.match(/\)/g) ?? []).length; i++) first += ` ${lines[i]}`;
  return pageTitle(first, p.heading, p.title, guideline, p.id, acr);
}
/** The title of an algorithm page from its first text line, extracted heading or running title. */
export function pageTitle(firstLine: string, heading: string | null | undefined, title: string | null | undefined, guideline: string, id: string, acr?: Set<string>): string {
  const first = balanced(stripMarks(firstLine));
  const ok = (t?: string | null) => !!t && t.trim().length >= 12 && !/[/:-]$/.test(t.trim()) && t.trim().toLowerCase() !== guideline.toLowerCase();
  const pick = [first, balanced(stripMarks(heading ?? "")), title ?? ""].find(ok) ?? first ?? id;
  return smartTitle(pick || id, acr);
}

export function adaptGuideline(file: GuidelineFile): Bundle {
  const pagesById = new Map(file.pages.map((p) => [p.id, p]));
  const pdfIndex = (id: string | null | undefined) => (id && pagesById.has(id) ? pagesById.get(id)!.pdf_page - 1 : undefined);
  const flowIds = file.pages.filter((p) => p.kind === "algorithm").map((p) => p.id);
  const flowSet = new Set(flowIds);
  const acr = learnAcronyms([...file.nodes.map((n) => n.text), ...file.pages.map((p) => p.text)]);

  // Cross-guideline page prefixes ("DIS-A" -> distress_management) from the typed links.
  const prefixes: Record<string, string> = {};
  for (const n of file.nodes) for (const l of n.links) {
    if (l.type === "external_guideline" && l.guideline && l.code) prefixes[l.code.split("-")[0]] = l.guideline;
  }

  const pages: Record<string, FlowPage> = {};
  for (const id of flowIds) {
    const p = pagesById.get(id)!;
    pages[id] = {
      nodes: [], edges: [], counts: {}, title: flowTitle(p, file.guideline.title, acr), pdf: p.pdf_page - 1,
      size: p.size, band: p.content_band, section: p.section ?? null,
    };
  }
  const links = new Set<string>();
  const children: Record<string, string[]> = {};
  // Box ids are "<printed code>:<local>"; on multi-part pages ("GALL-4 3 of 3") the viewer needs
  // "<page id>:<local>", so ids are remapped and edges, continuations and entries follow the map.
  const idMap = new Map<string, string>();
  const headerIds = new Set<string>(), nodeIds = new Set<string>();
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
      id: short, kind: header ? "header" : "box", text: cleanBoxText(n.text, [...n.footnotes.map((f) => f.mark), ...Object.keys(pagesById.get(n.page)?.footnotes ?? {})]), bbox: n.bbox,
      pred: n.predicate ?? null, links: pageLinks, role: n.role,
      review: n.predicate_status ? REVIEW[n.predicate_status] ?? null : null,
      // A letter whose text was not found anywhere keeps its badge, so cards still match the page.
      footnotes: n.footnotes.map((f) => [f.mark, cleanBoxText(f.text ?? "(The text of this footnote was not found in the guideline.)"), pdfIndex(f.page)] as [string, string, number?]),
      decision: n.decision_type ?? null, received: n.received_predicate ?? null,
      linkCond: n.link_condition ?? null, reviewNote: n.review_note, sectionClause: !!n.section_clause, ext,
    });
    if (header) headerIds.add(full); else children[full] = [];
    nodeIds.add(full);
  }
  const map = (id: string) => idMap.get(id);
  // Headings and column/table titles are not steps of a route: an arrow into or out of one passes
  // through it, so a table stays connected (root -> title -> row cell becomes root -> row cell).
  const viaHeader = new Map<string, { dst: string; cls: BEdge["cls"] }[]>();
  const direct: { src: string; dst: string; cls: BEdge["cls"]; counted: boolean }[] = [];
  for (const e of file.edges) {
    const src = map(e.src), dst = map(e.dst);
    if (!src || !dst || !nodeIds.has(src) || !nodeIds.has(dst)) continue;
    const cls = EVIDENCE[e.evidence] ?? "unsure";
    if (headerIds.has(src)) (viaHeader.get(src) ?? viaHeader.set(src, []).get(src)!).push({ dst, cls });
    else direct.push({ src, dst, cls, counted: true });
  }
  for (const c of file.continuations) {
    const src = map(c.src), dst = map(c.dst);
    if (!src || !dst || !nodeIds.has(src) || !nodeIds.has(dst)) continue;
    if (headerIds.has(src)) (viaHeader.get(src) ?? viaHeader.set(src, []).get(src)!).push({ dst, cls: "agreed" });
    else direct.push({ src, dst, cls: "agreed", counted: false });
  }
  const resolved = new Map<string, string[]>();
  const through = (id: string, seen = new Set<string>()): string[] => {
    if (!headerIds.has(id)) return [id];
    if (seen.has(id)) return [];
    const memo = resolved.get(id);
    if (memo) return memo;
    seen.add(id);
    const out = [...new Set((viaHeader.get(id) ?? []).flatMap((x) => through(x.dst, seen)))];
    seen.delete(id);
    if (!seen.size) resolved.set(id, out);
    return out;
  };
  const seenEdge = new Set<string>();
  for (const e of direct) {
    for (const dst of through(e.dst)) {
      if (dst === e.src) continue;
      const key = `${e.src}>${dst}`;
      if (e.counted && (dst === e.dst || !seenEdge.has(key))) {
        seenEdge.add(key);
        const page = e.src.slice(0, e.src.indexOf(":"));
        const fp = pages[page];
        fp.counts[e.cls] = (fp.counts[e.cls] ?? 0) + 1;
        fp.edges.push({ src: e.src.slice(page.length + 1), dst: dst.slice(dst.indexOf(":") + 1), cls: e.cls });
      }
      if (!children[e.src].includes(dst)) children[e.src].push(dst);
    }
  }
  const roots: Record<string, string[]> = Object.fromEntries(flowIds.map((id) => [id, [] as string[]]));
  for (const e of file.entries) {
    const full = map(e);
    if (!full || !nodeIds.has(full)) continue;
    for (const r of through(full)) {
      const list = roots[r.slice(0, r.indexOf(":"))];
      if (list && !list.includes(r)) list.push(r);
    }
  }

  const docs: Record<string, Doc> = {};
  for (const p of file.pages) {
    const kind = DOC_KINDS[p.kind];
    if (!kind || !p.text.trim()) continue;
    const d = docs[p.code] ??= { code: p.code, kind, title: "", pages: [] };
    d.pages.push({ text: p.text.replace(JUNK, ""), tables: p.tables ?? [], pdf: p.pdf_page - 1 });
    if (!d.title) d.title = docTitle(p.kind, p, acr);
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
