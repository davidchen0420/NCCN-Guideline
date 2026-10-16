/**
 * What is still open for a patient, defined once.
 *
 * The interview ("which question next", "that's every question"), the recommendation card ("Still
 * unknown") and the decision trail ("answering X would settle it") used to count open details by
 * different rules, so the form could say it had asked everything while the trail still wanted an
 * answer. `openDetails` is the union of what each of them can ask for:
 *
 * - the details the best routes (and those about as likely) still turn on, including the later
 *   event a route stops before (formAssist.remainingQuestions);
 * - the details the best route itself lists as missing;
 * - the details that would settle the branch the rule-only trail stops at.
 *
 * Details the clinician already answered (including "don't know") are never open: asking again
 * would not help. When details were entered and no route is left, nothing is open.
 */
import type { Facts } from "../types";
import type { Graph } from "./graph";
import { rulesOnlyTrail } from "./aiWalk";
import { decidingFacts, remainingQuestions, type Decider } from "./formAssist";
import { rankPathways, reachesRecommendation, recommendationOf, shownRoute, type Ranking } from "./pathways";
import { stripMarks } from "./adapt";
import { askFilter, askableQuestions, nextActionPage, pageDeciders } from "./moments";
import { isPendingDecision, trimToRoute } from "./trailView";

export interface OpenOptions {
  /** the ranking for these facts and this start, when the caller has it already */
  ranking?: Ranking;
  /** the clinician's choices at branches (box id -> child) */
  overrides?: Record<string, string>;
  /** most details to return (default 12) */
  limit?: number;
}

const answered = (facts: Facts, f: string) => facts[f] !== undefined && facts[f] !== null && facts[f] !== "";
const clip = (t: string, n = 90) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);

/** The node the decision trail starts at for this ranking (as the reader's store picks it). */
export function trailStart(ranking: Ranking, start: string): string {
  return start === "auto" && ranking.paths[0] ? ranking.paths[0].steps[0].node : start;
}

export function openDetails(g: Graph, facts: Facts, start: string = "auto", opts: OpenOptions = {}): Decider[] {
  const limit = opts.limit ?? 12;
  const ranking = opts.ranking ?? rankPathways(g, facts, start, { overrides: opts.overrides });
  const vars = g.bundle.schema?.variables ?? {};
  const out = new Map<string, Decider>();
  for (const d of remainingQuestions(g, ranking, facts, 64)) out.set(d.fact, d);
  const top = ranking.paths[0];
  if (top) {
    const rec0 = recommendationOf(g, top, ranking.paths);
    for (const f of [...top.missing, ...(rec0.found && rec0.tier === "treatment" && rec0.index + 1 < top.steps.length ? [] : top.laterMissing)]) {
      if (out.has(f) || !vars[f] || answered(facts, f)) continue;
      const end = top.steps[top.steps.length - 1].node;
      out.set(f, { fact: f, share: top.likelihood, node: end, page: end.split(":")[0], text: clip(stripMarks(g.node(end)?.text ?? end).replace(/\s+/g, " ")) });
    }
    // what the trail stops for
    try {
      const trail = rulesOnlyTrail(g, facts, trailStart(ranking, start), opts.overrides ?? {});
      // A stop behind the treatment the route recommends now (the margin of a resection that has not
      // happened) is for later: it does not change what to do now.
      const rec = recommendationOf(g, top, ranking.paths);
      const behind = rec.found && rec.tier === "treatment" && top.steps.findIndex((s) => s.node === trail.end) > rec.index;
      if (!behind && (trail.stoppedFor === "ask" || trail.stoppedFor === "not-enough")) {
        for (const f of trail.missing ?? []) {
          if (out.has(f) || !vars[f] || answered(facts, f)) continue;
          out.set(f, { fact: f, share: top.likelihood, node: trail.end, page: trail.end.split(":")[0], text: clip(stripMarks(g.node(trail.end)?.text ?? trail.end).replace(/\s+/g, " ")) });
        }
      }
    } catch { /* the trail is a hint here; the routes' own details stand */ }
  }
  return [...out.values()].sort((a, b) => b.share - a.share).slice(0, limit);
}


/**
 * The details the recommendation card names as settling what it shows, in the route's order: the
 * answers to the decision it is provisional on ("Answering one of these would settle it"), or, for a
 * route that stops before any recommendation, the details it asks for. Empty when the card names none.
 */
