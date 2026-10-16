/**
 * The AI-assisted walk: follow a guideline from an entry box, deciding each branch by
 *
 *  1. the clinician's override for that node, if there is one;
 *  2. the encoded conditions: a child whose condition is true is followed, one whose condition is
 *     false is pruned (as in walk.autoStep);
 *  3. otherwise (conditions that cannot be decided yet, boxes with no encoded condition, several
 *     options at once) the language model's probabilities, through an injectable `score`
 *     function (default: decide.scoreBranches). The top child is followed when it is one of
 *     several mutually exclusive CONDITION arms, its probability reaches the threshold AND leads
 *     the second by AUTO_MARGIN, and its condition does not rest on a detail that was never
 *     entered; otherwise the walk stops and asks. OPTION arms (treatments that can each be
 *     appropriate: radical prostatectomy, or radiotherapy with ADT) are never chosen by the
 *     model: the walk stops there and every option is shown with its probability. A "none of
 *     these" above 0.5 stops with "not enough information" and the details that are missing.
 *
 * When an encoded verdict contradicts a probability at or above the threshold the step is
 * flagged `disagree`; the rule still wins. Rule-decided nodes are only scored when
 * `checkRules` is set (it costs a request each).
 *
 * Where a walk stops, the walk is over: `end` is the node it stopped at, and `options` are that
 * node's children, most probable first, for the clinician to pick from. Nothing here throws:
 * a failing scorer ends the walk with `stoppedFor: "error"`.
 *
 * Nothing is specific to a cancer or a guideline: the graph, the conditions and the page text
 * are all that is read.
 */
import type { Facts } from "../types";
import { boxText, branchChildren, DecideError, isScorable, NONE, scoreBranches, type DecideOptions } from "./decide";
import { remainingQuestions } from "./formAssist";
import type { Graph } from "./graph";
import { missingFacts, rankPathways, splitAlongside } from "./pathways";
import { derive, evaluate } from "./predicates";

export type TrailBy = "rule" | "ai" | "clinician" | "single" | "entry";
export type OptionSource = "rule" | "ai" | "clinician" | "none";

/** One child of a branch, as the decision trail shows it. */
export interface TrailOption {
  child: string;
  text: string;
  /** the encoded condition's verdict: true / false, or null when undecided or not encoded */
  verdict: boolean | null;
  /** the model's probability for this child, when it was asked */
  prob?: number;
  /** where what is shown comes from: the encoded rule (a verdict), the model (a probability), the clinician (the overridden choice), or nothing yet */
  source: OptionSource;
}

/**
 * One step of the walk. For `by: "entry"` the step is the start itself (`node` = `chosen` = the
 * entry box, no options); every other step is a branch: `node` is the box, `chosen` one of its
 * children, and `options` all of its children.
 */
export interface TrailStep {
  node: string;
  page: string;
  chosen: string;
  by: TrailBy;
  /** the probability the model gave the chosen child (by "ai"; also set for other steps when the node was scored) */
  prob?: number;
  /** the model's "none of these applies / not enough information" probability, when asked */
  none?: number;
  options: TrailOption[];
  /** an encoded verdict and a probability at or above the threshold contradicted each other */
  disagree?: boolean;
  /** by "ai": the details the chosen arm's condition rests on that were never entered (the model assumed them) */
  assumed?: string[];
}

export type StoppedFor = "ask" | "not-enough" | "error";

export interface AiWalkResult {
  steps: TrailStep[];
  /** the node the walk ended on or stopped at */
  end: string;
  stoppedFor?: StoppedFor;
  /** the raw details still unknown that would decide the stop (for "not-enough"; best effort for "ask") */
  missing?: string[];
  /** where the walk stopped: that node's children, most probable first (for "ask" and "not-enough") */
  options?: TrailOption[];
  /** the model's "none" probability at the stop */
  none?: number;
  /** the walk stopped at treatment OPTIONS (each may be appropriate): shown side by side, never chosen by the model */
  optionArms?: boolean;
  /** the walk was cut at maxSteps */
  truncated?: boolean;
  /** what went wrong, for "error" */
  error?: string;
}

