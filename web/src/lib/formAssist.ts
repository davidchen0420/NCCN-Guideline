/**
 * What the patient form needs from the engine: which details decide the routes still open (and
 * the box each one decides), where each answer would lead, whether a value is plausible, and
 * whether the details contradict each other.
 */
import type { Facts, Pred, Schema, VarSpec } from "../types";
import { sectionStartPages, type Graph } from "./graph";
import { derive, evaluate } from "./predicates";
import { hasFacts, missingFacts, rankPathways, startingFacts, usedFacts, type Ranking } from "./pathways";
import { stripMarks } from "./adapt";
import { label, valueLabel } from "./factMeta";

const clip = (t: string, n = 90) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);
const boxText = (g: Graph, id: string) => clip(stripMarks(g.node(id)?.text ?? id).replace(/\s+/g, " "));

/* ---------------- the details that decide the open routes ---------------- */

export interface Decider {
  fact: string;
  /** share of the open routes' weight on which this detail is still open (0..1; 1 before any entry) */
  share: number;
  /** the box whose branch it decides */
  node: string;
  page: string;
  text: string;
}

/** Details still unknown that decide branches on the open routes, most consequential first.
 * Before anything is entered, the details the start pages branch on. When details were entered
 * and no route is left, nothing: asking more would not help. */
export function decidingFacts(g: Graph, ranking: Ranking, facts: Facts, limit = 8): Decider[] {
  const vars = g.bundle.schema?.variables ?? {};
  const known = (f: string) => facts[f] !== undefined && facts[f] !== null && facts[f] !== "";
  const out = new Map<string, Decider>();
  if (ranking.paths.length) {
    for (const p of ranking.paths) {
      for (const st of p.steps) {
        for (const f of st.missing) {
          if (!vars[f] || known(f)) continue;
          const d = out.get(f);
          if (d) { if (!d.node) Object.assign(d, { node: st.node, page: st.node.split(":")[0], text: boxText(g, st.node) }); continue; }
          out.set(f, { fact: f, share: 0, node: st.node, page: st.node.split(":")[0], text: boxText(g, st.node) });
        }
      }
      // What decides the later event a route stops before (PSA persistence vs recurrence) is
      // asked about too: the clinician may know it already.
      const end = p.steps[p.steps.length - 1]?.node;
      for (const f of p.laterMissing ?? []) {
        if (!vars[f] || known(f) || out.has(f) || !end) continue;
        out.set(f, { fact: f, share: 0, node: end, page: end.split(":")[0], text: boxText(g, end) });
      }
      for (const f of new Set([...p.missing, ...(p.laterMissing ?? [])])) { const d = out.get(f); if (d) d.share += p.likelihood; }
    }
  } else if (hasFacts(facts)) {
    // Facts were entered and no route fits them: more questions would not help (the route is
    // blocked by something already answered; see whyNothingFits).
    return [];
  } else {
    // nothing entered: the details the first branches turn on
    const where = new Map<string, string>();
    for (const page of g.flowPages) {
      for (const r of g.bundle.roots[page] ?? []) {
        for (const id of [r, ...g.kids(r)]) {
          for (const f of missingFacts(g, g.preds[id] ?? g.node(id)?.linkCond, {})) if (!where.has(f)) where.set(f, id);
        }
      }
    }
    for (const f of startingFacts(g, limit)) {
      if (!vars[f] || known(f)) continue;
      const id = where.get(f) ?? "";
      out.set(f, { fact: f, share: 1, node: id, page: id.split(":")[0], text: id ? boxText(g, id) : "" });
    }
  }
  return [...out.values()].sort((a, b) => b.share - a.share).slice(0, limit);
}

/* ---------------- where an answer leads ---------------- */

export interface Preview {
  value: unknown;
  /** routes that stay open with this answer */
  routes: number;
  /** the branch this answer settles on the most likely route, if any */
  decides?: { node: string; page: string; text: string };
  /** that route's share of the fit */
  share?: number;
}

/** Answer values worth previewing for a field (numbers are left out: they have no fixed choices). */
export function previewValues(spec: VarSpec): unknown[] {
  if (spec.type === "bool") return [true, false];
  if (spec.type === "enum") return (spec.values ?? []).filter((v) => v !== "other").slice(0, 8);
  return [];
}

/**
 * Rank the routes as if `fact` were `value`, and name where that answer leads: the first branch
 * the resulting best route newly settles that the current best route has not (the preview is of
 * the new best route, not of every route the facts left open); else the first step on a page the
 * current best route does not reach; else, when that route stops before arms still open, the arm
 * this answer supports. None when the answer only keeps the same routes open. `start` is the
 * start setting the ranking `base` was made with.
 */