export function cardSettlerDetails(g: Graph, facts: Facts, start: string = "auto", opts: OpenOptions = {}): Decider[] {
  const ranking = opts.ranking ?? rankPathways(g, facts, start, { overrides: opts.overrides });
  const p = shownRoute(g, ranking, null);
  if (!p) return [];
  const worth = namedByCard(g, facts, start, ranking);
  const at = (f: string, node: string): Decider => ({ fact: f, share: p.likelihood, node, page: node.split(":")[0], text: clip(stripMarks(g.node(node)?.text ?? node).replace(/\s+/g, " ")) });
  if (reachesRecommendation(g, p)) {
    const trail = trimToRoute(rulesOnlyTrail(g, facts, trailStart(ranking, start), opts.overrides ?? {}), new Set(p.steps.map((x) => x.node)));
    if (!isPendingDecision(trail) || trail.optionArms) return [];
    return [...new Set(trail.missing ?? [])].filter((f) => worth(f, trail.end.split(":")[0])).slice(0, 8).map((f) => at(f, trail.end));
  }
  if (p.end === "continues" && p.continuesTo) return [];
  const end = p.steps[p.steps.length - 1]?.node ?? "";
  const names = [...openDetails(g, facts, start, opts).map((d) => d.fact), ...p.missing, ...p.laterMissing];
  return [...new Set(names)].filter((f) => worth(f, end.split(":")[0])).map((f) => at(f, end));
}
export const cardSettlers = (g: Graph, facts: Facts, start: string = "auto", opts: OpenOptions = {}): string[] =>
  cardSettlerDetails(g, facts, start, opts).map((d) => d.fact);

/**
 * Which details a card may name as worth answering now: unanswered, and not about a later stage of the
 * course, a detail the data defines as found only later (a response at restaging), or another disease's
 * page. `page` is the page of the box the detail decides.
 */
export function namedByCard(g: Graph, facts: Facts, start: string, ranking?: Ranking): (fact: string, page: string) => boolean {
  const vars = g.bundle.schema?.variables ?? {};
  const ok = askFilter(g, facts, start, () => true, ranking ?? rankPathways(g, facts, start));
  return (fact, page) => !!vars[fact] && ok({ fact, page, share: 1, node: "", text: "" });
}

/**
 * The questions the interview asks, in the order it asks them: first the details the recommendation card
 * would name as settling its decision (in the route's order), so the question asked is the one the card
 * is waiting for; then the details that decide the routes still open, then whatever else is open. Only
 * when none of those is left does it look further ahead, to what decides where the routes lead on.
 * `keep` limits the details to those in scope for the form.
 */
export function interviewQuestions(g: Graph, ranking: Ranking, facts: Facts, start: string, overrides: Record<string, string>, keep: (fact: string) => boolean = () => true, keepLead: (fact: string) => boolean = keep, limit = 12): Decider[] {
  const ok = askFilter(g, facts, start, keep, ranking);
  const direct = decidingFacts(g, ranking, facts, 24).filter(ok);
  const extra = openDetails(g, facts, start, { ranking, overrides }).filter((d) => ok(d) && !direct.some((b) => b.fact === d.fact));
  let all = [...direct, ...extra];
  // (nothing open on the routes themselves: what decides where they lead on)
  if (!all.length) all = askableQuestions(g, ranking, facts, start, keep);
  // (what the card names is asked even when it lies outside the form's scope for this start: the card sent the reader here)
  const okLead = askFilter(g, facts, start, keepLead, ranking);
  // a start that only gives background (a definition page): the questions are those of the first page that says what to do
  if (!all.length) {
    const at = start === "auto" ? ranking.paths[0]?.steps[0]?.node.split(":")[0] : start;
    const next = at ? nextActionPage(g, at) : null;
    if (next) all = pageDeciders(g, next, facts).filter((d) => keepLead(d.fact) && !answered(facts, d.fact));
  }
  let settle: Decider[] = [];
  try { settle = cardSettlerDetails(g, facts, start, { ranking, overrides }); } catch { /* the card's own list is a hint here */ }
  const lead = settle.map((s) => all.find((d) => d.fact === s.fact) ?? s).filter(okLead);
  return [...lead, ...all.filter((d) => !lead.some((l) => l.fact === d.fact))].slice(0, limit);
}