export type ScoreFn = (g: Graph, facts: Facts, nodeIds: string[]) => Promise<Map<string, Map<string, number>>>;

export interface AiWalkOptions {
  /** probability at or above which the top child is followed without asking (default 0.85) */
  threshold?: number;
  /** the clinician's choices: branch node -> child */
  overrides?: Record<string, string>;
  /** the scorer; default: decide.scoreBranches */
  score?: ScoreFn;
  /** options for the default scorer (fetch, baseUrl, signal) */
  decide?: DecideOptions;
  /** most branches to walk (default 200) */
  maxSteps?: number;
  /** also score nodes the rules decide, to flag disagreements (default false: costs a request per node) */
  checkRules?: boolean;
}

export const DEFAULT_THRESHOLD = 0.85;
/** The model's top condition arm must also lead the runner-up by this much to be followed without asking. */
export const AUTO_MARGIN = 0.15;
const DEFAULT_MAX_STEPS = 200;
/** A "none of these" above this stops the walk. */
export const NONE_STOP = 0.5;

// ---------------------------------------------------------------- the graph, as the walk sees it

interface Ctx {
  g: Graph;
  raw: Facts;
  facts: Facts;
  overrides: Record<string, string>;
  /** the entered answer to the section variable of a multi-disease guideline, if any */
  section: string | null;
  linksOut: (id: string) => boolean;
  kidsOf: (id: string) => string[];
}

function makeCtx(g: Graph, raw: Facts, overrides: Record<string, string>): Ctx {
  const sec = g.bundle.sections;
  const chosen = sec ? raw[sec.variable] : undefined;
  const section = typeof chosen === "string" && sec!.values.includes(chosen) ? chosen : null;
  const inSection = (page: string) => {
    if (!section) return true;
    const s = sec!.pages?.[page] ?? null;
    return s === null || s === section;
  };
  const linksOut = (id: string) => (g.node(id)?.links ?? []).some((l) => g.bundle.pages[l] && l !== id.split(":")[0]);
  /**
   * The children of a box: its arrows (into other diseases' pages, none when the disease is
   * chosen). A box with no arrow that points to another page goes on to that page's entry boxes
   * (as rankPathways does).
   */
  const kidsOf = (id: string): string[] => {
    let ks = [...new Set(g.kids(id))].filter((k) => inSection(k.split(":")[0]));
    if (!ks.length && !g.kids(id).length) {
      const own = id.split(":")[0];
      for (const l of g.node(id)?.links ?? []) {
        if (l === own || !g.bundle.pages[l] || !inSection(l)) continue;
        for (const r of g.bundle.roots[l] ?? []) if (!ks.includes(r)) ks.push(r);
      }
    }
    return ks;
  };
  return { g, raw, facts: derive(raw, g.bundle.schema), overrides, section, linksOut, kidsOf };
}

/** The children the walk would consider at a box (the arrows, or the entry boxes of the page it points to). */
export const walkChildren = (g: Graph, nodeId: string, facts: Facts = {}): string[] => makeCtx(g, facts, {}).kidsOf(nodeId);

/** Where the walk starts: the entry box of a page (or the page's virtual START when it has several), a node id, or "auto". */
export function entryNode(g: Graph, start: string): string | null {
  if (start.includes(":")) return start.endsWith(":START") || g.node(start) ? start : null;
  let page = start;
  if (start === "auto") {
    const linked = new Set<string>();
    for (const [id, ks] of Object.entries(g.bundle.children)) ks.forEach((k) => { if (k.split(":")[0] !== id.split(":")[0]) linked.add(k.split(":")[0]); });
    g.bundle.links.forEach(([q, p]) => { if (q !== p) linked.add(p); });
    const withRoots = g.flowPages.filter((p) => (g.bundle.roots[p] ?? []).length);
    page = withRoots.find((p) => !linked.has(p)) ?? withRoots[0] ?? "";
  }
  const roots = g.bundle.roots[page] ?? [];
  return roots.length === 1 ? roots[0] : roots.length ? `${page}:START` : null;
}

