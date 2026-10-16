import type { BNode, Bundle, Pred } from "../types";
import { configureRefs, parseBox, parseInline, type Parsed } from "./parseBox";
import { configureLabels } from "./factMeta";

/**
 * Words of the patient-fact names that this guideline's own text writes in capitals far more
 * often than in lower case (ECOG, FLT3, ALT): they are shown as abbreviations in labels.
 */
export function guidelineAcronyms(bundle: Bundle): string[] {
  const schema = bundle.schema ?? { variables: {}, derived: {} };
  const words = new Set<string>();
  const add = (s: string) => s.toLowerCase().split("_").forEach((w) => { if (/^[a-z][a-z0-9]{1,7}$/.test(w)) words.add(w); });
  Object.keys(schema.variables ?? {}).forEach(add);
  Object.keys(schema.derived ?? {}).forEach(add);
  Object.values(schema.variables ?? {}).forEach((v) => (v.values ?? []).forEach((x) => typeof x === "string" && /^[a-z0-9_]+$/.test(x) && add(x)));
  const up = new Map<string, number>(), low = new Map<string, number>();
  const scan = (text: string) => text.split("\n").forEach((line) => {
    const letters = line.replace(/[^A-Za-z]/g, "");
    if (letters.replace(/[^a-z]/g, "").length < letters.length * 0.3) return;   // headings in capitals say nothing
    for (const m of line.matchAll(/\b[A-Za-z][A-Za-z0-9]{1,7}\b/g)) {
      const w = m[0], l = w.toLowerCase();
      if (!words.has(l)) continue;
      if (w === w.toUpperCase()) up.set(l, (up.get(l) ?? 0) + 1);
      else if (w === l) low.set(l, (low.get(l) ?? 0) + 1);
    }
  });
  Object.values(bundle.pages).forEach((p) => p.nodes.forEach((n) => scan(n.text)));
  Object.values(bundle.docs ?? {}).forEach((d) => d.pages.forEach((p) => scan(p.text)));
  return [...words].filter((w) => (up.get(w) ?? 0) >= 2 && (up.get(w) ?? 0) > 2 * (low.get(w) ?? 0));
}

export type GNode = BNode & { page: string; full: string };
export interface RefHit { page: string; node?: string; via: "box" | "footnote" }

export interface Graph {
  bundle: Bundle;
  nodes: Map<string, GNode>;
  parents: Record<string, string[]>;
  preds: Record<string, Pred>;
  parsed: Map<string, Parsed>;
  refIndex: Map<string, RefHit[]>;
  flowPages: string[];
  docCodes: Record<"principles" | "staging" | "discussion" | "reference", string[]>;
  kids: (id: string) => string[];
  node: (id: string) => GNode | undefined;
}

export type Target = { type: "flow"; page: string } | { type: "doc"; code: string } | { type: "external"; slug: string; code: string } | { type: "none" };

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function buildGraph(bundle: Bundle): Graph {
  const flowPages = Object.keys(bundle.pages).sort(natural);
  configureRefs([...new Set([...flowPages.map((p) => p.split("-")[0]), ...Object.keys(bundle.prefixes ?? {})])]);
  configureLabels(bundle.schema ?? null, guidelineAcronyms(bundle));

  const nodes = new Map<string, GNode>();
  const preds: Record<string, Pred> = {};
  const parsed = new Map<string, Parsed>();
  for (const [page, g] of Object.entries(bundle.pages)) {
    for (const n of g.nodes) {
      const full = `${page}:${n.id}`;
      nodes.set(full, { ...n, page, full });
      if (n.pred) preds[full] = n.pred;
      parsed.set(full, parseBox(n.text));
    }
  }
  const parents: Record<string, string[]> = {};
  for (const [s, ks] of Object.entries(bundle.children)) for (const k of ks) (parents[k] ??= []).push(s);

  const refIndex = new Map<string, RefHit[]>();
  const add = (code: string, hit: RefHit) => {
    const list = refIndex.get(code) ?? [];
    if (!list.some((h) => h.page === hit.page && h.node === hit.node && h.via === hit.via)) list.push(hit);
    refIndex.set(code, list);
  };
  for (const [full, p] of parsed) {
    const n = nodes.get(full)!;
    p.refs.forEach((code) => add(code, { page: n.page, node: full, via: "box" }));
    n.links.forEach((code) => add(code, { page: n.page, node: full, via: "box" }));
    for (const [, text] of n.footnotes)
      parseInline(text).forEach((x) => { if (x.t === "ref" || x.t === "link") add(x.code, { page: n.page, node: full, via: "footnote" }); });
  }

  const docCodes: Graph["docCodes"] = { principles: [], staging: [], discussion: [], reference: [] };
  for (const d of Object.values(bundle.docs ?? {})) (docCodes[d.kind as keyof Graph["docCodes"]] ?? docCodes.reference).push(d.code);
  (Object.keys(docCodes) as (keyof Graph["docCodes"])[]).forEach((k) => docCodes[k].sort(natural));

  const kids = (id: string) => (id.endsWith(":START") ? bundle.roots[id.split(":")[0]] ?? [] : bundle.children[id] ?? []);
  const graph: Graph = { bundle, nodes, parents, preds, parsed, refIndex, flowPages, docCodes, kids, node: (id) => nodes.get(id) };
  // The first page of the algorithm (or of a disease) is entered from the start, whatever the boxes
  // that lead back to it say: its only entry box carries the conditions of those boxes ("inherited
  // from the link": NSCL-1 "NSCLC" requires N0 and M1a, the stage IVA box of NSCL-11 that loops back),
  // which would rule the page out for every patient who starts there.
  for (const h of entryHeads(graph)) {
    const roots = bundle.roots[h] ?? [];
    if (roots.length === 1 && nodes.get(roots[0])?.review === "inherited") delete preds[roots[0]];
  }
  return graph;
}