export function previewAnswer(g: Graph, facts: Facts, fact: string, value: unknown, base: Ranking, start: string = "auto"): Preview {
  const r = rankPathways(g, { ...facts, [fact]: value }, start);
  const top = r.paths[0];
  if (!top) return { value, routes: 0 };
  const before = base.paths[0];
  const pageOf = (n: string) => n.split(":")[0];
  const seenPages = new Set((before?.steps ?? []).map((s) => pageOf(s.node)));
  const settled = (s: { kind: string }) => s.kind === "met" || s.kind === "otherwise" || s.kind === "inferred";
  const seenNodes = new Set((before?.steps ?? []).filter(settled).map((s) => s.node));
  let at: string | undefined = (top.steps.find((s) => settled(s) && !seenNodes.has(s.node))
    ?? (before ? top.steps.find((s) => s.kind !== "flow" && !seenPages.has(pageOf(s.node))) : undefined))?.node;
  let page = at && pageOf(at);
  // The best route stops before arms whose conditions are still open; one that this answer
  // supports (and does not rule out) is where the answer leads ("N1" -> the regional page).
  if (!at && before && top.id !== before.id && top.end === "later") {
    const now = derive({ ...facts, [fact]: value }, g.bundle.schema);
    const arm = top.next.find((k) => g.preds[k] && missingFacts(g, g.preds[k], {}).includes(fact) && evaluate(g.preds[k], now) !== false);
    if (arm) {
      at = arm;
      page = (g.node(arm)?.links ?? []).find((l) => g.bundle.pages[l] && l !== pageOf(arm)) ?? pageOf(arm);
    }
  }
  return {
    value, routes: r.paths.length, share: top.likelihood,
    decides: at ? { node: at, page: page!, text: boxText(g, at) } : undefined,
  };
}

/**
 * The details still to ask about, counted on the routes that could be the answer: the best route
 * and those about as likely (at least half its likelihood, at most five), each detail once. The
 * form's "N more may follow" should count these, not every detail any route might ever need.
 */
export function remainingQuestions(g: Graph, ranking: Ranking, facts: Facts, limit = 12): Decider[] {
  const top = ranking.paths[0];
  if (!top) return decidingFacts(g, ranking, facts, limit);
  const near = ranking.paths.filter((p, i) => i < 5 && (i === 0 || p.likelihood >= top.likelihood * 0.5));
  return decidingFacts(g, { ...ranking, paths: near }, facts, limit);
}

/* ---------------- plausibility ---------------- */

export interface Check { level: "error" | "warn"; message: string }

/** Is a number plausible for this detail? Ranges come from the unit and the detail's name. */
export function plausibility(name: string, spec: VarSpec, value: unknown): Check | null {
  if (spec.type !== "number") return null;
  const nums = typeof value === "number" ? [value] : value && typeof value === "object"
    ? Object.values(value as Record<string, unknown>).filter((x): x is number => typeof x === "number") : [];
  if (!nums.length) return null;
  const unit = (spec.unit ?? "").toLowerCase();
  const n = name.toLowerCase();
  const ranges: [RegExp | ((x: string) => boolean), number, number, number | null, string][] = [
    // [matches name or unit, hard min, hard max, typical max (warn above), what]
    [/(^|_)age(_|$)/, 0, 120, 100, "an age"],
    [/ecog/, 0, 5, 4, "an ECOG score (0–4)"],
    [/karnofsky|kps/, 0, 100, 100, "a Karnofsky score (0–100)"],
    [/life_expectancy/, 0, 80, 50, "a life expectancy in years"],
    [/percent|pct|_percent/, 0, 100, 100, "a percentage"],
    [/psa_ng/, 0, 100000, 1000, "a PSA in ng/mL"],
    [/testosterone/, 0, 3000, 1500, "a testosterone in ng/dL"],
    [/count|number_of/, 0, 100000, null, "a count"],
  ];
  for (const [m, lo, hi, typical, what] of ranges) {
    const hit = typeof m === "function" ? m(n) : m.test(n) || (m.source.includes("percent") && unit === "percent");
    if (!hit) continue;
    for (const x of nums) {
      if (x < lo || x > hi) return { level: "error", message: `${x} is not ${what}.` };
      if (typical !== null && x > typical) return { level: "warn", message: `${x} is unusually high for ${what}: check the units.` };
      if (/ecog/.test(n) && !Number.isInteger(x)) return { level: "warn", message: "ECOG is a whole number from 0 to 4." };
    }
    return null;
  }
  if (nums.some((x) => x < 0) && !/change|delta|difference/.test(n)) return { level: "error", message: "This cannot be negative." };
  if (/months|weeks|days|years/.test(unit) && nums.some((x) => x > 1200)) return { level: "warn", message: "That is a very long time: check the units." };
  return null;
}

/* ---------------- contradictions ---------------- */

export interface Conflict { facts: string[]; message: string }

/** Details that disagree: a stated classification that the entries work out differently, and
 * TNM categories that deny what other details say. */
