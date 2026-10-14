/**
 * Ranked candidate pathways for a patient.
 *
 * Walks every route through the decision graph from the entry boxes, the way
 * navigator._auto_step does, but keeps all branches the entered facts do not rule out
 * instead of stopping at the first undecided one. Each route gets:
 *
 * - likelihood: its share of the probability mass. At a branch, children whose condition is
 *   true share it equally; children that cannot be decided yet (missing facts, or no encoded
 *   condition) share it equally when nothing is true, and get a small residual share when a
 *   sibling is already true. Children the facts contradict are pruned. Shares multiply along
 *   the route and are normalised over all routes. This expresses the guideline's structure and
 *   the facts entered, not an outcome probability.
 * - criteria: how many encoded conditions on the route the facts satisfy, versus how many are
 *   still open.
 * - confidence (0-100): criteria coverage times encoding reliability, where reliability is the
 *   mean over steps of the arrow's evidence (both extractors agree / image-verified / one
 *   extractor only) and the condition's review status.
 */
import type { Facts, Pred } from "../types";
import type { Graph } from "./graph";
import { derive, evaluate } from "./predicates";

export type StepKind = "met" | "otherwise" | "unknown" | "option" | "inferred" | "flow";
export type EdgeKind = "agreed" | "verified" | "unsure" | "link" | "entry";
export interface PStep { node: string; kind: StepKind; missing: string[]; edge: EdgeKind; share: number }
export type EndKind = "leaf" | "later" | "limit";
export interface Pathway {
  id: string; steps: PStep[]; end: EndKind; next: string[];
  weight: number; likelihood: number;
  met: number; open: number; options: number;
  coverage: number; encoding: number; confidence: number;
  missing: string[];
}
export interface Ranking {
  paths: Pathway[]; ruledOut: number; entries: string[]; truncated: boolean;
  nextBest: { fact: string; share: number } | null;
}

const RESIDUAL = 0.15; // share of an undecided sibling when another sibling is already true
const MAX_PATHS = 4000;
const MAX_DEPTH = 80;
const EDGE_W: Record<EdgeKind, number> = { agreed: 1, verified: 0.95, unsure: 0.7, link: 1, entry: 1 };
const REVIEW_W = { reviewed: 1, draft: 0.85 } as const;

export const hasFacts = (f: Facts) => Object.values(f).some((v) => v !== null && v !== undefined && v !== "");

function factsUsed(p: Pred | null | undefined, out = new Set<string>()): Set<string> {
  if (!p) return out;
  if ("all" in p) p.all.forEach((x) => factsUsed(x, out));
  else if ("any" in p) p.any.forEach((x) => factsUsed(x, out));
  else if ("not" in p) factsUsed(p.not, out);
  else out.add(p.fact);
  return out;
}

/** Raw schema variables that are still unknown and would help decide `pred`. */
export function missingFacts(g: Graph, pred: Pred | null | undefined, facts: Facts, seen = new Set<string>()): string[] {
  const schema = g.bundle.schema;
  const out = new Set<string>();
  for (const name of factsUsed(pred)) {
    if (seen.has(name)) continue;
    seen.add(name);
    const v = facts[name];
    if (v !== undefined && v !== null && v !== "unknown") continue;
    if (schema.variables[name]) { if (!name.endsWith("_stated")) out.add(name); continue; }
    const d = schema.derived?.[name];
    if (d) d.rules.forEach((r) => missingFacts(g, r.if, facts, seen).forEach((x) => out.add(x)));
  }
  return [...out];
}

/**
 * Does a box or page title name the patient's value of an enum fact ("Radical prostatectomy"
 * for definitive_treatment_received), or a different value of it ("Radiation therapy
 * recurrence")? Each fact votes on its own, so one fact's match never cancels another's conflict.
 */
function textMatches(g: Graph, text: string, facts: Facts): { mine: boolean; other: boolean } {
  const t = text.toLowerCase();
  let mine = false, other = false;
  for (const [name, spec] of Object.entries(g.bundle.schema.variables)) {
    if (spec.type !== "enum" || facts[name] === undefined) continue;
    let own = false, diff = false;
    for (const val of spec.values ?? []) {
      const phrase = val.replace(/_/g, " ");
      if (val === "other" || val === "none" || phrase.length < 8 || !t.includes(phrase)) continue;
      if (val === facts[name]) own = true; else diff = true;
    }
    // Naming several values ("metachronous or synchronous") does not discriminate.
    if (own && !diff) mine = true;
    else if (diff && !own) other = true;
  }
  return { mine, other };
}

