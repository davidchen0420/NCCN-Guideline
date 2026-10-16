/**
 * The decision trail for a patient: the walk from the starting point by the encoded rules and the
 * clinician's choices, which is always there at once (it is computed in the render), and, when
 * AI decision support is on, the same walk with the model's probabilities for the branches the
 * rules leave open (computed once the answers have settled, stale runs cancelled, answers
 * remembered by lib/decide).
 *
 * The model is asked as seldom as the answers allow: not while the clinician is still answering
 * (the interview), not again when the new answers leave untouched everything the model was asked about,
 * and a run that is under way is not thrown away for such an answer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Facts } from "../types";
import type { Graph } from "./graph";
import { aiWalk, DEFAULT_THRESHOLD, edgeProbFromTrail, rulesOnlyTrail, type AiWalkResult, type ScoreFn } from "./aiWalk";
import { factsFor } from "./decide";

export interface AiTrailConfig {
  /** ask the model about the branches the rules leave open (default false) */
  enabled?: boolean;
  /** probability at or above which the model's top choice is followed without asking */
  threshold?: number;
  /** wait this long after the answers change before asking the model (default 400 ms) */
  debounceMs?: number;
  /** the clinician is answering questions (the patient tab is open): wait for this much quiet instead (default 1000 ms) */
  interviewIdleMs?: number;
  /** the clinician is answering questions now, not reading the recommendation */
  interviewing?: boolean;
  /** the scorer (tests); default: the local server */
  score?: ScoreFn;
}

export interface AiTrail {
  /** the walk by the rules and the clinician's choices alone */
  rules: AiWalkResult;
  /** the AI-assisted walk for exactly the current inputs, once it has finished; else null */
  ai: AiWalkResult | null;
  /** what to show: the AI walk when there is one that worked, else the rules-only walk */
  trail: AiWalkResult;
  /** the AI is being asked */
  loading: boolean;
  /** the AI was asked and could not answer: the trail is the rules-only walk */
  failed: boolean;
  /** the model's probabilities along the trail, for ranking the other recommendations (undefined without a working AI walk) */
  edgeProb: Map<string, number> | undefined;
  /** nothing is pending: the trail is the answer for the current inputs */
  settled: boolean;
}

/** One string for everything the walk depends on. */
export const trailKey = (g: Graph, facts: Facts, start: string, overrides: Record<string, string>, enabled: boolean, threshold: number): string =>
  JSON.stringify([g.bundle.title, start, facts, overrides, enabled, enabled ? threshold : 0]);

/**
 * Does the walk reach a node the model is needed for? The rules and the clinician's choices decide every
 * branch up to where the rules-only walk stops; the model is asked only at that stop (an open branch), and
 * about the branches the clinician chose between several arms (for the bars). A walk that finishes, or that
 * stops with no arm left to weigh, has nothing to ask the model.
 */
export function needsModel(rules: AiWalkResult, overrides: Record<string, string>): boolean {
  if (Object.keys(overrides).length > 0) return true;
  return (rules.stoppedFor === "ask" || rules.stoppedFor === "not-enough") && (rules.options ?? []).some((o) => o.verdict !== false);
}

/** Is there anything to ask the model about? A blank patient (no answers, no choices) has no facts to weigh. */
const hasInput = (facts: Facts, overrides: Record<string, string>) =>
  Object.keys(overrides).length > 0 || Object.values(facts).some((v) => v !== null && v !== undefined && v !== "" && v !== "unknown");

/**
 * What the model's answer rests on at the start of a walk: the start, the choices, the threshold, how far the
 * rules alone walk and the details the stop (and each box the clinician chose at) rests on. Two answers
 * with the same signature are asked the same thing of the model at the first box; the boxes asked beyond
 * it are checked when the walk is done (`holds`).
 */
export function walkSignature(g: Graph, facts: Facts, start: string, overrides: Record<string, string>, threshold: number, rules: AiWalkResult): string {
  const nodes = [rules.end, ...Object.keys(overrides)];
  return JSON.stringify([g.bundle.title, start, overrides, threshold, rules.stoppedFor ?? null, rules.steps.map((s) => s.chosen), rules.end, nodes.map((n) => factsFor(g, facts, n))]);
}

/** Does a finished walk (made for `used` answers) still hold for `facts`: nothing any box it asked the model about rests on has changed? */
export function holds(g: Graph, res: AiWalkResult, used: Facts, facts: Facts): boolean {
  return (res.scored ?? []).every((n) => JSON.stringify(factsFor(g, used, n)) === JSON.stringify(factsFor(g, facts, n)));
}

export interface WalkInputs {
  g: Graph;
  facts: Facts;
  start: string;
  overrides: Record<string, string>;
  threshold: number;
  /** see walkSignature */
  sig: string;
  /** the answers changed since the last update (a choice, the threshold or the start are asked at once) */
  factsChanged: boolean;
  interviewing: boolean;
  debounceMs: number;
  interviewIdleMs: number;
  score?: ScoreFn;
}

export interface DoneWalk { sig: string; used: Facts; res: AiWalkResult }

