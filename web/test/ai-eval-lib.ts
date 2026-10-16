/**
 * Library half of the AI-decisions calibration harness (see ai-eval.mjs): builds a labelled set
 * from the encoded guidelines and computes calibration metrics. It reuses the app's own modules
 * (adapt, graph, predicates, decide), so it is loaded through Vite's module runner from the .mjs
 * entry point, which resolves the TypeScript sources the same way the app build does.
 *
 * Labels: at a decision node whose condition arms ALL have an encoded predicate, a sampled set of
 * facts gives a definite verdict when the predicates evaluate (after derived values) to
 * true/false for every arm. Exactly one true arm: that arm is the label. No true arm: "none".
 * Two or more true arms: the facts do not separate the arms, so the sample is dropped.
 */
import type { Facts, Pred } from "../src/types";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph, guidelineAcronyms, type Graph } from "../src/lib/graph";
import { configureLabels } from "../src/lib/factMeta";
import { derive, evaluate } from "../src/lib/predicates";
import * as decide from "../src/lib/decide";

export { decide };

/** Parse a guideline.json into the app's graph (the same path the viewer takes). */
export const loadGraph = (json: unknown): Graph => buildGraph(adaptGuideline(json as never));
/** Labels are configured per guideline in module state: call this before using a graph again. */
export const activate = (g: Graph) => configureLabels(g.bundle.schema ?? null, guidelineAcronyms(g.bundle));

export interface Case {
  id: string;
  slug: string;
  node: string;
  /** raw sampled facts (derived values are added by the app, as for a real patient) */
  facts: Facts;
  /** the arm whose predicate holds, or "none" when no arm's does */
  truth: string;
  children: string[];
}

/** Small seeded generator, so a run can be repeated. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const shuffle = <T>(xs: T[], rand: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/** Nodes whose arms are all encoded: the ones with a label to check. */
export function evaluableNodes(g: Graph): string[] {
  return decide.scorableNodes(g).filter((id) => {
    const { conds } = decide.branchChildren(g, id);
    return conds.length >= 2 && conds.every((k) => g.preds[k]);
  });
}

/** Raw variables a set of predicates rests on (through derived values), and numbers compared with each. */
function ingredients(g: Graph, preds: Pred[]) {
  const schema = g.bundle.schema;
  const vars = new Set<string>();
  const nums = new Map<string, Set<number>>();
  const seen = new Set<string>();
  const visit = (p: Pred) => {
    if ("all" in p) p.all.forEach(visit);
    else if ("any" in p) p.any.forEach(visit);
    else if ("not" in p) visit(p.not);
    else {
      const v = p.fact;
      if (typeof p.value === "number") (nums.get(v) ?? nums.set(v, new Set()).get(v)!).add(p.value);
      if (Array.isArray(p.value)) p.value.forEach((x) => typeof x === "number" && (nums.get(v) ?? nums.set(v, new Set()).get(v)!).add(x));
      if (schema.variables[v]) vars.add(v);
      else if (schema.derived?.[v] && !seen.has(v)) { seen.add(v); schema.derived[v].rules.forEach((r) => visit(r.if)); }
    }
  };
  preds.forEach(visit);
  return { vars: [...vars], nums };
}

function sampleFacts(g: Graph, vars: string[], nums: Map<string, Set<number>>, rand: () => number): Facts {
  const facts: Facts = {};
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  for (const name of vars) {
    const spec = g.bundle.schema.variables[name];
    if (spec.type === "bool") facts[name] = rand() < 0.5;
    else if (spec.type === "enum") { if (spec.values?.length) facts[name] = pick(spec.values); }
    else {
      const cs = [...(nums.get(name) ?? [])];
      const pool = [0, ...cs.flatMap((c) => { const d = Math.max(0.1, Math.abs(c) * 0.1); return [c - d, c, c + d]; })];
      facts[name] = +pick(pool).toFixed(2);
    }
  }
  return facts;
}