export function rankPathways(g: Graph, raw: Facts, start: string | "auto" = "auto"): Ranking {
  const empty: Ranking = { paths: [], ruledOut: 0, entries: [], truncated: false, nextBest: null };
  if (start === "auto" && !hasFacts(raw)) return empty;
  const facts = derive(raw, g.bundle.schema);
  const edgeKind = new Map<string, EdgeKind>();
  for (const [page, fp] of Object.entries(g.bundle.pages))
    fp.edges.forEach((e) => edgeKind.set(`${page}:${e.src}>${page}:${e.dst}`, e.cls));
  const reviewW = (id: string) => (g.preds[id] ? REVIEW_W[g.node(id)?.review === "reviewed" ? "reviewed" : "draft"] : 1);
  const verdict = (id: string): boolean | null | "none" => (g.preds[id] ? evaluate(g.preds[id], facts) : "none");
  const linksOut = (id: string) => (g.node(id)?.links ?? []).some((l) => g.bundle.pages[l] && l !== id.split(":")[0]);

  const done: Omit<Pathway, "likelihood">[] = [];
  let ruledOut = 0, truncated = false;

  const finish = (steps: PStep[], weight: number, end: EndKind, next: string[] = []) => {
    if (done.length >= MAX_PATHS) { truncated = true; return; }
    const crit = steps.filter((s) => s.kind !== "flow" && s.kind !== "option");
    const met = crit.filter((s) => s.kind !== "unknown").length;
    const open = crit.length - met;
    const coverage = crit.length ? met / crit.length : 0;
    const encoding = steps.reduce((a, s) => a + EDGE_W[s.edge] * reviewW(s.node), 0) / steps.length;
    const missing = [...new Set(steps.flatMap((s) => s.missing))];
    done.push({
      id: steps.map((s) => s.node).join(">"), steps, end, next, weight,
      met, open, options: steps.filter((s) => s.kind === "option").length,
      coverage, encoding, confidence: Math.round(100 * coverage * encoding), missing,
    });
  };

  type Group = { id: string; pre: string[] };
  const and = (vs: (boolean | null | "none")[]): boolean | null | "none" => {
    const xs = vs.filter((x) => x !== "none");
    return !xs.length ? "none" : xs.includes(false) ? false : xs.includes(null) ? null : true;
  };
  const gVerdict = (gr: Group) => and([verdict(gr.id), ...gr.pre.map(verdict)]);
  const yMid = (id: string) => { const b = g.node(id)?.bbox; return b ? (b[1] + b[3]) / 2 : 0; };

  /**
   * Table pages (PROS-2) are flattened into one box per cell: a risk-group box fans out to its
   * row's criteria cells (conditions with no further arrow), workup notes and the "PROS-4" cell
   * that continues. Criteria and notes are attached to the nearest continuing cell in the same
   * row, which then applies only when its row's criteria hold.
   */
  const rowGroups = (kids: string[]): Group[] => {
    const leaf = (k: string) => g.kids(k).length === 0;
    const crit = kids.filter((k) => g.preds[k] && leaf(k));
    const rest = kids.filter((k) => !crit.includes(k));
    if (!crit.length || !rest.length) return kids.map((id) => ({ id, pre: [] }));
    const cont = rest.filter((k) => !leaf(k));
    const pool = cont.length ? cont : rest;
    const notes = cont.length ? rest.filter((k) => leaf(k) && !g.preds[k]) : [];
    const groups = new Map(pool.map((id) => [id, [] as string[]]));
    for (const k of [...crit, ...notes]) {
      const near = pool.reduce((best, t) => (Math.abs(yMid(t) - yMid(k)) < Math.abs(yMid(best) - yMid(k)) ? t : best), pool[0]);
      groups.get(near)!.push(k);
    }
    return [...groups.entries()].map(([id, pre]) => ({ id, pre: pre.sort((x, y) => yMid(x) - yMid(y)) }))
      .concat(rest.filter((k) => !pool.includes(k) && !notes.includes(k)).map((id) => ({ id, pre: [] })));
  };

  /** Score the children of a branch: which are possible, and with what share. */
  const split = (groups: Group[]) => {
    const v = groups.map(gVerdict);
    const tr = groups.filter((_, i) => v[i] === true);
    const fl = groups.filter((_, i) => v[i] === false);
    const unk = groups.filter((_, i) => v[i] === null);
    const none = groups.filter((_, i) => v[i] === "none");
    ruledOut += fl.length;
    type Opt = { gr: Group; kind: StepKind; share: number };
    // "Otherwise" arm: every conditioned sibling is false and exactly one has no condition.
    if (!tr.length && !unk.length && none.length === 1 && fl.length) return [{ gr: none[0], kind: "otherwise", share: 1 }] as Opt[];
    const out: Opt[] = [];
    tr.forEach((gr) => out.push({ gr, kind: "met", share: 1 }));
    unk.forEach((gr) => out.push({ gr, kind: "unknown", share: tr.length ? RESIDUAL : 1 }));
    if (none.length) {
      const m = none.map((gr) => textMatches(g, g.node(gr.id)?.text ?? "", raw));
      const anyMine = m.some((x) => x.mine);
      none.forEach((gr, i) => {
        if (m[i].mine) out.push({ gr, kind: "inferred", share: tr.length ? RESIDUAL : 1 });
        else out.push({ gr, kind: "option", share: (tr.length || anyMine ? RESIDUAL : 1) * (m[i].other ? 0.5 : 1) });
      });
    }
    const total = out.reduce((a, x) => a + x.share, 0) || 1;
    return out.map((x) => ({ ...x, share: x.share / total }));
  };

  const stepFor = (parent: string | null, k: string, kind: StepKind, share: number): PStep => ({
    node: k, kind, share,
    missing: kind === "unknown" ? missingFacts(g, g.preds[k], facts) : [],
    edge: parent === null ? "entry" : edgeKind.get(`${parent}>${k}`) ?? (k.split(":")[0] !== parent.split(":")[0] ? "link" : "agreed"),
  });
  const preSteps = (parent: string | null, gr: Group) => gr.pre.map((p) => {
    const v = verdict(p);
    return stepFor(parent, p, v === true ? "met" : v === null ? "unknown" : "flow", 1);
  });
  /** A row's own cell: met/unknown come from its criteria when it has no condition itself. */
  const targetKind = (gr: Group, kind: StepKind): StepKind => (gr.pre.length && !g.preds[gr.id] && (kind === "met" || kind === "unknown") ? "flow" : kind);

  const dfs = (id: string, steps: PStep[], weight: number, seen: Set<string>) => {
    if (truncated) return;
    if (steps.length > MAX_DEPTH) return finish(steps, weight, "limit");
    const kids = g.kids(id).filter((k) => !seen.has(k));
    if (!kids.length) return finish(steps, weight, "leaf");
    // Mirrors navigator._auto_step: undecided arms are explored only out of a condition box
    // (or an entry); a single plain arrow is followed out of a condition, a page reference, or
    // the box right after a condition (a workup step). Out of a recommendation, arrows lead to
    // later events, so the route ends there.
    const isCond = (n: string, i: number) =>
      !!g.preds[n] || i === 0 || (g.bundle.roots[n.split(":")[0]] ?? []).includes(n) || /\?\s*$/.test(g.node(n)?.text ?? "");
    const cond = isCond(id, steps.length - 1);
    const pass = cond || linksOut(id) || (steps.length > 1 && isCond(steps[steps.length - 2].node, steps.length - 2));
    const go = (gr: Group, kind: StepKind, share: number) => {
      const nx = new Set(seen); gr.pre.forEach((p) => nx.add(p)); nx.add(gr.id);
      const add = [...preSteps(id, gr), stepFor(id, gr.id, targetKind(gr, kind), share)];
      dfs(gr.id, [...steps, ...add], weight * share, nx);
    };
    const groups = rowGroups(kids);
    const v = groups.map(gVerdict);
    if (v.every((x) => x === false)) {
      ruledOut += groups.length;
      // Out of a condition box, no arm fits: this route contradicts the facts. Out of a
      // recommendation, the arms are later events that have not happened (or not like this).
      return cond ? undefined : finish(steps, weight, "later", kids);
    }
    if (groups.length === 1) {
      const gr = groups[0];
      if (v[0] === true) return go(gr, "met", 1);
      if (v[0] === null) return cond ? go(gr, "unknown", 1) : finish(steps, weight, "later", kids);
      return pass ? go(gr, "flow", 1) : finish(steps, weight, "later", kids);
    }
    const opts = split(groups);
    // After a recommendation, children with open conditions describe later events (recurrence,
    // response): the route ends here unless the facts already say which one happened.
    if (!cond && !opts.some((o) => o.kind === "met" || o.kind === "otherwise") && opts.some((o) => o.kind === "unknown"))
      return finish(steps, weight, "later", kids);
    opts.forEach((o) => go(o.gr, o.kind, o.share));
  };

  const explore = (entries: string[]) => {
    split(entries.map((id) => ({ id, pre: [] }))).forEach((o) =>
      dfs(o.gr.id, [stepFor(null, o.gr.id, o.kind, o.share)], o.share, new Set([o.gr.id])));
  };

  let entries: string[];
  if (start === "auto") {
    const first = g.flowPages[0];
    entries = [...(g.bundle.roots[first] ?? [])];
    explore(entries);
    // Page-level links: a box on page q continues on p's entry boxes or refers to page p.
    const out = new Map<string, Set<string>>();
    const link = (q: string, p: string) => { if (p !== q && g.bundle.pages[p]) (out.get(q) ?? out.set(q, new Set()).get(q)!).add(p); };
    for (const [id, ks] of Object.entries(g.bundle.children)) ks.forEach((k) => link(id.split(":")[0], k.split(":")[0]));
    g.bundle.links.forEach(([q, p]) => link(q, p));
    for (const [code, hits] of g.refIndex) hits.forEach((h) => link(h.page, code));
    const reaches = (from: string, to: string) => {
      const seen = new Set([from]), st = [from];
      while (st.length) for (const n of out.get(st.pop()!) ?? []) { if (n === to) return true; if (!seen.has(n)) { seen.add(n); st.push(n); } }
      return false;
    };
    // Entry boxes elsewhere that the facts select directly (e.g. "PSA recurrence") start their
    // own routes, unless: the walk already reached them or passed through a page that leads
    // there (it decided that branch); the page title names a different value of a fact the
    // patient has ("Radiation therapy recurrence" for a prostatectomy patient); or another
    // selected page lies later on the same route (initial-therapy pages are history for a
    // patient whose current state is a recurrence).
    const reachedNodes = new Set(done.flatMap((d) => d.steps.map((st) => st.node)));
    const reachedPages = new Set([...reachedNodes].map((n) => n.split(":")[0]));
    const cands = g.flowPages.filter((p) => {
      if (p === first || [...reachedPages].some((q) => q !== p && out.get(q)?.has(p))) return false;
      if (textMatches(g, g.bundle.pages[p].title ?? "", raw).other) return false;
      return (g.bundle.roots[p] ?? []).some((r) => !reachedNodes.has(r) && verdict(r) === true);
    });
    const later = cands.filter((p) => !cands.some((q) => q !== p && reaches(p, q)));
    if (later.length) {
      // The patient is past initial diagnosis: routes from the first page that never reach a
      // selected later-state page describe history, not the current decision.
      const keep = done.filter((d) => d.steps.some((st) => later.includes(st.node.split(":")[0])));
      done.length = 0; done.push(...keep);
      entries = keep.length ? [...new Set(keep.map((d) => d.steps[0].node))] : [];
    }
    for (const p of later) {
      const extra = (g.bundle.roots[p] ?? []).filter((r) => !reachedNodes.has(r) && verdict(r) === true);
      explore(extra);
      entries = entries.concat(extra);
    }
  } else {
    entries = g.bundle.roots[start] ?? [];
    explore(entries);
  }

  const total = done.reduce((a, p) => a + p.weight, 0) || 1;
  const paths = done.map((p) => ({ ...p, likelihood: p.weight / total }))
    .sort((a, b) => b.likelihood - a.likelihood || b.confidence - a.confidence || a.steps.length - b.steps.length);

  const by = new Map<string, number>();
  paths.forEach((p) => p.missing.forEach((m) => by.set(m, (by.get(m) ?? 0) + p.likelihood)));
  const best = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  return { paths, ruledOut, entries, truncated, nextBest: best ? { fact: best[0], share: best[1] } : null };
}

/** Likelihood band in words, so the number is not read as a clinical probability. */
export const likelihoodWord = (x: number) => (x >= 0.5 ? "Most likely" : x >= 0.2 ? "Possible" : x >= 0.05 ? "Less likely" : "Unlikely");
export const confidenceWord = (c: number) => (c >= 75 ? "High" : c >= 45 ? "Moderate" : "Low");