const pageOf = (id: string) => id.split(":")[0];
const textOf = (g: Graph, id: string) => (g.node(id) ? boxText(g.node(id)!.text) || id : id);

// ---------------------------------------------------------------- one branch, by the rules

type Analysis =
  | { t: "end" }
  | { t: "follow"; chosen: string; by: "rule" | "single" | "clinician"; options: TrailOption[]; branch: boolean }
  | { t: "stop"; why: "ask" | "not-enough"; options: TrailOption[]; missing: string[] }
  | { t: "ai"; kids: string[]; cands: string[]; options: TrailOption[]; optionArms: boolean };

const sortOptions = (xs: TrailOption[]): TrailOption[] =>
  xs.map((o, i) => [o, i] as const)
    .sort(([a, i], [b, j]) => Number(a.verdict === false) - Number(b.verdict === false) || (b.prob ?? -1) - (a.prob ?? -1) || i - j)
    .map(([o]) => o);

/**
 * An option the patient has already had ("the patient received this", encoded on treatment boxes
 * of structured guidelines) counts as its own true condition, as in pathways.rankPathways, so the
 * walk and the recommendation follow the same route.
 */
function receivedVerdict(ctx: Ctx, child: string): boolean | null {
  const r = ctx.g.bundle.structured ? ctx.g.node(child)?.received : null;
  return r && evaluate(r, ctx.facts) === true ? true : null;
}

/** The rule verdict of every child, and the options as the trail shows them (no probabilities yet). */
function optionsOf(ctx: Ctx, kids: string[]): { v: (boolean | null)[]; options: TrailOption[] } {
  const v = kids.map((c) => (ctx.g.preds[c] ? evaluate(ctx.g.preds[c], ctx.facts) : receivedVerdict(ctx, c)));
  return { v, options: kids.map((c, i) => ({ child: c, text: textOf(ctx.g, c), verdict: v[i], source: v[i] === null ? "none" : "rule" }) as TrailOption) };
}

/** Raw details whose answers would decide the (not yet false) children's conditions. */
function missingOf(ctx: Ctx, kids: string[], v: (boolean | null)[]): string[] {
  const out = new Set<string>();
  kids.forEach((c, i) => { if (v[i] !== false && ctx.g.preds[c]) missingFacts(ctx.g, ctx.g.preds[c], ctx.raw).forEach((m) => out.add(m)); });
  return [...out];
}

/**
 * Decide one box by the clinician's choice and the encoded rules; say what is left for the model
 * (or the clinician). `path` is the nodes walked so far, ending with `at`.
 */
