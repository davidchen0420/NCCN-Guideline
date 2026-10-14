import type { BNode, Bundle, Pred } from "../types";
import { configureRefs, parseBox, parseInline, type Parsed } from "./parseBox";

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

export type Target = { type: "flow"; page: string } | { type: "doc"; code: string } | { type: "none" };

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function buildGraph(bundle: Bundle): Graph {
  const flowPages = Object.keys(bundle.pages).sort(natural);
  configureRefs([...new Set(flowPages.map((p) => p.split("-")[0]))]);

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
  return { type: "none" };
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