/** Where a page code ("PROS-9", "PROS-F", "PROS-9A", "MS-12", "ST-1") leads. */
export function resolveRef(g: Graph, code: string): Target {
  if (g.bundle.pages[code]) return { type: "flow", page: code };
  if (g.bundle.docs?.[code]) return { type: "doc", code };
  const fn = code.match(/^(.+-\d+)A$/);
  if (fn && g.bundle.pages[fn[1]]) return { type: "flow", page: fn[1] };
  // Multi-part algorithm pages are keyed by page id ("GALL-4 1 of 3"): a bare code opens part 1.
  const part = g.flowPages.find((p) => p.startsWith(code + " "));
  if (part) return { type: "flow", page: part };
  // A page of another guideline ("DIS-A" -> distress_management), opened through the library.
  const slug = g.bundle.prefixes?.[code.split("-")[0]];
  if (slug) return { type: "external", slug, code };
  return { type: "none" };
}

/** The later state a page title names ("Recurrence", "Surveillance After Completion"); null for an ordinary page. */
export type PageState = "diagnosis" | "followup" | "recurrence" | "advanced" | "later";
export function stateOfTitle(title: string): PageState | null {
  const t = title.toLowerCase();
  if (/recurren|relaps|refractor|progress|persist|second biochemical|bcr2|transformation/.test(t)) return "recurrence";
  if (/metasta|stage iv|\badvanced\b|castration|crpc|\bm1\b|unresectable/.test(t)) return "advanced";
  if (/surveillance|follow-?up|post-?treatment|survivorship/.test(t)) return "followup";
  if (/subsequent|second-line|later line/.test(t)) return "later";
  return null;
}

/** Words that make "recurrence" part of a risk, a score or a finding rather than a state ("high risk for systemic recurrence"). */
const RISK_OF_RECURRENCE = /\b(?:risk|high[- ]risk|low[- ]risk|probability|chance)\b[^.;,()]{0,25}\brecurren\w*|\brecurrence[- ](?:free|score|risk)\b/gi;
export const withoutRisk = (t: string) => t.replace(RISK_OF_RECURRENCE, " ");

/**
 * Every state a page title names, in the order recurrence, advanced, follow-up, later. A title can
 * name two ("Stage IV (M1) or Recurrent Disease"), and the page then serves both needs.
 */
export function statesOfTitle(title: string): PageState[] {
  const t = withoutRisk(title.toLowerCase());
  const out: PageState[] = [];
  if (/recurren|relaps|refractor|progress|persist|second biochemical|bcr2|transformation/.test(t)) out.push("recurrence");
  if (/metasta|stage iv|\badvanced\b|castration|crpc|\bm1\b|unresectable/.test(t)) out.push("advanced");
  // (follow-up and later line are what is left when the title names no disease state: "Stage IV
  // Surveillance" is about the disease, "Subsequent Treatment" after locally advanced disease is not a later line)
  if (!out.length && /surveillance|follow-?up|post-?treatment|survivorship/.test(t)) out.push("followup");
  if (!out.length && /subsequent|second-line|later line/.test(t)) out.push("later");
  return out;
}

