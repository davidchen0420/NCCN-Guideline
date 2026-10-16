/**
 * The decision trail for a patient: the walk from the starting point by the encoded rules and the
 * clinician's choices, which is always there at once (it is computed in the render), and, when
 * AI decision support is on, the same walk with the model's probabilities for the branches the
 * rules leave open (computed a moment after the last change, stale runs cancelled, answers
 * remembered by lib/decide).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Facts } from "../types";
import type { Graph } from "./graph";
import { aiWalk, DEFAULT_THRESHOLD, edgeProbFromTrail, rulesOnlyTrail, type AiWalkResult, type ScoreFn } from "./aiWalk";

export interface AiTrailConfig {
  /** ask the model about the branches the rules leave open (default false) */
  enabled?: boolean;
  /** probability at or above which the model's top choice is followed without asking */
  threshold?: number;
  /** wait this long after the answers change before asking the model (default 400 ms) */
  debounceMs?: number;
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

export function useAiTrail(g: Graph, facts: Facts, start: string, overrides: Record<string, string>, cfg: AiTrailConfig = {}): AiTrail {
  // AI is asked only for a patient with something entered; a blank one shows the rules-only trail
  const enabled = !!cfg.enabled && hasInput(facts, overrides);
  const threshold = cfg.threshold ?? DEFAULT_THRESHOLD;
  const debounceMs = cfg.debounceMs ?? 400;
  const score = cfg.score;
  const factsKey = JSON.stringify(facts);
  const key = trailKey(g, facts, start, overrides, enabled, threshold);

  const rulesKey = JSON.stringify([start, facts, overrides]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rules = useMemo(() => rulesOnlyTrail(g, facts, start, overrides), [g, rulesKey]);

  // the rules settle everything the walk reaches: no node needs the model, so nothing is asked or waited for
  const skip = enabled && !needsModel(rules, overrides);
  const [done, setDone] = useState<{ key: string; res: AiWalkResult } | null>(null);
  const lastFacts = useRef(factsKey);
  useEffect(() => {
    if (!enabled || skip) { setDone(null); lastFacts.current = factsKey; return; }
    // a new answer waits a moment (the clinician is still typing); a choice, the threshold or the starting point is asked at once
    const wait = lastFacts.current === factsKey ? 0 : debounceMs;
    lastFacts.current = factsKey;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      aiWalk(g, facts, start, { threshold, overrides, score, decide: { signal: ctl.signal } }).then((res) => {
        if (!ctl.signal.aborted) setDone({ key, res });
      });
    }, wait);
    return () => { clearTimeout(timer); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = enabled && done?.key === key ? done.res : null;
  const failed = !!current && current.stoppedFor === "error";
  const ai = current && !failed ? current : null;
  const edgeProb = useMemo(() => (ai ? edgeProbFromTrail(ai) : undefined), [ai]);
  return {
    rules, ai, trail: ai ?? rules, failed, edgeProb,
    loading: enabled && !current && !skip,
    settled: !enabled || !!current || skip,
  };
}