function analyse(ctx: Ctx, at: string, path: string[], seen: Set<string>): Analysis {
  const g = ctx.g;
  let kids = ctx.kidsOf(at).filter((k) => !seen.has(k));
  if (!kids.length) return { t: "end" };
  // In a treatment table, the condition rows are the arms; a recommendation row beside them
  // (e.g. "For stage II and III … start aspirin") applies alongside, it is not a branch.
  kids = splitAlongside(g, kids).main;
  const { v, options } = optionsOf(ctx, kids);

  const ov = ctx.overrides[at];
  if (ov && kids.includes(ov)) {
    return { t: "follow", chosen: ov, by: "clinician", branch: kids.length > 1, options: options.map((o) => (o.child === ov ? { ...o, source: "clinician" as const } : o)) };
  }

  // Mirrors pathways: a branch is a decision when it hangs on a condition, an entry, a question,
  // a table cell or a link; after a plain recommendation the arrows lead to later events.
  const isCond = (n: string, i: number) =>
    !!g.preds[n] || i === 0 || (g.bundle.roots[pageOf(n)] ?? []).includes(n) || /\?\s*$/.test(g.node(n)?.text ?? "");
  const i = path.length - 1;
  const cond = isCond(at, i);
  const tableCell = /^table_/.test(g.node(at)?.role ?? "");
  const pass = cond || tableCell || ctx.linksOut(at) || (i >= 1 && isCond(path[i - 1], i - 1));

  if (kids.length === 1) {
    const [k] = kids;
    if (!g.preds[k]) return pass ? { t: "follow", chosen: k, by: "single", options, branch: false } : { t: "end" };
    if (v[0] === true) return { t: "follow", chosen: k, by: "rule", options, branch: false };
    if (!pass) return { t: "end" };
    if (v[0] === false) return { t: "stop", why: "ask", options: sortOptions(options), missing: [] };
    return cond || ctx.linksOut(at)
      ? { t: "stop", why: "not-enough", options, missing: missingOf(ctx, kids, v) }
      : { t: "end" };
  }

  const trues = kids.filter((_, j) => v[j] === true);
  const unknownCoded = kids.filter((c, j) => g.preds[c] && v[j] === null);
  const uncoded = kids.filter((c) => !g.preds[c]);
  // One condition is true and no other encoded condition is open: it is the branch.
  if (trues.length === 1 && !unknownCoded.length) return { t: "follow", chosen: trues[0], by: "rule", options, branch: true };
  // "Otherwise": every encoded condition is false and exactly one box has none.
  if (!trues.length && !unknownCoded.length && uncoded.length === 1 && v.includes(false)) {
    const k = uncoded[0];
    return { t: "follow", chosen: k, by: "rule", branch: true, options: options.map((o) => (o.child === k ? { ...o, verdict: true, source: "rule" as const } : o)) };
  }
  // After a recommendation, undecided arms are later events: the plan ends here.
  if (!pass) return { t: "end" };
  const cands = trues.length > 1 ? trues : kids.filter((_, j) => v[j] !== false);
  if (!cands.length) return { t: "stop", why: "ask", options: sortOptions(options), missing: [] };
  // Treatment options are independent of each other (each may be appropriate): the model does not pick one.
  const optionArms = branchChildren(g, at).opts.some((o) => cands.includes(o));
  return { t: "ai", kids, cands, options, optionArms };
}

// ---------------------------------------------------------------- applying probabilities

/** Put the model's probabilities on the options (an option keeps its rule verdict as the source). */
function withProbs(options: TrailOption[], m: Map<string, number> | undefined): TrailOption[] {
  if (!m) return options;
  return options.map((o) => {
    const p = m.get(o.child);
    return typeof p === "number" ? { ...o, prob: p, source: o.verdict === null && o.source !== "clinician" ? "ai" : o.source } : o;
  });
}

/** The child with the highest probability (the first of equals), among `among`. */
function top(options: TrailOption[], among: string[]): TrailOption | null {
  let best: TrailOption | null = null;
  for (const o of options) if (among.includes(o.child) && typeof o.prob === "number" && (!best || o.prob > best.prob!)) best = o;
  return best;
}

/** Did the model strongly prefer another child than the one chosen? */
function disagrees(options: TrailOption[], chosen: string, threshold: number): boolean {
  const t = top(options, options.map((o) => o.child));
  return !!t && t.child !== chosen && t.prob! >= threshold;
}

/** The highest probability among the options other than `child` (0 when it is the only one scored). */
function runnerUp(options: TrailOption[], child: string): number {
  let best = 0;
  for (const o of options) if (o.child !== child && typeof o.prob === "number" && o.prob > best) best = o.prob;
  return best;
}

/** The details a clinician can still be asked for: not those already answered "don't know". */
const askable = (ctx: Ctx, names: string[]): string[] => names.filter((m) => ctx.raw[m] !== "unknown");

