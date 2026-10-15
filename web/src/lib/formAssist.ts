/**
 * What the patient form needs from the engine: which details decide the routes still open (and
 * the box each one decides), where each answer would lead, whether a value is plausible, and
 * whether the details contradict each other.
 */
import type { Facts, Schema, VarSpec } from "../types";
import type { Graph } from "./graph";
import { derive } from "./predicates";
import { missingFacts, rankPathways, startingFacts, type Ranking } from "./pathways";
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
 * Before anything is entered, the details the start pages branch on. */
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
      for (const f of p.missing) { const d = out.get(f); if (d) d.share += p.likelihood; }
    }
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

/** Rank the routes as if `fact` were `value`, and name the branch that answer settles. */
export function previewAnswer(g: Graph, facts: Facts, fact: string, value: unknown, base: Ranking): Preview {
  const r = rankPathways(g, { ...facts, [fact]: value });
  const top = r.paths[0];
  if (!top) return { value, routes: 0 };
  const metBefore = new Set(base.paths.flatMap((p) => p.steps.filter((s) => s.kind === "met").map((s) => s.node)));
  // the branch this answer settles; none when it only keeps routes open
  const step = top.steps.find((s) => s.kind === "met" && !metBefore.has(s.node));
  return {
    value, routes: r.paths.length, share: top.likelihood,
    decides: step ? { node: step.node, page: step.node.split(":")[0], text: boxText(g, step.node) } : undefined,
  };
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
      out.push({ facts: [name], message: `The record states ${label(name).toLowerCase()} “${valueLabel(facts[name])}”, but the details entered work out as “${valueLabel(computed)}”. The stated value is used.` });
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
