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
import { remainingQuestions, type Decider } from "./formAssist";
import { rankPathways, type Ranking } from "./pathways";
import { stripMarks } from "./adapt";

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
    for (const f of [...top.missing, ...top.laterMissing]) {
      if (out.has(f) || !vars[f] || answered(facts, f)) continue;
      const end = top.steps[top.steps.length - 1].node;
      out.set(f, { fact: f, share: top.likelihood, node: end, page: end.split(":")[0], text: clip(stripMarks(g.node(end)?.text ?? end).replace(/\s+/g, " ")) });
    }
    // what the trail stops for
    try {
      const trail = rulesOnlyTrail(g, facts, trailStart(ranking, start), opts.overrides ?? {});
      if (trail.stoppedFor === "ask" || trail.stoppedFor === "not-enough") {
        for (const f of trail.missing ?? []) {
          if (out.has(f) || !vars[f] || answered(facts, f)) continue;
          out.set(f, { fact: f, share: top.likelihood, node: trail.end, page: trail.end.split(":")[0], text: clip(stripMarks(g.node(trail.end)?.text ?? trail.end).replace(/\s+/g, " ")) });
        }
      }
    } catch { /* the trail is a hint here; the routes' own details stand */ }
  }
  return [...out.values()].sort((a, b) => b.share - a.share).slice(0, limit);
}