/**
 * Decides when the model is asked. One run at a time: a new one replaces it only when what the model is asked
 * has changed; answers that leave that alone neither start a request nor cancel the one under way. While
 * the clinician is answering questions the run waits for a quiet moment.
 */
export class AiTrailScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ctl: AbortController | undefined;
  private run: { sig: string; started: boolean } | undefined;
  private latest: WalkInputs | undefined;
  private changedAt = 0;
  /** requests the model was asked for (walks started), for tests */
  starts = 0;
  constructor(private emit: (d: DoneWalk) => void, private now: () => number = Date.now) {}

  /** The inputs changed. `have`: a finished walk that already answers them. */
  update(i: WalkInputs, have: boolean): void {
    this.latest = i;
    if (i.factsChanged) this.changedAt = this.now();
    if (have) { this.cancel(); return; }
    // quiet the model's question needs after the last change of the answers: longer while questions are being answered
    const wait = () => Math.max(0, this.changedAt + (i.interviewing ? i.interviewIdleMs : i.debounceMs) - this.now());
    if (this.run && this.run.sig === i.sig) {
      // the model is asked the same thing: keep the run (or its wait), but not for longer than the quiet it needs now
      if (!this.run.started && this.timer !== undefined) { clearTimeout(this.timer); this.timer = setTimeout(() => this.start(), wait()); }
      return;
    }
    this.cancel();
    this.run = { sig: i.sig, started: false };
    // a new answer waits for quiet (the clinician is still answering); a choice, the threshold or the starting point is asked at once
    this.timer = setTimeout(() => this.start(), i.factsChanged ? wait() : 0);
  }

  private start(): void {
    const i = this.latest, run = this.run;
    this.timer = undefined;
    if (!i || !run) return;
    run.started = true;
    this.starts++;
    const ctl = (this.ctl = new AbortController());
    const used = i.facts;
    aiWalk(i.g, used, i.start, { threshold: i.threshold, overrides: i.overrides, score: i.score, decide: { signal: ctl.signal } }).then((res) => {
      if (ctl.signal.aborted || this.run !== run) return;
      const now = this.latest!;
      if (now.sig !== run.sig) return;
      if (res.stoppedFor !== "error" && !holds(now.g, res, used, now.facts)) {
        // answers given while the model was asked changed something it was asked about: ask again, for the latest
        this.run = { sig: run.sig, started: false };
        this.start();
        return;
      }
      this.emit({ sig: run.sig, used, res });
    });
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.ctl?.abort();
    this.ctl = undefined;
    this.run = undefined;
  }
}

export function useAiTrail(g: Graph, facts: Facts, start: string, overrides: Record<string, string>, cfg: AiTrailConfig = {}): AiTrail {
  // AI is asked only for a patient with something entered; a blank one shows the rules-only trail
  const enabled = !!cfg.enabled && hasInput(facts, overrides);
  const threshold = cfg.threshold ?? DEFAULT_THRESHOLD;
  const debounceMs = cfg.debounceMs ?? 400;
  const interviewIdleMs = cfg.interviewIdleMs ?? 1000;
  const interviewing = !!cfg.interviewing;
  const score = cfg.score;
  const factsKey = JSON.stringify(facts);

  const rulesKey = JSON.stringify([start, facts, overrides]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rules = useMemo(() => rulesOnlyTrail(g, facts, start, overrides), [g, rulesKey]);

  // the rules settle everything the walk reaches: no node needs the model, so nothing is asked or waited for
  const skip = enabled && !needsModel(rules, overrides);
  const sig = useMemo(
    () => (enabled && !skip ? walkSignature(g, facts, start, overrides, threshold, rules) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [g, rules, enabled, skip, threshold, factsKey]);

  const [done, setDone] = useState<DoneWalk | null>(null);
  const sched = useRef<AiTrailScheduler | null>(null);
  if (!sched.current) sched.current = new AiTrailScheduler((d) => setDone(d));
  useEffect(() => () => sched.current?.cancel(), []);

  // a finished walk answers these inputs when it was made for the same question and nothing it asked about has changed since
  const current = enabled && !skip && done && done.sig === sig && holds(g, done.res, done.used, facts) ? done.res : null;

  const lastFacts = useRef(factsKey);
  useEffect(() => {
    const factsChanged = lastFacts.current !== factsKey;
    lastFacts.current = factsKey;
    if (!enabled || skip) { sched.current!.cancel(); setDone(null); return; }
    sched.current!.update({ g, facts, start, overrides, threshold, sig, factsChanged, interviewing, debounceMs, interviewIdleMs, score }, !!current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, sig, factsKey, interviewing, enabled, skip, current]);

  const failed = !!current && current.stoppedFor === "error";
  const ai = current && !failed ? current : null;
  const edgeProb = useMemo(() => (ai ? edgeProbFromTrail(ai) : undefined), [ai]);
  return {
    rules, ai, trail: ai ?? rules, failed, edgeProb,
    loading: enabled && !current && !skip,
    settled: !enabled || !!current || skip,
  };
}