const pickOptions = (map: Map<string, Map<string, number>>, at: string) => {
  const m = map.get(at);
  return m && m.size ? m : undefined;
};

// ---------------------------------------------------------------- drivers

function newTrail(g: Graph, start: string): { at: string; steps: TrailStep[] } | null {
  const at = entryNode(g, start);
  if (!at) return null;
  return { at, steps: [{ node: at, page: pageOf(at), chosen: at, by: "entry", options: [] }] };
}

const fail = (start: string, error: string): AiWalkResult => ({ steps: [], end: start, stoppedFor: "error", error });

/**
 * The walk by the clinician's choices and the encoded rules only, with no model: the same trail
 * (by rule / clinician / single), stopping at the first branch they do not decide.
 */
export function rulesOnlyTrail(g: Graph, facts: Facts, start: string, overrides: Record<string, string> = {}, maxSteps = DEFAULT_MAX_STEPS): AiWalkResult {
  const t = newTrail(g, start);
  if (!t) return fail(start, "No entry box to start from.");
  const ctx = makeCtx(g, facts, overrides);
  const { steps } = t;
  let at = t.at;
  const path = [at], seen = new Set([at]);
  while (steps.length <= maxSteps) {
    const a = analyse(ctx, at, path, seen);
    if (a.t === "end") return { steps, end: at };
    if (a.t === "stop") return { steps, end: at, stoppedFor: a.why, missing: askable(ctx, a.missing), options: a.options };
    if (a.t === "ai") {
      const { v } = optionsOf(ctx, a.kids);
      return { steps, end: at, stoppedFor: "ask", missing: askable(ctx, missingOf(ctx, a.kids, v)), options: sortOptions(a.options), ...(a.optionArms ? { optionArms: true } : {}) };
    }
    steps.push({ node: at, page: pageOf(at), chosen: a.chosen, by: a.by, options: a.options });
    at = a.chosen; path.push(at); seen.add(at);
  }
  return { steps, end: at, truncated: true };
}

/** Facts to ask about when a model-less rule cannot say which child is meant: the open routes' deciders. */
function decidersAt(g: Graph, facts: Facts, at: string): string[] {
  try {
    return remainingQuestions(g, rankPathways(g, facts, pageOf(at)), facts, 6).map((d) => d.fact);
  } catch {
    return [];
  }
}

/**
 * Walk the guideline from `start` (a page code, a node id, or "auto"), deciding each branch as
 * described at the top of this file. Never throws.
 */
