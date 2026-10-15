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
  return { bundle, nodes, parents, preds, parsed, refIndex, flowPages, docCodes, kids, node: (id) => nodes.get(id) };
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
  return own.filter((p) => !own.some((q) => q !== p && leadsTo.get(q)?.has(p)));
}

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
