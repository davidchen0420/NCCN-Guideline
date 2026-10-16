/**
 * The decision trail as the reader shows it: which steps count as decisions, how they are
 * summed up in one line, which of the clinician's choices still apply, and the labels on the
 * diagram's arrows. Pure functions of an AiWalkResult, so they can be tested without a browser.
 */
import type { AiWalkResult, TrailOption, TrailStep } from "./aiWalk";
import { boxText } from "./decide";
import type { Graph } from "./graph";

/** A step that is a decision: a rule, the AI or the clinician chose between at least two arms. Not the start, a single arrow to follow, or a gate with one way on. */
export const isDecision = (s: TrailStep): boolean => (s.by === "rule" || s.by === "ai" || s.by === "clinician") && s.options.length >= 2;
export const decisionSteps = (r: Pick<AiWalkResult, "steps">): TrailStep[] => r.steps.filter(isDecision);

export interface TrailStats {
  total: number;
  rule: number;
  ai: number;
  clinician: number;
  /** the lowest probability among the steps the AI chose (undefined when it chose none) */
  lowestAi?: number;
}

export function trailStats(r: Pick<AiWalkResult, "steps">): TrailStats {
  const ds = decisionSteps(r);
  const ai = ds.filter((s) => s.by === "ai");
  const probs = ai.map((s) => s.prob).filter((p): p is number => typeof p === "number");
  return {
    total: ds.length,
    rule: ds.filter((s) => s.by === "rule").length,
    ai: ai.length,
    clinician: ds.filter((s) => s.by === "clinician").length,
    ...(probs.length ? { lowestAi: Math.min(...probs) } : {}),
  };
}

/** A probability as a whole percent: "86%" (never 0% or 100% for a value that is not exactly so). */
export const percent = (p: number): string => {
  const n = Math.round(p * 100);
  return `${p > 0 && n < 1 ? 1 : p < 1 && n > 99 ? 99 : n}%`;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "7 decisions · 5 by the guideline rules · 2 by AI (lowest 86%) · 0 by you" (the AI part only when AI is on). */
export function trailSummary(st: TrailStats, aiOn: boolean): string {
  const parts = [plural(st.total, "decision"), `${st.rule} by the guideline ${st.rule === 1 ? "rule" : "rules"}`];
  if (aiOn) parts.push(`${st.ai} by AI${st.lowestAi !== undefined ? ` (lowest ${percent(st.lowestAi)})` : ""}`);
  parts.push(`${st.clinician} by you`);
  return parts.join(" · ");
}

/** "AI-assisted: 2 of 7 decisions chosen by the AI (lowest 86%). Review in How we got here."; null when the AI chose none. */
export function aiAssistedLine(st: TrailStats): string | null {
  if (!st.ai) return null;
  return `AI-assisted: ${st.ai} of ${plural(st.total, "decision")} chosen by the AI${st.lowestAi !== undefined ? ` (lowest ${percent(st.lowestAi)})` : ""}. Review in How we got here.`;
}

/**
 * The clinician's choices that no longer apply: the box is not on the route any more (the
 * answers changed, or an earlier choice sent the route elsewhere), or the child is not one of its
 * arms now. Only judged against a trail that went as far as it could: not one that ended in
 * an error, and not one that stopped for a decision before reaching the choice (we cannot tell
 * there whether the box would be reached with more information).
 */
export function staleOverrides(r: AiWalkResult, overrides: Record<string, string>): string[] {
  const ids = Object.keys(overrides);
  if (!ids.length || r.stoppedFor === "error" || r.truncated) return [];
  const stepOf = new Map(r.steps.map((s) => [s.node, s] as const));
  const complete = !r.stoppedFor;
  return ids.filter((node) => {
    const s = stepOf.get(node);
    if (s) return s.chosen !== overrides[node];
    if (node === r.end && r.stoppedFor) return !(r.options ?? []).some((o) => o.child === overrides[node]);
    return complete;
  });
}

const BARE_CODE = /^[A-Z]{2,6}-\d+[A-Z]?$/;
const TRAILING_CODE = /\s*\(([A-Z]{2,6}-\d+[A-Z]?)\)\s*$/;
const letters = (t: string) => t.replace(/[^A-Za-z]/g, "");

/**
 * A box's text as a heading reads: a bare page code ("PROS-3") becomes that page's title with the
 * code after it, and text printed in capitals that is a page's title ("INITIAL RISK STRATIFICATION
 * (PROS-2)") is written as the title is. Anything else is the box's own text.
 */
export function readable(g: Graph, text: string): string {
  const t = text.trim();
  if (BARE_CODE.test(t)) { const title = g.bundle.pages[t]?.title; return title ? `${title} (${t})` : t; }
  const l = letters(t);
  if (l.length > 6 && l === l.toUpperCase()) {
    const code = TRAILING_CODE.exec(t)?.[1];
    const bare = t.replace(TRAILING_CODE, "").trim().toLowerCase();
    const hit = Object.entries(g.bundle.pages).find(([c, p]) => (code ? c === code : true) && (p.title ?? "").trim().toLowerCase() === bare);
    if (hit) return `${hit[1].title} (${hit[0]})`;
  }
  return text;
}

/** The question a decision answers: the parent box's text, footnote marks removed; the page's virtual start reads as a question. */
export function questionText(g: Graph, node: string): string {
  if (node.endsWith(":START")) return "Which starting point applies?";
  const n = g.node(node);
  return n ? readable(g, boxText(n.text) || node) : node;
}

/** The option the AI favoured most, when it is not the one followed (for the disagreement note). */
export function favouredByAi(s: TrailStep): TrailOption | null {
  let best: TrailOption | null = null;
  for (const o of s.options) if (typeof o.prob === "number" && (!best || o.prob > best.prob!)) best = o;
  return best && best.child !== s.chosen ? best : null;
}

export type EdgeTag = { text: string; low: boolean };

/**
 * What to write on the arrow that leaves each decision of the trail: the AI's confidence, "Rule"
 * or "You". `low` marks a choice the AI gave less than the threshold (the clinician's own).
 * Keyed "parent>child" with the node ids of the graph.
 */
export function edgeTags(r: Pick<AiWalkResult, "steps">, threshold: number): Map<string, EdgeTag> {
  const out = new Map<string, EdgeTag>();
  for (const s of decisionSteps(r)) {
    const p = typeof s.prob === "number" ? s.prob : undefined;
    const text = s.by === "ai" && p !== undefined ? percent(p) : s.by === "clinician" ? "You" : s.by === "rule" ? "Rule" : "AI";
    out.set(`${s.node}>${s.chosen}`, { text, low: p !== undefined && p < threshold });
  }
  return out;
}

/**
 * The part of a walk that explains a recommendation: the decisions on the way to where its route
 * ends (a walk goes on past a recommendation, into the pages that follow it, and may take another
 * way where the clinician has picked another route). A decision stays when the route passes
 * through the box it was made at (or the page's virtual start) and on to the arm chosen; a stop
 * stays when the route reaches the box the walk stopped at or goes on through one of its arms.
 */
export function trimToRoute(r: AiWalkResult, nodes: Set<string>): AiWalkResult {
  const steps = r.steps.filter((s) => nodes.has(s.chosen) && (nodes.has(s.node) || s.node.endsWith(":START")));
  const stop = r.stoppedFor && r.stoppedFor !== "error" && (nodes.has(r.end) || (r.options ?? []).some((o) => nodes.has(o.child)));
  return stop ? { ...r, steps } : { steps, end: r.end, ...(r.stoppedFor === "error" ? { stoppedFor: "error" as const } : {}) };
}
