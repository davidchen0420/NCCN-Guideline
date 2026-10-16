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
import { resolveRef, sectionStartPages, stateOfEntries, stateOfTitle, type Graph } from "./graph";
import { derive, evaluate } from "./predicates";
import { stripMarks } from "./adapt";
import { matchWord } from "./terms";

export type StepKind = "met" | "otherwise" | "unknown" | "uncoded" | "option" | "inferred" | "flow";
export type EdgeKind = "agreed" | "verified" | "unsure" | "link" | "entry";
export interface PStep {
  node: string; kind: StepKind; missing: string[]; edge: EdgeKind; share: number;
  /** the raw facts entered that decided this step (met, otherwise, received); empty for open steps */
  used: string[];
}
/**
 * How a route ends:
 * - leaf: on a recommendation (a treatment, a test, a schedule);
 * - later: on a recommendation, with arms behind it that describe later events;
 * - continues: on a reference to a page the data does not carry as boxes; `continuesTo` names it;
 * - open: on something that is not a recommendation (a page reference, a table heading, a
 *   criteria box): more details are needed to reach one (`missing`);
 * - limit: the route was cut at the depth limit.
 */
export type EndKind = "leaf" | "later" | "limit" | "continues" | "open";
export interface Pathway {
  id: string; steps: PStep[]; end: EndKind; next: string[];
  /** For end "continues": the page (as the data names it) where the next step is printed. */
  continuesTo?: string;
  weight: number; likelihood: number;
  met: number; open: number; options: number;
  /** Arms taken although their condition is not encoded (left to the clinician's judgment). */
  uncoded: number;
  coverage: number; encoding: number; confidence: number;
  missing: string[];
  /** The raw facts entered that decided the route's met steps (through derived facts). A route
   * "matches your answers" only when this is not empty and nothing is missing. */
  used: string[];
  /** Raw facts still unknown that would decide the later event the route stops before
   * ("Recurrence", "PSA persistence/recurrence"); empty unless the route ends on one. */
  laterMissing: string[];
  /** Boxes printed beside the route's branches that apply alongside it, not instead of it (the
   * aspirin row next to a treatment table's condition rows): never a competing route. */
  alongside: string[];
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

/** A route that ends on a recommendation (not on a page reference, a heading, a criteria box or
 * a page printed elsewhere): the only ends that may be shown as "NCCN recommends ...". */
export const isRecommendationEnd = (p: Pathway) => p.end === "leaf" || p.end === "later";

/** Text that is only a pointer to a page ("REC-3", "REC-3A", "PROS-4 see ..."). */
export const PAGE_REF = /^\s*[A-Z]{2,6}-\d+[A-Z]?(\s|$)/;
const CODE = /\b[A-Z]{2,6}-(?:\d+[A-Z]?|[A-Z])(?:\s+\d+\s+of\s+\d+)?\b/g;
const HEADING_ROLES = new Set(["page_heading", "column_header", "table_title", "table_root"]);
/** Words of a box that says what to do (bullets, treatments, tests, schedules), as opposed to one
 * that only describes the patient: data types some such boxes as conditions. */
const ACTION = new RegExp(["•", "\\b(?:therapy|therapies|treatment|treat|surveillance|observation|observe|resection|surgery|surgical|excision|ablation|transplant\\w*|radiation|radiotherapy|chemo\\w*|immunotherapy|inhibitors?|mab|biopsy|imaging|MRI|CT|PET|ultrasound|exam|H&P|history|follow-?up|monitor\\w*|consider|recommend\\w*|test(?:ing|s)?|assess\\w*|evaluat\\w*|screening|discontinue|manage[d]?|management|refer\\w*|start|repeat|every|systemic|palliative|supportive|support|care|principles|dose|risk:?\\s*\\d)\\b"].join("|"), "i");
export type BoxClass = "recommendation" | "pageref" | "heading" | "condition";
/** What a box is, for the end of a route: a recommendation, a pointer to a page, a heading, or a
 * criteria box that describes the patient. */
export function boxClass(g: Graph, id: string): BoxClass {
  const n = g.node(id);
  if (!n) return "recommendation";
  const role = n.role ?? "";
  if (HEADING_ROLES.has(role) || n.kind === "header") return "heading";
  const text = stripMarks(n.text).trim();
  const bare = text.replace(CODE, "").replace(/[^A-Za-z]/g, "");
  if (PAGE_REF.test(n.text) || ((role === "table_ref" || role === "link") && !n.ext?.length) || (!bare && n.links.length)) return "pageref";
  if ((n.decision === "condition" || /condition/.test(role)) && !ACTION.test(n.text)) return "condition";
  return "recommendation";
}

/**
 * The children of a box split into the branches of the route and the items printed beside them. In
 * a treatment table the condition rows are the branches; a recommendation row hanging off the same
 * box with no condition or option type (the "start aspirin" row next to the stage rows) applies
 * alongside whichever row fits: it is not an alternative route, however short.
 */
export function splitAlongside(g: Graph, kids: string[]): { main: string[]; alongside: string[] } {
  if (!kids.some((k) => g.node(k)?.role === "table_condition")) return { main: kids, alongside: [] };
  const main = kids.filter((k) => g.node(k)?.role === "table_condition" || !!g.preds[k] || !!g.node(k)?.decision);
  return { main, alongside: kids.filter((k) => !main.includes(k)) };
}

export const hasFacts = (f: Facts) => Object.values(f).some((v) => v !== null && v !== undefined && v !== "");

function factsUsed(p: Pred | null | undefined, out = new Set<string>()): Set<string> {
  if (!p) return out;
  if ("all" in p) p.all.forEach((x) => factsUsed(x, out));
  else if ("any" in p) p.any.forEach((x) => factsUsed(x, out));
  else if ("not" in p) factsUsed(p.not, out);
  else out.add(p.fact);
  return out;
}

const isKnown = (v: unknown) => v !== undefined && v !== null && v !== "" && v !== "unknown";

/** The raw facts entered that a condition rests on, looking through derived facts to the details
 * they are worked out from (an explicitly stated derived fact counts as itself). */
export function usedFacts(g: Graph, pred: Pred | null | undefined, raw: Facts, out = new Set<string>(), seen = new Set<string>()): Set<string> {
  for (const name of factsUsed(pred)) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (isKnown(raw[name])) { out.add(name); continue; }
    g.bundle.schema.derived?.[name]?.rules.forEach((r) => usedFacts(g, r.if, raw, out, seen));
  }
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

/** The values a detail can take (null for a number or an unknown shape): the enum's values, a flag's two, a derived value's outcomes. "other" and "unknown" are not counted. */
function valueDomain(g: Graph, name: string): unknown[] | null {
  const schema = g.bundle.schema;
  const v = schema.variables?.[name];
  if (v) return v.type === "bool" ? [true, false] : v.type === "enum" ? (v.values ?? []).filter((x) => x !== "other" && x !== "unknown") : null;
  const d = schema.derived?.[name];
  if (!d) return null;
  const outs = [...d.rules.map((r) => r.then), ...(d.else !== undefined ? [d.else] : [])].filter((x) => x !== null && x !== undefined);
  return outs.length ? [...new Set(outs)] : null;
}
/**
 * How plausible it is that an undecided condition holds, taking every possible value of the
 * details it rests on as equally likely: the share of values that satisfy it (a conjunction
 * multiplies, a disjunction combines, a negation complements). Kept away from 0 and 1: an arm the
 * facts do not rule out is never impossible. 0.5 where the values are not countable.
 */
export function armPrior(g: Graph, pred: Pred | null | undefined): number {
  const go = (p: Pred): number => {
    if ("all" in p) return p.all.reduce((a, x) => a * go(x), 1);
    if ("any" in p) return 1 - p.any.reduce((a, x) => a * (1 - go(x)), 1);
    if ("not" in p) return 1 - go(p.not);
    const dom = valueDomain(g, p.fact);
    if (!dom?.length) return 0.5;
    return dom.filter((val) => evaluate(p, { [p.fact]: val }) === true).length / dom.length;
  };
  return pred ? Math.min(0.95, Math.max(0.05, go(pred))) : 1;
}

/** Optional inputs of rankPathways. */
export interface RankOptions {
  /**
   * Probability of following a child from its parent, keyed "parent>child" (node ids as in the
   * graph), e.g. from the AI-assisted walk. Where a branch splits likelihood among children that
   * cannot be decided yet (unknown, uncoded or option arms), a supplied probability replaces the
   * even split; shares are renormalised among the children that survive. Children without an
   * entry share the mean of the supplied ones. Absent, the split is as before.
   */
  edgeProb?: Map<string, number>;
  /**
   * The clinician's choices: a branch box -> the child to follow (a page's virtual `PAGE:START`
   * -> the entry box). The route takes that child whatever its condition says and drops its
   * siblings; a choice for a box the route never reaches changes nothing.
   */
  overrides?: Record<string, string>;
}
/** Lowest probability an arm keeps when an AI probability is used, so an unlikely route stays listed. */
const MIN_PROB = 0.01;

/**
 * With a disease of a multi-disease guideline chosen: does a box lead only into pages of the
 * other diseases (the "dMMR" arm that goes to the dMMR pages for a patient with pMMR disease)? The
 * choice of disease already settled that branch.
 */
export function leadsOnlyElsewhere(g: Graph, id: string, section: string | null, depth = 0): boolean {
  const sec = g.bundle.sections;
  if (!sec || !section || depth > 3) return false;
  const secOf = (p: string) => (sec.pages?.[p] ?? null) as string | null;
  const ks = g.kids(id);
  if (!ks.length) return false;
  return ks.every((k) => {
    const s = secOf(k.split(":")[0]);
    if (s !== null) return s !== section;
    return k.split(":")[0] === id.split(":")[0] && leadsOnlyElsewhere(g, k, section, depth + 1);
  });
}

export function rankPathways(g: Graph, raw: Facts, start: string | "auto" = "auto", opts?: RankOptions): Ranking {
  const empty: Ranking = { paths: [], ruledOut: 0, entries: [], truncated: false, nextBest: null };
  if (start === "auto" && !hasFacts(raw)) return empty;
  const facts = derive(raw, g.bundle.schema);
  const edgeKind = new Map<string, EdgeKind>();
  for (const [page, fp] of Object.entries(g.bundle.pages))
    fp.edges.forEach((e) => edgeKind.set(`${page}:${e.src}>${page}:${e.dst}`, e.cls));
  const reviewW = (id: string) => (g.preds[id] ? REVIEW_W[g.node(id)?.review === "reviewed" ? "reviewed" : "draft"] : 1);
  const verdict = (id: string): boolean | null | "none" => (g.preds[id] ? evaluate(g.preds[id], facts) : "none");
  /**
   * Can an entry box in the middle of a guideline start a route (when the walk from the start did
   * not get there)? The facts must select it (its own condition is true, or it has none). Where a
   * page is told apart by the way into it, that way must also hold: the entry boxes of a page
   * like "Unfavorable Intermediate-Risk Group" only split it by life expectancy (">10 y",
   * "5–10 y"); the page itself is selected by the link condition of the boxes that lead there,
   * which must be TRUE (not merely open), and nothing up the line to the start may rule it out.
   * Otherwise an RP at the unfavorable intermediate-risk group would start a route for a patient
   * whose risk group is low. Pages for a later state (recurrence, progression, surveillance) and
   * pages with a single entry box are selected by that box itself: how they are usually reached
   * describes the history or the presentation, which the patient may not share.
   */
  const startOk = (id: string, seenPages: Set<string> = new Set()): boolean => {
    const own = verdict(id);
    if (own === false || own === null) return false;
    const page = id.split(":")[0];
    // An entry box with no condition of its own is selected only by how it is reached (the
    // link condition names the patient group of the box that leads there). That does not put the
    // patient at the box: some box leading to it must itself be somewhere the patient can be
    // (REC-13 "Previous >12 mo" follows REC-11 recurrence boxes, whose gates are open).
    if (own === "none" && !leadsFromPlausible(id, new Set(seenPages).add(page))) return false;
    const lc = g.node(id)?.linkCond;
    const lcv = lc ? evaluate(lc, facts) : "none";
    const roots = g.bundle.roots[page] ?? [];
    const split = roots.length > 1 && roots.every((r) => g.preds[r]);
    const late = !!(stateOfTitle(g.bundle.pages[page]?.title ?? "") || stateOfEntries(g, page));
    if (late) return own === true || lcv === true;
    // An answered detail constrains the way in: a page that is reached only through boxes the
    // details rule out ("Rectal cancer without distant metastases" -> clinical stage REC-6 for a
    // patient with distant metastases) is not somewhere this patient can be, even when its own
    // entry box says nothing about it.
    if (!split) return (own === true || lcv === true) && openAbove(id);
    if (lcv !== true && (lc || own === "none")) return false;
    return openAbove(id);
  };
  /** Is there a way into `id` from the start of the guideline that no entered detail rules out? */
  const openAbove = (id: string): boolean => {
    // (the chosen disease is not a reason against a way in: its pages are reached as that disease's)
    const sv = g.bundle.sections?.variable;
    const here = sv ? derive({ ...raw, [sv]: undefined }, g.bundle.schema) : facts;
    const seen = new Set<string>();
    const open = (x: string): boolean => {
      if (seen.has(x)) return false;
      seen.add(x);
      const ps = g.parents[x] ?? [];
      return !ps.length || ps.some((p) => !(g.preds[p] && evaluate(g.preds[p], here) === false) && open(p));
    };
    return open(id);
  };
  const leadsFromPlausible = (id: string, seenPages: Set<string>): boolean => {
    const page = id.split(":")[0];
    const from = (g.parents[id] ?? []).filter((p) => p.split(":")[0] !== page);
    if (!from.length) return true;   // nothing leads here from another page: selected by the facts alone
    return from.some((p) => {
      const q = p.split(":")[0];
      if (seenPages.has(q)) return false;
      const seen = new Set(seenPages).add(q);
      return (g.bundle.roots[q] ?? []).some((r) => startOk(r, seen));
    });
  };
  const linksOut = (id: string) => (g.node(id)?.links ?? []).some((l) => g.bundle.pages[l] && l !== id.split(":")[0]);

  const done: Omit<Pathway, "likelihood">[] = [];
  let ruledOut = 0, truncated = false;

  const finish = (steps: PStep[], weight: number, end: EndKind, next: string[] = [], laterMissing: string[] = [], continuesTo?: string) => {
    if (done.length >= MAX_PATHS) { truncated = true; return; }
    const crit = steps.filter((s) => s.kind !== "flow" && s.kind !== "option");
    const met = crit.filter((s) => s.kind !== "unknown" && s.kind !== "uncoded").length;
    const open = crit.length - met;
    const coverage = crit.length ? met / crit.length : 0;
    const encoding = steps.reduce((a, s) => a + EDGE_W[s.edge] * reviewW(s.node), 0) / steps.length;
    const missing = [...new Set([...steps.flatMap((s) => s.missing), ...(end === "open" ? laterMissing : [])])];
    done.push({
      id: steps.map((s) => s.node).join(">"), steps, end, next, weight, ...(continuesTo ? { continuesTo } : {}),
      met, open, options: steps.filter((s) => s.kind === "option").length, uncoded: steps.filter((s) => s.kind === "uncoded").length,
      coverage, encoding, confidence: Math.round(100 * coverage * encoding), missing,
      used: [...new Set(steps.flatMap((s) => s.used))], laterMissing,
      alongside: [...new Set(steps.flatMap((s) => splitAlongside(g, g.kids(s.node)).alongside))].filter((x) => !steps.some((s) => s.node === x)),
    });
  };

  type Group = { id: string; pre: string[] };
  const and = (vs: (boolean | null | "none")[]): boolean | null | "none" => {
    const xs = vs.filter((x) => x !== "none");
    return !xs.length ? "none" : xs.includes(false) ? false : xs.includes(null) ? null : true;
  };
  /** Verdict of an arm: its own condition (or, for a later-event box, what the branches behind
   * it say about that event) together with its row's criteria. */
  const gVerdict = (gr: Group, events = true) => {
    const own = verdict(gr.id);
    return and([own === "none" && events && isEvent(gr.id) ? gate(gr.id).verdict : own, ...gr.pre.map(verdict)]);
  };
  /**
   * A bare box that names a later event ("Recurrence", "PSA persistence/recurrence",
   * "Progression") is not a step of the plan: it is what may happen after it. Whether it has
   * happened is read from the conditions of the branches behind it, which are the facts that say
   * which event it was (recurrence pattern, PSA status); the box itself has no condition.
   */
  const EVENT = /\b(recurrence|recurrent|relapse|relapsed|progression|progressive|persistence|persistent|refractory)\b/i;
  const isEvent = (id: string) => {
    const n = g.node(id);
    if (!n || g.preds[id] || !g.kids(id).length) return false;
    const t = stripMarks(n.text).replace(/[()]/g, " ").trim();
    return t.split(/\s+/).length <= 6 && EVENT.test(t);
  };
  const gateCache = new Map<string, { verdict: boolean | null; preds: Pred[] }>();
  const gate = (id: string) => {
    let c = gateCache.get(id);
    if (!c) {
      const preds: Pred[] = [], seen = new Set<string>();
      const look = (x: string, d: number) => {
        for (const k of g.kids(x)) {
          if (seen.has(k)) continue;
          seen.add(k);
          if (g.preds[k]) preds.push(g.preds[k]); else if (d < 4) look(k, d + 1);
        }
      };
      look(id, 0);
      const vs = preds.map((p) => evaluate(p, facts));
      c = { verdict: vs.includes(true) ? true : vs.length && vs.every((v) => v === false) ? false : null, preds };
      gateCache.set(id, c);
    }
    return c;
  };
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
  const split = (groups: Group[], events = true, parent?: string) => {
    const v = groups.map((gr) => gVerdict(gr, events));
    const tr = groups.filter((_, i) => v[i] === true);
    const fl = groups.filter((_, i) => v[i] === false);
    const unk = groups.filter((_, i) => v[i] === null);
    let none = groups.filter((_, i) => v[i] === "none");
    ruledOut += fl.length;
    type Opt = { gr: Group; kind: StepKind; share: number };
    // "Otherwise" arm: every conditioned sibling is false and exactly one has no condition.
    if (!tr.length && !unk.length && none.length === 1 && fl.length) return [{ gr: none[0], kind: "otherwise", share: 1 }] as Opt[];
    const out: Opt[] = [];
    tr.forEach((gr) => out.push({ gr, kind: "met", share: 1 }));
    // Arms that cannot be decided yet share the weight by how much of the details' possible values
    // would satisfy each (not equally): "M ≠ M1" is the likelier side of an unknown M category than "M1".
    unk.forEach((gr) => out.push({ gr, kind: "unknown", share: (tr.length ? RESIDUAL : 1) * armPrior(g, g.preds[gr.id]) }));
    // A box with no condition is "not encoded" (rather than a free option) when review rejected
    // its drafted condition, or when the data types it as a condition. Older bundles have no
    // decision types: there, conditioned siblings show the branch is decided by facts.
    const structured = !!g.bundle.structured;
    const siblingHasPred = groups.some((gr) => g.preds[gr.id]);
    const uncoded = none.filter((gr) => {
      const n = g.node(gr.id);
      if (gr.pre.length) return false;
      if (n?.review === "rejected") return true;
      return structured ? n?.decision === "condition" : siblingHasPred;
    });
    uncoded.forEach((gr) => out.push({ gr, kind: "uncoded", share: tr.length ? RESIDUAL : 1 }));
    none = none.filter((gr) => !uncoded.includes(gr));
    if (none.length && structured) {
      // Options carry "the patient already received this" conditions: a received option is
      // the route taken; one ruled out by the treatment received keeps a small share.
      const rv = none.map((gr) => { const r = g.node(gr.id)?.received; return r ? evaluate(r, facts) : null; });
      const anyMine = rv.includes(true);
      none.forEach((gr, i) => {
        if (rv[i] === true) out.push({ gr, kind: "inferred", share: tr.length ? RESIDUAL : 1 });
        else out.push({ gr, kind: "option", share: (tr.length || anyMine ? RESIDUAL : 1) * (rv[i] === false ? 0.5 : 1) });
      });
    } else if (none.length) {
      const m = none.map((gr) => textMatches(g, g.node(gr.id)?.text ?? "", raw));
      const anyMine = m.some((x) => x.mine);
      none.forEach((gr, i) => {
        if (m[i].mine) out.push({ gr, kind: "inferred", share: tr.length ? RESIDUAL : 1 });
        else out.push({ gr, kind: "option", share: (tr.length || anyMine ? RESIDUAL : 1) * (m[i].other ? 0.5 : 1) });
      });
    }
    // Supplied probabilities (AI-scored edges) replace the even split among the open arms; the
    // factors above (residual share beside a true sibling, half for a ruled-out option) still apply.
    const probs = opts?.edgeProb;
    if (probs && parent !== undefined) {
      const open = (x: Opt) => x.kind === "unknown" || x.kind === "uncoded" || x.kind === "option";
      const given = new Map<Opt, number>();
      for (const x of out) if (open(x)) { const p = probs.get(`${parent}>${x.gr.id}`); if (typeof p === "number" && Number.isFinite(p)) given.set(x, Math.max(MIN_PROB, Math.min(1, p))); }
      if (given.size) {
        const mean = [...given.values()].reduce((a, b) => a + b, 0) / given.size;
        for (const x of out) if (open(x)) x.share *= given.get(x) ?? mean;
      }
    }
    const total = out.reduce((a, x) => a + x.share, 0) || 1;
    return out.map((x) => ({ ...x, share: x.share / total }));
  };

  /** The raw facts entered that settled a step: its own condition when met, the conditions of
   * the arms it was chosen over when "otherwise", the treatment received when inferred. */
  const settledBy = (k: string, kind: StepKind, sibs: string[]) => {
    const out = new Set<string>();
    if (kind === "met") {
      if (g.preds[k]) usedFacts(g, g.preds[k], raw, out);
      else if (isEvent(k)) gate(k).preds.filter((p) => evaluate(p, facts) === true).forEach((p) => usedFacts(g, p, raw, out));
    } else if (kind === "otherwise") sibs.filter((x) => x !== k).forEach((x) => usedFacts(g, g.preds[x], raw, out));
    else if (kind === "inferred") usedFacts(g, g.node(k)?.received, raw, out);
    // How the box is reached counts too: an entry box selected by the conditions of the boxes that
    // lead there (its link condition) rests on those details when they hold.
    const lc = g.node(k)?.linkCond;
    if (lc && kind !== "unknown" && kind !== "uncoded" && evaluate(lc, facts) === true) usedFacts(g, lc, raw, out);
    return [...out];
  };
  const stepFor = (parent: string | null, k: string, kind: StepKind, share: number, sibs: string[] = []): PStep => ({
    node: k, kind, share,
    missing: kind === "unknown" ? missingFacts(g, g.preds[k], facts) : [],
    edge: parent === null ? "entry" : edgeKind.get(`${parent}>${k}`) ?? (k.split(":")[0] !== parent.split(":")[0] ? "link" : "agreed"),
    used: settledBy(k, kind, sibs),
  });
  const preSteps = (parent: string | null, gr: Group) => gr.pre.map((p) => {
    const v = verdict(p);
    return stepFor(parent, p, v === true ? "met" : v === null ? "unknown" : "flow", 1);
  });
  /** A row's own cell: met/unknown come from its criteria when it has no condition itself. */
  const targetKind = (gr: Group, kind: StepKind): StepKind => (gr.pre.length && !g.preds[gr.id] && (kind === "met" || kind === "unknown") ? "flow" : kind);

  /** Entry boxes of the pages a box points to (flow pages with boxes, other than its own). */
  const jumpRoots = (id: string, seen: Set<string>) => {
    const own = id.split(":")[0];
    const out: string[] = [];
    for (const l of g.node(id)?.links ?? []) {
      if (l === own || !g.bundle.pages[l] || !inSection(l)) continue;
      for (const r of g.bundle.roots[l] ?? []) if (!seen.has(r) && !out.includes(r)) out.push(r);
    }
    return out;
  };
  /** The page a box that goes nowhere points to: a flow page without boxes, or the page a bare
   * page reference names. */
  const continuesTarget = (id: string, cls: BoxClass) => {
    const own = id.split(":")[0];
    const targets = (g.node(id)?.links ?? []).filter((l) => l !== own);
    const empty = targets.find((l) => g.bundle.pages[l] && !(g.bundle.roots[l] ?? []).length);
    if (empty) return empty;
    if (cls !== "pageref") return undefined;
    const code = targets[0] ?? g.node(id)?.text.match(CODE)?.[0];
    return code && (targets.length || resolveRef(g, code).type !== "none") ? code : undefined;
  };
  /** A route that stops on a box with nothing after it: honest about what the box is. */
  const endHere = (id: string, steps: PStep[], weight: number) => {
    const cls = boxClass(g, id);
    const to = continuesTarget(id, cls);
    if (to) return finish(steps, weight, "continues", [], [], to);
    return finish(steps, weight, cls === "recommendation" ? "leaf" : "open");
  };
  /** A route that stops before arms that cannot be taken yet. On a recommendation these are
   * later events ("later"); on a page reference or heading they are the next step itself, still
   * to be decided: "open", with the details that decide the arms. */
  const stop = (id: string, steps: PStep[], weight: number, kids: string[]) => {
    const cls = boxClass(g, id);
    if (cls !== "pageref" && cls !== "heading") return finish(steps, weight, "later", kids);
    const need = [...new Set(kids.flatMap((k) => missingFacts(g, g.preds[k], facts)))];
    return finish(steps, weight, "open", kids, need);
  };

  let follow = true;   // follow a page reference into a page whose gate is still open
  // The disease chosen in a multi-disease guideline: no route goes into another disease's pages.
  const sec = g.bundle.sections;
  const chosen = sec ? raw[sec.variable] : undefined;
  const mySec = typeof chosen === "string" && sec!.values.includes(chosen) ? chosen : null;
  const secOf = (p: string) => (sec?.pages?.[p] ?? null) as string | null;
  const inSection = (p: string) => !mySec || secOf(p) === null || secOf(p) === mySec;
  const dfs = (id: string, steps: PStep[], weight: number, seen: Set<string>) => {
    if (truncated) return;
    if (steps.length > MAX_DEPTH) return finish(steps, weight, "limit");
    let kids = splitAlongside(g, g.kids(id)).main.filter((k) => !seen.has(k) && inSection(k.split(":")[0]));
    // The disease was chosen: an arm that only goes into another disease's pages is not a branch
    // for this patient (the choice of disease decided it).
    let sectionSettled = false;
    if (mySec && kids.length > 1) {
      const own = kids.filter((k) => !leadsOnlyElsewhere(g, k, mySec));
      if (own.length && own.length < kids.length) { kids = own; sectionSettled = follow; }
    }
    // A box that only refers to another page, without an arrow in the data, goes on to that
    // page's entry boxes (gated by their conditions like any entry).
    let jumped = false;
    if (!kids.length && !g.kids(id).length) {
      const into = jumpRoots(id, seen);
      if (into.length) { kids = into; jumped = true; }
    }
    if (!kids.length) return endHere(id, steps, weight);
    // Mirrors navigator._auto_step: undecided arms are explored only out of a condition box
    // (or an entry); a single plain arrow is followed out of a condition, a page reference, or
    // the box right after a condition (a workup step). Out of a recommendation, arrows lead to
    // later events, so the route ends there.
    const isCond = (n: string, i: number) =>
      !!g.preds[n] || i === 0 || (g.bundle.roots[n.split(":")[0]] ?? []).includes(n) || /\?\s*$/.test(g.node(n)?.text ?? "");
    const cond = jumped || isCond(id, steps.length - 1);
    const afterCond = steps.length > 1 && isCond(steps[steps.length - 2].node, steps.length - 2);
    // Cells of a structured table row (criteria, evaluation, "see PROS-4") read as one row.
    const tableCell = /^table_/.test(g.node(id)?.role ?? "");
    const pass = cond || tableCell || linksOut(id) || afterCond;
    const groups = g.bundle.structured ? kids.map((id) => ({ id, pre: [] as string[] })) : rowGroups(kids);
    const sibs = groups.map((gr) => gr.id);
    // the details that ruled out the arms not taken here: they gated this route as well
    let ruled: string[] = [];
    const go = (gr: Group, kind: StepKind, share: number) => {
      const nx = new Set(seen); gr.pre.forEach((p) => nx.add(p)); nx.add(gr.id);
      const step = stepFor(id, gr.id, targetKind(gr, kind), share, sibs);
      if (ruled.length) step.used = [...new Set([...step.used, ...ruled])];
      const add = [...preSteps(id, gr), step];
      dfs(gr.id, [...steps, ...add], weight * share, nx);
    };
    // The clinician chose this branch: it is the route, whatever the conditions say.
    const chosenKid = opts?.overrides?.[id];
    const chosenGroup = chosenKid ? groups.find((gr) => gr.id === chosenKid) : undefined;
    if (chosenGroup) return go(chosenGroup, gVerdict(chosenGroup) === true ? "met" : "flow", 1);
    // Every arm is a later event ("Recurrence", "Progression") and the facts do not say it has
    // happened: the plan ends here, whatever the box is, and what decides the event is kept.
    if (groups.every((gr) => isEvent(gr.id) && !gr.pre.length)) {
      const gs = groups.map((gr) => gate(gr.id));
      if (!gs.some((x) => x.verdict === true)) {
        if (gs.every((x) => x.verdict === false)) ruledOut += groups.length;
        const open = [...new Set(gs.flatMap((x) => x.preds.flatMap((p) => missingFacts(g, p, facts))))];
        // on a heading or a page reference these arms are the next step itself, not a later event
        const cls = boxClass(g, id);
        return finish(steps, weight, cls === "pageref" || cls === "heading" ? "open" : "later", kids, open);
      }
    }
    const v = groups.map((gr) => gVerdict(gr));
    ruled = [...new Set(groups.flatMap((gr, i) => (v[i] === false ? [...usedFacts(g, g.preds[gr.id], raw)] : [])))];
    if (sectionSettled && sec && isKnown(raw[sec.variable])) ruled.push(sec.variable);
    if (v.every((x) => x === false)) {
      ruledOut += groups.length;
      // Out of a condition box, no arm fits: this route contradicts the facts. Out of a
      // recommendation, the arms are later events that have not happened (or not like this).
      return cond ? undefined : stop(id, steps, weight, kids);
    }
    if (groups.length === 1) {
      const gr = groups[0];
      if (v[0] === true) return go(gr, "met", 1);
      // The disease the clinician chose is the only one this arm leads to: choosing it settled the arm.
      if (v[0] === null && sectionSettled) return go(gr, "met", 1);
      // A page reference leads on to the page's first box even when its gate is still open.
      if (v[0] === null) return cond || (follow && linksOut(id)) ? go(gr, "unknown", 1) : stop(id, steps, weight, kids);
      return pass ? go(gr, "flow", 1) : stop(id, steps, weight, kids);
    }
    const arms = split(groups, true, id);
    // After a recommendation, children with open conditions describe later events (recurrence,
    // response): the route ends here unless the facts already say which one happened.
    if (!cond && !arms.some((o) => o.kind === "met" || o.kind === "otherwise") && arms.some((o) => o.kind === "unknown"))
      return stop(id, steps, weight, kids);
    arms.forEach((o) => go(o.gr, o.kind, o.share));
  };

  const explore = (entries: string[]) => {
    // The clinician chose the starting point (the page's virtual START box).
    const pickedEntry = Object.entries(opts?.overrides ?? {}).find(([k, v]) => k.endsWith(":START") && entries.includes(v))?.[1];
    if (pickedEntry) return dfs(pickedEntry, [stepFor(null, pickedEntry, verdict(pickedEntry) === true ? "met" : "flow", 1, entries)], 1, new Set([pickedEntry]));
    // the details that ruled out the other entries gated every route from here
    const ruled = [...new Set(entries.flatMap((id) => (verdict(id) === false ? [...usedFacts(g, g.preds[id], raw)] : [])))];
    split(entries.map((id) => ({ id, pre: [] })), false).forEach((o) => {
      const step = stepFor(null, o.gr.id, o.kind, o.share, entries);
      if (ruled.length) step.used = [...new Set([...step.used, ...ruled])];
      dfs(o.gr.id, [step], o.share, new Set([o.gr.id]));
    });
  };

  let entries: string[];
  if (start === "auto") {
    // (the chosen disease of a multi-disease guideline is set up above)
    // Page-level links: a box on page q continues on p's entry boxes or refers to page p.
    const out = new Map<string, Set<string>>();
    const link = (q: string, p: string) => { if (p !== q && g.bundle.pages[p]) (out.get(q) ?? out.set(q, new Set()).get(q)!).add(p); };
    for (const [id, ks] of Object.entries(g.bundle.children)) ks.forEach((k) => link(id.split(":")[0], k.split(":")[0]));
    g.bundle.links.forEach(([q, p]) => link(q, p));
    // Starting pages: algorithm pages with entry boxes that no other page leads to (PROS-1;
    // one per disease in multi-disease guidelines). Older bundles start on the first page.
    const linkedTo = new Set([...out.values()].flatMap((x) => [...x]));
    let starts = (g.bundle.structured
      ? g.flowPages.filter((p) => (g.bundle.roots[p] ?? []).length && !linkedTo.has(p))
      : [g.flowPages[0]]).filter(inSection);
    // A multi-disease guideline with the disease chosen: other diseases' pages are out, and when
    // the shared pages ahead of the disease's own do not lead into them (a diagnostic-testing page
    // that only lists every disease), the disease's own pages start routes of their own.
    let ownStarts = false;
    if (mySec) {
      const seenN = new Set<string>(), stack = starts.flatMap((p) => g.bundle.roots[p] ?? []);
      while (stack.length && seenN.size < 30000) { const n = stack.pop()!; if (seenN.has(n)) continue; seenN.add(n); stack.push(...g.kids(n)); }
      if (![...seenN].some((n) => secOf(n.split(":")[0]) === mySec)) { starts = starts.concat(sectionStartPages(g, mySec)); ownStarts = true; }
    }
    if (!starts.length) starts.push(g.flowPages.find((p) => (g.bundle.roots[p] ?? []).length) ?? g.flowPages[0]);
    entries = starts.flatMap((p) => g.bundle.roots[p] ?? []);
    // The first walk decides which later pages the patient is already past (a walk that stops at
    // a page whose gate is open has not passed through it); the second follows page references.
    follow = false;
    explore(entries);
    const shallow = done.splice(0);
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
    const reachedNodes = new Set(shallow.flatMap((d) => d.steps.map((st) => st.node)));
    const reachedPages = new Set([...reachedNodes].map((n) => n.split(":")[0]));
    const cands0 = g.flowPages.filter((p) => {
      if (starts.includes(p) || !inSection(p) || [...reachedPages].some((q) => q !== p && out.get(q)?.has(p))) return false;
      if (textMatches(g, g.bundle.pages[p].title ?? "", raw).other) return false;
      return (g.bundle.roots[p] ?? []).some((r) => !reachedNodes.has(r) && startOk(r));
    });
    // The details that select a page: those its entry boxes (and the way into them) rest on.
    const support = (p: string) => {
      const out = new Set<string>();
      for (const r of g.bundle.roots[p] ?? []) { usedFacts(g, g.preds[r], raw, out); usedFacts(g, g.node(r)?.linkCond, raw, out); }
      return out;
    };
    // A page further down the guideline than another selected page counts as the patient's state only
    // when it is selected by something the earlier page does not already rest on (a PSA recurrence
    // after the initial treatment); selected by the same details, it is just where the earlier page
    // leads, and the walk gets there itself.
    const cands = cands0.filter((p) => {
      const mine = support(p);
      return !cands0.some((q) => q !== p && reaches(q, p) && !reaches(p, q) && [...mine].every((f) => support(q).has(f)));
    });
    const later = cands.filter((p) => !cands.some((q) => q !== p && reaches(p, q)));
    follow = true;
    ruledOut = 0;
    explore(entries);
    const full = done.splice(0);
    // A link from the shared pages into the disease's pages (wired continuation) does not mean the
    // walk gets there: it may stop first, or be gated by a fact the patient has not given. When no
    // route enters the disease's pages, those pages start routes of their own.
    if (mySec && !ownStarts && !full.some((d) => d.steps.some((st) => secOf(st.node.split(":")[0]) === mySec))) {
      const extra = sectionStartPages(g, mySec).flatMap((p) => g.bundle.roots[p] ?? []).filter((r) => !starts.includes(r.split(":")[0]) && openAbove(r));
      explore(extra);
      full.push(...done.splice(0));
      entries = entries.concat(extra);
    }    if (later.length) {
      // The patient is past initial diagnosis: routes from the first page that never reach a
      // selected later-state page describe history, not the current decision. A selected page
      // that the walk from the start reaches keeps those routes (with what is still unknown on
      // the way); one it cannot reach starts routes of its own.
      const keep = full.filter((d) => d.steps.some((st) => later.includes(st.node.split(":")[0])));
      done.push(...keep);
      entries = keep.length ? [...new Set(keep.map((d) => d.steps[0].node))] : [];
      const hit = new Set(keep.flatMap((d) => d.steps.map((st) => st.node.split(":")[0])));
      for (const p of later.filter((x) => !hit.has(x))) {
        const extra = (g.bundle.roots[p] ?? []).filter((r) => !reachedNodes.has(r) && startOk(r));
        explore(extra);
        entries = entries.concat(extra);
      }
    } else done.push(...full);
    // With the disease chosen, routes that never enter its pages (the shared prelude) give way to
    // those that do.
    if (mySec) {
      const own = done.filter((d) => d.steps.some((st) => secOf(st.node.split(":")[0]) === mySec));
      if (own.length && own.length < done.length) {
        done.length = 0; done.push(...own);
        entries = [...new Set(own.map((d) => d.steps[0].node))];
      }
    }
  } else {
    entries = g.bundle.roots[start] ?? [];
    explore(entries);
  }

  const supported = (p: { used: string[] }) => (p.used.length ? 1 : 0);
  const total = done.reduce((a, p) => a + p.weight, 0) || 1;
  // A route that rests on something the patient entered comes before one that rests on nothing,
  // however the open branches happen to divide the likelihood.
  const paths = done.map((p) => ({ ...p, likelihood: p.weight / total }))
    .sort((a, b) => supported(b) - supported(a) || b.likelihood - a.likelihood || b.confidence - a.confidence || a.steps.length - b.steps.length);

  const by = new Map<string, number>();
  paths.forEach((p) => p.missing.forEach((m) => by.set(m, (by.get(m) ?? 0) + p.likelihood)));
  const best = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  return { paths, ruledOut, entries, truncated, nextBest: best ? { fact: best[0], share: best[1] } : null };
}

/** Likelihood band in words, so the number is not read as a clinical probability. */
export const likelihoodWord = (x: number) => (x >= 0.5 ? "Most likely" : x >= 0.2 ? "Possible" : x >= 0.05 ? "Less likely" : "Unlikely");
export const confidenceWord = (c: number) => (c >= 75 ? "High" : c >= 45 ? "Moderate" : "Low");

// ---------------------------------------------------------------- what the route recommends now

/** What kind of step a box is, for choosing the headline: the treatment itself, other advice, a
 * workup, or follow-up (surveillance, monitoring) that comes after the treatment. */
export type StepTier = "treatment" | "other" | "workup" | "followup";
const FOLLOWUP = /^\W*(?:(?:post-?treatment|long-term|ongoing|routine)\s+)?(?:surveillance|follow-?up|monitoring|re-?evaluat\w*\s+(?:disease\s+)?status|history and physical|H&P|clinical (?:exam|evaluation) every)\b/i;
const TREATMENT = new RegExp(["\\b(?:therapy|therapies|chemo\\w*|radiat\\w*|radiotherapy|RT|SBRT|brachytherapy|resection|surgery|surgical|excision|ablation|transplant\\w*",
  "immunotherapy|inhibitors?|[a-z]{4,}mab|[a-z]{3,}tinib|[a-z]{3,}ciclib|ADT|prostatectomy|lumpectomy|mastectomy|cystectomy|nephrectomy|colectomy",
  "embolization|endocrine|hormone\\w*|androgen|regimens?|FOLFOX|CAPEOX|FOLFIRI\\w*|FOLFIRINOX|observation|active surveillance|start|initiate|administer",
  "supplementation|prophylaxis|antiemetic\\w*|cessation|palliative|best supportive care|BSC|transfusion|TNT|stenting|ostomy)\\b"].join("|"), "i");
const WORKUP = /\b(?:workup|biopsy|biopsies|imaging|MRI|CT|PET|ultrasound|labs?|laboratory|testing|tests?|evaluat\w*|assess\w*|exam|H&P|history|screening|colonoscopy|endoscopy|mammogra\w*|genetic|counseling)\b/i;

/** A page that is only about follow-up ("Surveillance Following Operative Management"), not one that also covers treatment ("Pathologic Stage, Adjuvant Treatment, and Surveillance"). */
export function isFollowPage(g: Graph, page: string): boolean {
  const title = g.bundle.pages[page]?.title ?? "";
  return stateOfTitle(title) === "followup" && !/treat|therap|work-?up|adjuvant|primary|stag(e|ing)\b/i.test(title);
}

/** Is a box the follow-up that comes after treatment (surveillance, monitoring), by its words or by
 * the page it is printed on ("Surveillance Following Operative Management")? */
export function isFollowUp(g: Graph, id: string): boolean {
  const n = g.node(id);
  if (!n) return false;
  const t = stripMarks(n.text).trim();
  if (/^\W*active surveillance/i.test(t)) return false;
  return FOLLOWUP.test(t) || (isFollowPage(g, n.page) && !TREATMENT.test(t));
}
export function stepTier(g: Graph, id: string): StepTier {
  const n = g.node(id);
  const t = stripMarks(n?.text ?? "");
  if (isFollowUp(g, id)) return "followup";
  if (n?.decision === "option" || TREATMENT.test(t)) return "treatment";
  if (WORKUP.test(t)) return "workup";
  return "other";
}
const TIER_ORDER: Record<StepTier, number> = { treatment: 0, other: 1, workup: 2, followup: 3 };

/** A box that can be what the patient is told to do: a recommendation, not a condition, heading,
 * page pointer or table row naming a patient group. */
export function isActionBox(g: Graph, id: string): boolean {
  const n = g.node(id);
  if (!n || boxClass(g, id) !== "recommendation") return false;
  if (n.decision === "condition" || n.decision === "other" || (g.preds[id] && n.decision !== "option")) return false;
  return !/^table_(condition|title|root|value)$/.test(n.role ?? "") && n.role !== "note";
}

export interface Recommendation {
  /** index in `steps` of the headline box */
  index: number;
  /** the headline is a box that says what to do; false when nothing after the last decision does and the last box stands in */
  found: boolean;
  key: PStep;
  /** index of the last step the entered facts settle (-1: none) */
  settled: number;
  tier: StepTier;
  /** the boxes the guideline lists as options at the headline's step (the headline's siblings that
   * the facts leave open), most likely first; just the headline when there is a single choice */
  options: string[];
  /** the box the options hang from (their shared parent on the route); null for a single choice */
  parent: string | null;
  /** the recommendation boxes that follow the headline on this route, in order */
  then: string[];
  /** items printed beside the route's branches on the headline's page (apply alongside) */
  alongside: string[];
}

/**
 * The recommendation for the patient now: the first treatment box on the route after the last
 * decision the entered facts settle. Whatever follows it (restaging, surgery, surveillance) is
 * "then". Where no treatment box exists, the first other advice, then the first workup, and only
 * then follow-up. A box is not looked for beyond follow-up: what lies past surveillance happens
 * after a later event. When the guideline lists several options at that step they are all
 * returned (`options`), taken from `paths` (the ranking) so those the facts rule out are left out.
 */
export function recommendationOf(g: Graph, p: Pathway, paths: Pathway[] = []): Recommendation {
  const s = p.steps;
  const isSettled = (st: PStep) => st.kind === "met" || st.kind === "otherwise" || st.kind === "inferred";
  // Where follow-up begins on the route (a surveillance box, or the first box of a surveillance
  // page): decisions made there choose the follow-up schedule, not the treatment, so the treatment
  // is looked for ahead of it first.
  const firstFollow = s.findIndex((st) => isFollowPage(g, st.node.split(":")[0]) || (isActionBox(g, st.node) && stepTier(g, st.node) === "followup"));
  let followAt = firstFollow;
  // the follow-up page's own entry box belongs to it
  while (followAt > 0 && s[followAt - 1].node.split(":")[0] === s[firstFollow].node.split(":")[0] && !isActionBox(g, s[followAt - 1].node)) followAt--;
  const scan = (until: number) => {
    let settled = -1;
    s.forEach((st, i) => { if (i < until && isSettled(st)) settled = i; });
    // an "inferred" step is a treatment the patient already had: the advice comes after it
    const cands: number[] = [];
    // a met option box (an entry that is itself the treatment) is the recommendation, not only the decision before it
    // (not an "inferred" one: that is a treatment the patient already had)
    const from = settled >= 0 && s[settled].kind === "met" && g.node(s[settled].node)?.decision === "option" && isActionBox(g, s[settled].node) ? settled : settled + 1;
    for (let i = from; i < until; i++) {
      if (!isActionBox(g, s[i].node)) continue;
      cands.push(i);
      if (stepTier(g, s[i].node) === "followup") break;
    }
    return { settled, cands };
  };
  let { settled, cands } = scan(followAt >= 0 ? followAt : s.length);
  if (!cands.length && followAt >= 0) ({ settled, cands } = scan(s.length));
  let index = cands.length ? cands.reduce((best, i) => (TIER_ORDER[stepTier(g, s[i].node)] < TIER_ORDER[stepTier(g, s[best].node)] ? i : best), cands[0]) : -1;
  if (index < 0) {
    // nothing recommends anything after the last decision: the last box that is not a bare page reference, else the last box
    index = s.length - 1;
    for (let i = s.length - 1; i > settled; i--) if (boxClass(g, s[i].node) !== "pageref") { index = i; break; }
  }
  const found = cands.length > 0;
  const key = s[index];
  const kn = g.node(key.node);
  let options = [key.node], parent: string | null = null;
  if (index > 0 && (key.kind === "option" || key.kind === "inferred" || kn?.decision === "option")) {
    parent = s[index - 1].node;
    const prefix = s.slice(0, index).map((x) => x.node).join(">");
    const sibs = paths.filter((q) => q.steps.length > index && q.steps.slice(0, index).map((x) => x.node).join(">") === prefix)
      .sort((a, b) => b.likelihood - a.likelihood).map((q) => q.steps[index].node);
    options = [...new Set([key.node, ...sibs])].filter((x) => x === key.node || isActionBox(g, x));
    options = options.map((x, i) => [x, i] as const).sort(([a, i], [b, j]) => optionPreference(g, a) - optionPreference(g, b) || i - j).map(([x]) => x);
    if (options.length < 2) parent = null;
  }
  const then: string[] = [];
  for (let i = index + 1; i < s.length && then.length < 4; i++) {
    const id = s[i].node;
    if (g.preds[id] && g.node(id)?.decision !== "option") continue;
    if (/^table_(condition|title|root)$/.test(g.node(id)?.role ?? "")) continue;
    const c = boxClass(g, id);
    if (c === "recommendation" || c === "pageref") then.push(id);
  }
  const page = key.node.split(":")[0];
  return { index, found, key, settled, tier: stepTier(g, key.node), options, parent, then, alongside: p.alongside.filter((x) => x.split(":")[0] === page) };
}

/** NCCN preference of a box: 0 preferred, then category 1, 2A, 2B, 3, then the rest. */
export function optionPreference(g: Graph, id: string): number {
  const parsed = g.parsed.get(id);
  const tags = parsed?.tags ?? [];
  if (tags.includes("Preferred") || /\bpreferred\b/i.test(parsed?.plain ?? "")) return 0;
  const cat = tags.find((t) => t.startsWith("Category"));
  if (!cat) return 9;
  const c = /\d/.exec(cat);
  return c ? 1 + Number(c[0]) + (/B/.test(cat) ? 0.5 : 0) : 9;
}

/** Does the route get as far as a recommendation, or does it stop at a criteria box / an open branch? */
export function reachesRecommendation(g: Graph, p: Pathway): boolean {
  const rec = recommendationOf(g, p);
  // a treatment after the last decision is a recommendation, wherever the route ends
  if (rec.found && rec.tier === "treatment") return true;
  // a route that hands over to another page, or stops at an open branch, ends in no recommendation (never a page heading)
  if (!isRecommendationEnd(p)) return false;
  const key = rec.key;
  if (key.kind === "unknown" || key.kind === "uncoded") return false;
  const kn = g.node(key.node);
  if (g.bundle.structured) return kn?.decision !== "condition" && !/condition/.test(kn?.role ?? "");
  return !(key === p.steps[p.steps.length - 1] && !!g.preds[key.node]);
}

export interface RecGroup {
  /** one per distinct recommendation: the set of options the guideline lists at the step, or the headline's wording */
  key: string;
  /** the route that stands for the group (its most likely, NCCN-preferred first) */
  route: Pathway;
  rec: Recommendation;
  /** every route that ends in this recommendation */
  routes: Pathway[];
  /** their share of the fit */
  share: number;
}
const BANDS = ["Best match", "Also possible", "Less likely", "Unlikely"];
const normText = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The distinct recommendations the ranking offers, best first. Routes that differ only in which of
 * the options the guideline lists side by side they follow are ONE recommendation (the options are
 * all shown); identical headlines count once. Routes that stop before a recommendation are not here.
 * Within a likelihood band, NCCN-preferred comes first.
 */
export function distinctRecommendations(g: Graph, ranking: Ranking): RecGroup[] {
  const groups = new Map<string, RecGroup>();
  ranking.paths.forEach((p) => {
    if (!reachesRecommendation(g, p)) return;
    const rec = recommendationOf(g, p, ranking.paths);
    const key = rec.options.length > 1 ? `opts:${[...rec.options].sort().join("|")}` : `txt:${normText(stripMarks(g.node(rec.key.node)?.text ?? rec.key.node))}`;
    const have = groups.get(key);
    if (have) { have.routes.push(p); have.share += p.likelihood; }
    else groups.set(key, { key, route: p, rec, routes: [p], share: p.likelihood });
  });
  const list = [...groups.values()];
  const idx = new Map(list.map((x, i) => [x.key, i] as const));
  const band = (x: RecGroup) => BANDS.indexOf(matchWord(x.share));
  const pref = (x: RecGroup) => Math.min(...x.rec.options.map((o) => optionPreference(g, o)));
  return list.sort((a, b) => band(a) - band(b) || pref(a) - pref(b) || b.share - a.share || idx.get(a.key)! - idx.get(b.key)!);
}

/** The route the recommendation card is about: the one the clinician picked, else the top route when it stops short of a recommendation, else the best distinct recommendation. */
export function shownRoute(g: Graph, ranking: Ranking, pathSel: string | null): Pathway | null {
  const top = ranking.paths[0];
  if (!top) return null;
  const picked = pathSel ? ranking.paths.find((x) => x.id === pathSel) : undefined;
  if (picked) return picked;
  if (!reachesRecommendation(g, top)) return top;
  return distinctRecommendations(g, ranking)[0]?.route ?? top;
}

/** The raw facts that decide where a patient enters the guideline (for "start with ..." hints). */
export function startingFacts(g: Graph, limit = 6): string[] {
  const linked = new Set<string>();
  for (const [id, ks] of Object.entries(g.bundle.children)) ks.forEach((k) => { if (k.split(":")[0] !== id.split(":")[0]) linked.add(k.split(":")[0]); });
  g.bundle.links.forEach(([q, p]) => { if (q !== p) linked.add(p); });
  const starts = g.flowPages.filter((p) => (g.bundle.roots[p] ?? []).length && !linked.has(p));
  const pages = starts.length ? starts : g.flowPages.slice(0, 1);
  const out: string[] = [];
  const sv = g.bundle.sections?.variable;
  if (sv && g.bundle.schema.variables[sv]) out.push(sv);
  for (const p of pages) for (const r of g.bundle.roots[p] ?? []) {
    const decide = (id: string) => {
      for (const f of missingFacts(g, g.preds[id] ?? g.node(id)?.linkCond, {})) if (!out.includes(f)) out.push(f);
    };
    decide(r);
    g.kids(r).forEach(decide);   // the first branch after the entry box
  }
  return out.slice(0, limit);
}