export async function aiWalk(g: Graph, facts: Facts, start: string, opts: AiWalkOptions = {}): Promise<AiWalkResult> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const score: ScoreFn = opts.score ?? ((gg, ff, ids) => scoreBranches(gg, ff, ids, opts.decide));
  const t = newTrail(g, start);
  if (!t) return fail(start, "No entry box to start from.");
  const ctx = makeCtx(g, facts, opts.overrides ?? {});
  const { steps } = t;
  let at = t.at;
  const path = [at], seen = new Set([at]);

  /** Ask the scorer about one node. */
  const ask = async (node: string) => {
    const got = await score(g, facts, [node]);
    return pickOptions(got, node);
  };
  const errorResult = (e: unknown): AiWalkResult => ({
    steps, end: at, stoppedFor: "error",
    error: e instanceof DecideError || e instanceof Error ? e.message : "The AI scorer failed.",
  });

  try {
    while (steps.length <= maxSteps) {
      const a = analyse(ctx, at, path, seen);
      if (a.t === "end") return { steps, end: at };
      if (a.t === "stop") {
        const missing = askable(ctx, a.why === "not-enough" && !a.missing.length ? decidersAt(g, facts, at) : a.missing);
        return { steps, end: at, stoppedFor: a.why, missing, options: a.options };
      }

      if (a.t === "follow") {
        let options = a.options, prob: number | undefined, none: number | undefined, disagree = false;
        // Probabilities for the trail (and the disagreement check) where they are wanted: always
        // for the clinician's own choice (the answers are remembered, so this is usually free),
        // for rule decisions only when asked. A failure here loses the bars, not the walk.
        const wanted = a.by === "clinician" ? a.branch : opts.checkRules && a.branch && a.by === "rule";
        if (wanted && isScorable(g, at)) {
          try {
            const m = await ask(at);
            if (m) {
              options = withProbs(options, m);
              prob = m.get(a.chosen); none = m.get(NONE);
              disagree = disagrees(options, a.chosen, threshold);
            }
          } catch (e) {
            if ((e as Error)?.name === "AbortError") throw e;
            if (a.by === "rule" && opts.checkRules) return errorResult(e);
          }
        }
        steps.push({ node: at, page: pageOf(at), chosen: a.chosen, by: a.by, ...(prob !== undefined ? { prob } : {}), ...(none !== undefined ? { none } : {}), options, ...(disagree ? { disagree: true } : {}) });
        at = a.chosen; path.push(at); seen.add(at);
        continue;
      }

      // The rules leave this branch open: the model's probabilities.
      const m = await ask(at);
      const options = withProbs(a.options, m);
      const none = m?.get(NONE);
      const best = top(options, a.cands);
      const openHere = () => askable(ctx, missingOf(ctx, a.kids, optionsOf(ctx, a.kids).v));
      const optMark = a.optionArms ? { optionArms: true as const } : {};
      if (!m) return { steps, end: at, stoppedFor: "ask", missing: openHere(), options: sortOptions(options), ...optMark };
      if (none !== undefined && none > NONE_STOP) {
        const missing = openHere();
        return { steps, end: at, stoppedFor: "not-enough", missing: missing.length ? missing : askable(ctx, decidersAt(g, facts, at)), options: sortOptions(options), none, ...optMark };
      }
      // Only mutually exclusive condition arms are followed on the model's word, and only when it
      // is sure: at the threshold AND clearly ahead of the runner-up.
      if (best && !a.optionArms && best.prob! >= threshold && best.prob! - runnerUp(options, best.child) >= AUTO_MARGIN - 1e-9) {
        // ... and say so when the arm's condition rests on a detail that was never entered: the
        // model assumed it, and the reader can answer it instead.
        const gaps = g.preds[best.child] ? missingFacts(g, g.preds[best.child], ctx.raw) : [];
        steps.push({
          node: at, page: pageOf(at), chosen: best.child, by: "ai", prob: best.prob, ...(none !== undefined ? { none } : {}), options,
          ...(gaps.length ? { assumed: gaps } : {}),
          ...(disagrees(options, best.child, threshold) ? { disagree: true } : {}),
        });
        at = best.child; path.push(at); seen.add(at);
        continue;
      }
      return { steps, end: at, stoppedFor: "ask", missing: openHere(), options: sortOptions(options), ...(none !== undefined ? { none } : {}), ...optMark };
    }
    return { steps, end: at, truncated: true };
  } catch (e) {
    return errorResult(e);
  }
}

// ---------------------------------------------------------------- for pathway ranking

/**
 * The probabilities the model gave along a trail, as the edge map rankPathways takes
 * (`"parent>child"` -> probability): every scored option of every step, and of the stop.
 */
export function edgeProbFromTrail(trail: TrailStep[] | Pick<AiWalkResult, "steps" | "end" | "options">): Map<string, number> {
  const steps = Array.isArray(trail) ? trail : trail.steps;
  const out = new Map<string, number>();
  for (const s of steps) for (const o of s.options) if (typeof o.prob === "number") out.set(`${s.node}>${o.child}`, o.prob);
  if (!Array.isArray(trail)) for (const o of trail.options ?? []) if (typeof o.prob === "number") out.set(`${trail.end}>${o.child}`, o.prob);
  return out;
}