/** Does a page title say the patient has had surgery (pathologic stage, findings at surgery, postoperative)? */
export const isPostSurgicalTitle = (title: string) =>
  /pathologic|post-?surg|post-?operative|after (?:upfront |initial )?(?:surgery|resection|\w+ectomy)|findings at surgery|surgical findings/i.test(title);

/**
 * The state a page belongs to by what its entry boxes say, when its title does not: a page titled
 * "Radical Prostatectomy PSA" opens on "PSA persistence/recurrence". Only short entry boxes count
 * (a long box describing a state says more than the moment), and only the recurrence words: other
 * states are named in titles.
 */
export function stateOfEntries(g: Graph, page: string): PageState | null {
  for (const r of g.bundle.roots[page] ?? []) {
    const t = (g.node(r)?.text ?? "").replace(/\s+/g, " ").trim();
    if (t.length <= 70 && /recurren|relaps|refractor|progress|persist/i.test(t)) return "recurrence";
  }
  return null;
}

/**
 * Where a disease of a multi-disease guideline starts: its own algorithm pages (the section map)
 * that have entry boxes and are not led to by another of its pages. The shared pages ahead of them
 * (a diagnostic-testing page listing every disease) belong to no disease and are not starts.
 */
export function sectionStartPages(g: Graph, section: string): string[] {
  const sec = g.bundle.sections;
  if (!sec) return [];
  const own = g.flowPages.filter((p) => (sec.pages?.[p] ?? null) === section && (g.bundle.roots[p] ?? []).length);
  const leadsTo = new Map<string, Set<string>>();
  const link = (q: string, p: string) => { if (p !== q) (leadsTo.get(q) ?? leadsTo.set(q, new Set()).get(q)!).add(p); };
  for (const [id, ks] of Object.entries(g.bundle.children)) ks.forEach((k) => link(id.split(":")[0], k.split(":")[0]));
  g.bundle.links.forEach(([q, p]) => link(q, p));
  const starts = own.filter((p) => !own.some((q) => q !== p && leadsTo.get(q)?.has(p)));
  if (starts.length || !own.length) return starts;
  // Every own page is led to by another (a later page loops back to the first, e.g. OV-6 → OV-1):
  // start at the first page, in guideline order, of each group no other own page leads into.
  const ownSet = new Set(own);
  const reach = (p: string) => {
    const seen = new Set([p]), st = [p];
    while (st.length) for (const q of leadsTo.get(st.pop()!) ?? []) if (ownSet.has(q) && !seen.has(q)) { seen.add(q); st.push(q); }
    return seen;
  };
  const r = new Map(own.map((p) => [p, reach(p)]));
  const out: string[] = [];
  for (const p of own) {
    const fromOutside = own.some((q) => r.get(q)!.has(p) && !r.get(p)!.has(q));
    if (!fromOutside && !out.some((s) => r.get(s)!.has(p))) out.push(p);
  }
  return out;
}

/**
 * The first pages of the algorithm, group by group: those of the pages that belong to no disease
 * (nothing at all leads to them) and, in a multi-disease guideline, those of each disease (nothing
 * of its own leads to them: the shared pages ahead of them do not count). One list per group.
 */
export function entryHeadGroups(g: Graph): string[][] {
  const sec = g.bundle.sections;
  const secOf = (p: string) => (sec?.pages?.[p] ?? null) as string | null;
  const later = (p: string) => statesOfTitle(g.bundle.pages[p]?.title || "").length > 0;
  if (!sec) return [startHeads(g, g.flowPages, { later })];
  return [
    startHeads(g, g.flowPages, { later }).filter((p) => secOf(p) === null),
    ...sec.values.map((v) => startHeads(g, g.flowPages.filter((p) => secOf(p) === v), { later })),
  ];
}
const headCache = new WeakMap<Graph, string[][]>();
export const entryHeadsByGroup = (g: Graph): string[][] => {
  let groups = headCache.get(g);
  if (!groups) headCache.set(g, (groups = entryHeadGroups(g)));
  return groups;
};
export const entryHeads = (g: Graph): string[] => entryHeadsByGroup(g).flat();

/** Ancestors and descendants of the selected answers (across linked pages). */
export function pathSets(g: Graph, answers: Iterable<string>) {
  const nodes = new Set<string>(), edges = new Set<string>();
  const walk = (start: string, next: (x: string) => string[], fwd: boolean) => {
    const seen = new Set([start]), st = [start];
    while (st.length) {
      const x = st.pop()!;
      nodes.add(x);
      for (const y of next(x)) {
        edges.add(fwd ? `${x}>${y}` : `${y}>${x}`);
        if (!seen.has(y)) { seen.add(y); st.push(y); }
      }
    }
  };
  for (const a of answers) { walk(a, (x) => g.bundle.children[x] ?? [], true); walk(a, (x) => g.parents[x] ?? [], false); }
  return { nodes, edges };
}