export function contradictions(facts: Facts, schema: Schema): Conflict[] {
  const out: Conflict[] = [];
  const vars = schema.variables ?? {};
  // a classification stated in the record vs the one the entries work out
  for (const [name, d] of Object.entries(schema.derived ?? {})) {
    if (facts[name] === undefined || d.type !== "enum") continue;
    const rest = { ...facts };
    delete rest[name];
    const computed = derive(rest, schema)[name];
    if (computed !== undefined && computed !== null && computed !== facts[name]) {
      out.push({ facts: [name], message: `You entered ${label(name)} as “${valueLabel(facts[name])}”, but your other answers point to “${valueLabel(computed)}”. “${valueLabel(facts[name])}” is being used.` });
    }
  }
  const val = (re: RegExp) => Object.keys(facts).filter((k) => re.test(k) && vars[k]);
  const truthy = (k: string) => facts[k] === true || (typeof facts[k] === "number" && (facts[k] as number) > 0);
  // M0 but metastases recorded
  for (const m of val(/(^|_)m_category$|^m_stage$/)) {
    if (!String(facts[m]).startsWith("M0")) continue;
    const mets = val(/metast/).filter((k) => !/timing|pattern|stated|judges/.test(k) && truthy(k));
    if (mets.length) out.push({ facts: [m, ...mets], message: `${label(m)} is ${facts[m]}, but ${mets.map((k) => label(k).toLowerCase()).join(", ")} ${mets.length > 1 ? "are" : "is"} recorded.` });
  }
  // N0 but positive nodes recorded
  for (const nn of val(/(^|_)n_category$|^n_stage$/)) {
    if (!String(facts[nn]).startsWith("N0")) continue;
    const nodes = val(/node|nodal/).filter((k) => truthy(k) && !/stated/.test(k));
    if (nodes.length) out.push({ facts: [nn, ...nodes], message: `${label(nn)} is ${facts[nn]}, but ${nodes.map((k) => label(k).toLowerCase()).join(", ")} ${nodes.length > 1 ? "are" : "is"} recorded.` });
  }
  return out;
}

/* ---------------- why nothing fits ---------------- */

export interface Blocker {
  /** the box whose condition the entered details make false */
  node: string;
  page: string;
  text: string;
  /** the raw details entered that make it false (the settings that would have to change) */
  facts: string[];
}

/**
 * Why no route is left for these details: the first gate on the start page (or, failing that,
 * the first branch behind it) whose condition is false for them. An entry box whose condition
 * the facts contradict ("Suspected or proven metastatic disease (M1)" when no distant
 * metastases are suspected) when every entry of the page is contradicted; otherwise the nearest
 * branch whose every arm is. `start` is the start setting ("auto" or a page). Null when no gate
 * is contradicted. Meant for a ranking with no routes.
 */
export function whyNothingFits(g: Graph, facts: Facts, start: string | "auto" = "auto"): Blocker | null {
  const now = derive(facts, g.bundle.schema);
  const false_ = (id: string) => !!g.preds[id] && evaluate(g.preds[id], now) === false;
  /** The parts of a condition that are false (the others may hold): what would have to change. */
  const failing = (p: Pred): Pred[] => {
    if (evaluate(p, now) !== false) return [];
    if ("all" in p) return p.all.flatMap(failing);
    if ("any" in p) return p.any.flatMap(failing);
    return [p];
  };
  const factsOf = (id: string) => {
    const out = new Set<string>();
    for (const part of failing(g.preds[id])) usedFacts(g, part, facts, out);
    return [...out];
  };
  const blocker = (id: string): Blocker => ({ node: id, page: id.split(":")[0], text: boxText(g, id), facts: factsOf(id) });
  const strongest = (ids: string[]) => ids.map((id) => blocker(id)).sort((a, b) => b.facts.length - a.facts.length)[0] ?? null;

  let pages: string[];
  if (start !== "auto") pages = g.bundle.pages[start] ? [start] : [];
  else {
    const linked = new Set<string>();
    for (const [id, ks] of Object.entries(g.bundle.children)) ks.forEach((k) => { if (k.split(":")[0] !== id.split(":")[0]) linked.add(k.split(":")[0]); });
    g.bundle.links.forEach(([q, p]) => { if (q !== p) linked.add(p); });
    pages = g.flowPages.filter((p) => (g.bundle.roots[p] ?? []).length && !linked.has(p));
    const sec = g.bundle.sections;
    const chosen = sec ? facts[sec.variable] : undefined;
    if (typeof chosen === "string") pages = [...new Set([...pages, ...sectionStartPages(g, chosen)])];
  }
  const roots = pages.flatMap((p) => g.bundle.roots[p] ?? []);
  if (!roots.length) return null;
  // every way into the start page is contradicted by what was entered
  const open = roots.filter((r) => !false_(r));
  if (!open.length) return strongest(roots.filter((r) => factsOf(r).length)) ?? strongest(roots);

  // breadth first from the entries that fit: the nearest branch all of whose arms are contradicted
  const seen = new Set<string>(open);
  let level = open;
  for (let depth = 0; level.length && depth < 40; depth++) {
    const next: string[] = [];
    for (const id of level) {
      const ks = g.kids(id);
      const jump = ks.length ? [] : (g.node(id)?.links ?? []).filter((l) => l !== id.split(":")[0] && g.bundle.pages[l]).flatMap((l) => g.bundle.roots[l] ?? []);
      const arms = ks.length ? ks : jump;
      if (arms.length && arms.every(false_) && arms.some((k) => factsOf(k).length)) return strongest(arms);
      for (const k of arms) if (!seen.has(k) && !false_(k)) { seen.add(k); next.push(k); }
    }
    level = next;
  }
  return null;
}
