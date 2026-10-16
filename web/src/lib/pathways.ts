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
    if (late || !split) return own === true || lcv === true;
    if (lcv !== true && (lc || own === "none")) return false;
    const seen = new Set<string>();
    const open = (x: string): boolean => {
      if (seen.has(x)) return false;
      seen.add(x);
      const ps = g.parents[x] ?? [];
      return !ps.length || ps.some((p) => !(g.preds[p] && evaluate(g.preds[p], facts) === false) && open(p));
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
    unk.forEach((gr) => out.push({ gr, kind: "unknown", share: tr.length ? RESIDUAL : 1 }));
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
    let kids = g.kids(id).filter((k) => !seen.has(k) && inSection(k.split(":")[0]));
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
    // Cells of a structured table row (criteria, evaluation, "see PROS-4") read as one row.
    const tableCell = /^table_/.test(g.node(id)?.role ?? "");
    const pass = cond || tableCell || linksOut(id) || (steps.length > 1 && isCond(steps[steps.length - 2].node, steps.length - 2));
    const groups = g.bundle.structured ? kids.map((id) => ({ id, pre: [] as string[] })) : rowGroups(kids);
    const sibs = groups.map((gr) => gr.id);
    const go = (gr: Group, kind: StepKind, share: number) => {
      const nx = new Set(seen); gr.pre.forEach((p) => nx.add(p)); nx.add(gr.id);
      const add = [...preSteps(id, gr), stepFor(id, gr.id, targetKind(gr, kind), share, sibs)];
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
        return finish(steps, weight, "later", kids, open);
      }
    }
    const v = groups.map((gr) => gVerdict(gr));
    if (v.every((x) => x === false)) {
      ruledOut += groups.length;
      // Out of a condition box, no arm fits: this route contradicts the facts. Out of a
      // recommendation, the arms are later events that have not happened (or not like this).
      return cond ? undefined : stop(id, steps, weight, kids);
    }
    if (groups.length === 1) {
      const gr = groups[0];
      if (v[0] === true) return go(gr, "met", 1);
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
    split(entries.map((id) => ({ id, pre: [] })), false).forEach((o) =>
      dfs(o.gr.id, [stepFor(null, o.gr.id, o.kind, o.share, entries)], o.share, new Set([o.gr.id])));
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
    const cands = g.flowPages.filter((p) => {
      if (starts.includes(p) || !inSection(p) || [...reachedPages].some((q) => q !== p && out.get(q)?.has(p))) return false;
      if (textMatches(g, g.bundle.pages[p].title ?? "", raw).other) return false;
      return (g.bundle.roots[p] ?? []).some((r) => !reachedNodes.has(r) && startOk(r));
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
      const extra = sectionStartPages(g, mySec).flatMap((p) => g.bundle.roots[p] ?? []).filter((r) => !starts.includes(r.split(":")[0]));
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