/* ---------------- where a guideline (or one of its diseases) starts ---------------- */

/** Page-to-page leads: arrows between boxes of different pages, and the box links. */
const linkCache = new WeakMap<Graph, Map<string, Set<string>>>();
export function pageLeads(g: Graph): Map<string, Set<string>> {
  let m = linkCache.get(g);
  if (m) return m;
  m = new Map();
  const link = (q: string, p: string) => { if (p !== q && g.bundle.pages[p] && g.bundle.pages[q]) (m!.get(q) ?? m!.set(q, new Set()).get(q)!).add(p); };
  for (const [id, ks] of Object.entries(g.bundle.children)) ks.forEach((k) => link(id.split(":")[0], k.split(":")[0]));
  g.bundle.links.forEach(([q, p]) => link(q, p));
  linkCache.set(g, m);
  return m;
}

/**
 * The first pages of the algorithm among `scope` (a guideline's pages, or those of one disease):
 * the pages with entry boxes that nothing else in the scope leads to, and, where the first page is
 * led back to by later pages (a loop: "NSCL-11 -> NSCL-1"), the earliest page of that loop. Pages
 * without entry boxes (a table that only continues) are passed through. A page is never a head
 * because of the pages outside the scope that lead to it.
 */
export function startHeads(g: Graph, scope: string[], opts: { later?: (p: string) => boolean } = {}): string[] {
  const inScope = new Set(scope);
  const leads = pageLeads(g);
  const rooted = scope.filter((p) => (g.bundle.roots[p] ?? []).length);
  if (!rooted.length) return [];
  const isRooted = new Set(rooted);
  // leads between pages with entry boxes, through the ones without
  const out = new Map<string, Set<string>>();
  for (const q of rooted) {
    const seen = new Set<string>([q]), st = [q];
    const to = new Set<string>();
    while (st.length) for (const n of leads.get(st.pop()!) ?? []) {
      if (!inScope.has(n) || seen.has(n)) continue;
      seen.add(n);
      if (isRooted.has(n)) to.add(n); else st.push(n);
    }
    out.set(q, to);
  }
  // strongly connected groups (Tarjan)
  const index = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), stack: string[] = [];
  const comp = new Map<string, number>(); let n = 0, nc = 0;
  const visit = (v: string) => {
    // iterative to stay clear of the call-stack limit on long chains
    const work: [string, string[], number][] = [[v, [...(out.get(v) ?? [])], 0]];
    index.set(v, n); low.set(v, n); n++; stack.push(v); on.add(v);
    while (work.length) {
      const top = work[work.length - 1];
      const [x, nbr] = top;
      if (top[2] < nbr.length) {
        const y = nbr[top[2]++];
        if (!index.has(y)) { index.set(y, n); low.set(y, n); n++; stack.push(y); on.add(y); work.push([y, [...(out.get(y) ?? [])], 0]); }
        else if (on.has(y)) low.set(x, Math.min(low.get(x)!, index.get(y)!));
      } else {
        work.pop();
        if (work.length) { const px = work[work.length - 1][0]; low.set(px, Math.min(low.get(px)!, low.get(x)!)); }
        if (low.get(x) === index.get(x)) { let w: string; do { w = stack.pop()!; on.delete(w); comp.set(w, nc); } while (w !== x); nc++; }
      }
    }
  };
  for (const v of rooted) if (!index.has(v)) visit(v);
  const members = new Map<number, string[]>();
  for (const [p, c] of comp) (members.get(c) ?? members.set(c, []).get(c)!).push(p);
  const hasInbound = new Set<number>();
  for (const [q, to] of out) for (const p of to) if (comp.get(q) !== comp.get(p)) hasInbound.add(comp.get(p)!);
  const pos = (p: string) => g.bundle.pages[p].pdf ?? Number.MAX_SAFE_INTEGER;
  const early = (a: string, b: string) => pos(a) - pos(b) || natural(a, b);
  const heads: string[] = [];
  for (const [c, ps] of members) {
    if (hasInbound.has(c)) continue;
    if (ps.length === 1) { heads.push(ps[0]); continue; }
    const first = ps.filter((p) => !opts.later?.(p));
    heads.push([...(first.length ? first : ps)].sort(early)[0]);
  }
  return heads.sort(natural);
}