/** Up to `perNode` labelled fact sets for one node, drawn to cover different labels. */
export function casesForNode(g: Graph, slug: string, node: string, perNode: number, rand: () => number, tries = 80): Case[] {
  const { conds } = decide.branchChildren(g, node);
  const preds = conds.map((k) => g.preds[k]);
  const { vars, nums } = ingredients(g, preds);
  const buckets = new Map<string, Case[]>();
  const seen = new Set<string>();
  for (let t = 0; t < tries; t++) {
    const facts = sampleFacts(g, vars, nums, rand);
    const sig = JSON.stringify(facts);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const full = derive(facts, g.bundle.schema);
    const verdicts = preds.map((p) => evaluate(p, full));
    if (verdicts.includes(null)) continue;
    const trueArms = conds.filter((_, i) => verdicts[i] === true);
    if (trueArms.length > 1) continue;
    const truth = trueArms[0] ?? decide.NONE;
    (buckets.get(truth) ?? buckets.set(truth, []).get(truth)!).push({ id: "", slug, node, facts, truth, children: conds });
  }
  // round robin over labels, so "none" and each arm are represented
  const out: Case[] = [];
  const lists = shuffle([...buckets.values()], rand);
  for (let i = 0; out.length < perNode && lists.some((l) => l.length > i); i++)
    for (const l of lists) if (l[i] && out.length < perNode) out.push(l[i]);
  out.forEach((c, i) => { c.id = `${slug}|${node}|${i}`; });
  return out;
}

// ---------------------------------------------------------------- metrics

export interface Scored { case: Case; scores: Map<string, number> | null; pred?: string; pmax?: number; correct?: boolean }

/** argmax and its probability (the first of equal maxima). */
export function top(scores: Map<string, number>): { pred: string; pmax: number } | null {
  let best: { pred: string; pmax: number } | null = null;
  for (const [k, v] of scores) if (!best || v > best.pmax) best = { pred: k, pmax: v };
  return best;
}

export function score(c: Case, scores: Map<string, number> | null): Scored {
  const t = scores && top(scores);
  if (!scores || !t) return { case: c, scores: null };
  return { case: c, scores, ...t, correct: t.pred === c.truth };
}

export interface Bin { lo: number; hi: number; n: number; conf: number; acc: number }
export interface FollowRow { threshold: number; followed: number; correct: number; wrong: number; precision: number | null; recall: number | null; coverage: number }
export interface Metrics {
  total: number; answered: number; accuracy: number; brier: number; ece: number;
  bins: Bin[]; follow: FollowRow[];
  truthNone: number; accuracyOnArms: number | null; accuracyOnNone: number | null;
  byGuideline: { slug: string; n: number; accuracy: number }[];
}
export const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.99];

export function metrics(all: Scored[], thresholds = THRESHOLDS): Metrics {
  const rows = all.filter((r) => r.scores && r.pmax !== undefined);
  const n = rows.length;
  const correct = rows.filter((r) => r.correct).length;
  const bins: Bin[] = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, conf: 0, acc: 0 }));
  for (const r of rows) {
    const b = bins[Math.min(9, Math.floor(r.pmax! * 10))];
    b.n++; b.conf += r.pmax!; b.acc += r.correct ? 1 : 0;
  }
  let ece = 0;
  for (const b of bins) if (b.n) { b.conf /= b.n; b.acc /= b.n; ece += (b.n / n) * Math.abs(b.acc - b.conf); }
  const brier = n ? rows.reduce((a, r) => {
    let s = 0;
    for (const [k, v] of r.scores!) s += (v - (k === r.case.truth ? 1 : 0)) ** 2;
    return a + s;
  }, 0) / n : 0;
  const positives = rows.filter((r) => r.case.truth !== decide.NONE).length;
  const follow = thresholds.map((threshold) => {
    const f = rows.filter((r) => r.pred !== decide.NONE && r.pmax! >= threshold);
    const ok = f.filter((r) => r.correct).length;
    return { threshold, followed: f.length, correct: ok, wrong: f.length - ok, precision: f.length ? ok / f.length : null, recall: positives ? ok / positives : null, coverage: n ? f.length / n : 0 };
  });
  const arms = rows.filter((r) => r.case.truth !== decide.NONE), none = rows.filter((r) => r.case.truth === decide.NONE);
  const per = new Map<string, { n: number; ok: number }>();
  for (const r of rows) { const p = per.get(r.case.slug) ?? per.set(r.case.slug, { n: 0, ok: 0 }).get(r.case.slug)!; p.n++; p.ok += r.correct ? 1 : 0; }
  return {
    total: all.length, answered: n, accuracy: n ? correct / n : 0, brier, ece, bins, follow,
    truthNone: none.length,
    accuracyOnArms: arms.length ? arms.filter((r) => r.correct).length / arms.length : null,
    accuracyOnNone: none.length ? none.filter((r) => r.correct).length / none.length : null,
    byGuideline: [...per].map(([slug, p]) => ({ slug, n: p.n, accuracy: p.ok / p.n })).sort((a, b) => a.accuracy - b.accuracy || b.n - a.n),
  };
}

