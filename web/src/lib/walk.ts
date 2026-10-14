import type { Facts } from "../types";
import type { Graph } from "./graph";
import { derive, evaluate } from "./predicates";

export interface Step { node: string; by: "entry" | "single-arrow" | "predicate" | "reconverge" | "manual"; unresolved?: string[] }
export interface Walk { path: Step[]; at: string }

const hasFacts = (f: Facts) => Object.values(f).some((v) => v !== null && v !== undefined && v !== "");

function factsDecideNext(g: Graph, kids: string[], facts: Facts, depth = 3): boolean {
  let frontier = [...kids];
  for (let i = 0; i < depth; i++) {
    const next: string[] = [];
    for (const n of frontier) {
      const grand = g.kids(n);
      if (grand.length > 1) {
        const v = grand.map((c) => evaluate(g.preds[c], facts));
        if (v.filter((x) => x === true).length === 1 && !v.includes(null)) return true;
      }
      next.push(...grand);
    }
    frontier = next;
  }
  return false;
}

function reconvergence(g: Graph, kids: string[], depth = 3): string | null {
  const reach = kids.map((k) => {
    let seen: string[] = [], fr = [k];
    for (let i = 0; i < depth; i++) { fr = fr.flatMap((n) => g.kids(n)); seen = seen.concat(fr); }
    return seen;
  });
  return reach[0].find((n) => reach.slice(1).every((r) => r.includes(n))) ?? null;
}

/** Follow every branch the facts decide (mirrors navigator._auto_step). */
export function autoStep(g: Graph, walk: Walk, rawFacts: Facts): Walk {
  if (!hasFacts(rawFacts)) return walk;
  const facts = derive(rawFacts, g.bundle.schema);
  const w: Walk = { path: [...walk.path], at: walk.at };
  for (let guard = 0; guard < 200; guard++) {
    const kids = g.kids(w.at);
    if (!kids.length) break;
    const here = g.node(w.at);
    const last = w.path.length ? w.path[w.path.length - 1].by : null;
    const pass = g.preds[w.at] || (here && here.links.length > 0) || last === "entry" || factsDecideNext(g, kids, facts);
    if (kids.length === 1 && !g.preds[kids[0]] && pass) { w.path.push({ node: kids[0], by: "single-arrow" }); w.at = kids[0]; continue; }
    const v = kids.map((c) => evaluate(g.preds[c], facts));
    const trues = kids.filter((_, i) => v[i] === true);
    if (trues.length === 1 && !v.includes(null)) { w.path.push({ node: trues[0], by: "predicate" }); w.at = trues[0]; continue; }
    const merge = kids.length > 1 && v.includes(null) && !trues.length ? reconvergence(g, kids) : null;
    if (merge) { w.path.push({ node: merge, by: "reconverge", unresolved: kids }); w.at = merge; continue; }
    break;
  }
  return w;
}

export function startWalk(g: Graph, page: string, nodeId: string | null, facts: Facts): Walk | null {
  const roots = g.bundle.roots[page] ?? [];
  let at: string;
  if (nodeId) at = nodeId;
  else if (roots.length === 1) at = roots[0];
  else if (roots.length) at = `${page}:START`;
  else return null;
  return autoStep(g, { path: [{ node: at, by: "entry" }], at }, facts);
}

export const choose = (g: Graph, w: Walk, child: string, facts: Facts): Walk =>
  autoStep(g, { path: [...w.path, { node: child, by: "manual" }], at: child }, facts);

export function verdicts(g: Graph, kids: string[], facts: Facts): Record<string, boolean | null> {
  const f = derive(facts, g.bundle.schema);
  return Object.fromEntries(kids.map((c) => [c, hasFacts(facts) ? evaluate(g.preds[c], f) : null]));
}