const pct = (x: number | null, d = 1) => (x === null ? "–" : `${(100 * x).toFixed(d)}%`);

export interface ReportInfo { mode: string; server: string; model: string | null; seed: number; limit: number; errors: number; perNode: number; date: string; guidelines: number; mockAccuracy?: number }

export function report(m: Metrics, info: ReportInfo): string {
  const L: string[] = [];
  L.push("# AI decisions: calibration report", "");
  if (info.mode === "mock")
    L.push(`> **Mock run (accuracy setting ${info.mockAccuracy ?? 1}): a test of this pipeline, not a measurement of any model.**`, "");
  L.push(`- Date: ${info.date}`, `- Source: ${info.mode === "mock" ? "deterministic mock (probability 0.9 on the true arm)" : `server ${info.server}`}${info.model ? `, model \`${info.model}\`` : ""}`,
    `- Labelled cases: ${m.total} requested over ${info.guidelines} guidelines (seed ${info.seed}, up to ${info.perNode} per decision node); answered ${m.answered}, failed ${info.errors}`,
    `- Labels come from the encoded predicates of the guideline graph; only nodes whose arms all have an encoded condition are used. "none" is the label when no arm's condition holds (${m.truthNone} cases).`, "");
  L.push("## Summary", "",
    "| Measure | Value |", "|---|---|",
    `| Top-1 accuracy | ${pct(m.accuracy)} (${Math.round(m.accuracy * m.answered)}/${m.answered}) |`,
    `| Accuracy where an arm is true | ${pct(m.accuracyOnArms)} |`, `| Accuracy where none is true | ${pct(m.accuracyOnNone)} |`,
    `| Expected calibration error (10 bins) | ${m.ece.toFixed(3)} |`, `| Brier score (sum over choices, mean over cases) | ${m.brier.toFixed(3)} |`, "");
  L.push("## Reliability (top probability vs how often it was right)", "",
    "| Top probability | Cases | Mean confidence | Accuracy | Gap |", "|---|---:|---:|---:|---:|");
  for (const b of m.bins) L.push(b.n ? `| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.n} | ${pct(b.conf)} | ${pct(b.acc)} | ${((b.acc - b.conf) * 100).toFixed(1)} pts |` : `| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | 0 | – | – | – |`);
  L.push("", "## Auto-follow by threshold", "",
    "Auto-follow takes the top arm when its probability is at least the threshold and it is not \"none\". Precision: followed arms that were right. Recall: cases with a true arm that were followed correctly. Coverage: share of all cases followed.", "",
    "| Threshold | Followed | Right | Wrong | Precision | Recall | Coverage |", "|---:|---:|---:|---:|---:|---:|---:|");
  for (const f of m.follow) L.push(`| ${f.threshold} | ${f.followed} | ${f.correct} | ${f.wrong} | ${pct(f.precision)} | ${pct(f.recall)} | ${pct(f.coverage)} |`);
  L.push("", "## Weakest guidelines", "", "| Guideline | Cases | Accuracy |", "|---|---:|---:|");
  for (const r of m.byGuideline.slice(0, 15)) L.push(`| ${r.slug} | ${r.n} | ${pct(r.accuracy)} |`);
  L.push("", "## Method", "",
    "Facts are sampled from each condition's variables (enum values, flags, numbers around the thresholds the guideline compares them with). A sample counts when every arm's predicate evaluates to true or false after the derived values are added and at most one arm is true. The request is built exactly as the app builds it (structured answers plus the page text), sent through the proxy, and the model's distribution over the arms and \"none\" is compared with the label. Samples are synthetic and the labels are the guideline encoding's own, so this measures agreement with the encoding, not clinical correctness.", "");
  return L.join("\n");
}
