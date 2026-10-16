import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useApp } from "../store";
import { useSource, type SrcTarget } from "../source";
import type { AiWalkResult, TrailOption, TrailStep } from "../lib/aiWalk";
import type { Pathway } from "../lib/pathways";
import { decisionSteps, favouredByAi, percent, questionText, readable, trailStats, trailSummary, trimToRoute } from "../lib/trailView";
import { label } from "../lib/factMeta";
import type { Graph } from "../lib/graph";
import "../styles/trail.css";

/** The NCCN page and box a trail option stands for, to open in the page window. */
function sourceOf(g: Graph, id: string): SrcTarget | null {
  const n = g.node(id);
  const pdf = g.bundle.pages[n?.page ?? ""]?.pdf;
  if (!n || pdf === undefined || pdf === null) return null;
  return { page: pdf, bbox: n.bbox, label: n.page, excerpt: n.text.replace(/\u0017/g, "◦") };
}

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);
const MORE_AFTER = 6;

/** What is said about one option, in the words a clinician reads: where its yes or no came from. */
function badgeOf(o: TrailOption): { text: string; cls: string } | null {
  if (o.source === "clinician") return { text: "You chose", cls: "you" };
  if (o.source === "rule") return o.verdict === false ? { text: "Rule ✗", cls: "rule no" } : { text: "Rule ✓", cls: "rule" };
  if (o.source === "ai" && typeof o.prob === "number") return { text: `AI ${percent(o.prob)}`, cls: "ai" };
  return null;
}

/** The confidence bar: a rule is full or empty; the AI shows its probability; nothing known shows nothing. */
function barOf(o: TrailOption): number | null {
  if (o.source === "rule") return o.verdict === false ? 0 : 1;
  return typeof o.prob === "number" ? o.prob : null;
}

function Option({ step, o, threshold, onChoose, onUndo, g }: {
  step: TrailStep; o: TrailOption; threshold: number; onChoose: (child: string) => void; onUndo: () => void; g: Graph;
}) {
  const { open } = useSource();
  const chosen = o.child === step.chosen;
  const badge = badgeOf(o);
  const bar = barOf(o);
  const src = sourceOf(g, o.child);
  // beside a rule or a choice of yours, what the AI thought of it, when it was asked
  const aiToo = typeof o.prob === "number" && o.source !== "ai" ? `AI ${percent(o.prob)}` : null;
  const low = bar !== null && o.source !== "rule" && bar < threshold;
  return (
    <li className={`tr-opt${chosen ? " chosen" : ""}`} aria-current={chosen ? "true" : undefined}>
      <div className="tr-opt-main">
        <span className="tr-opt-t" title={o.text}>{clip(readable(g, o.text), 150)}</span>
        {badge && <span className={`tr-badge ${badge.cls}`}>{badge.text}</span>}
        {aiToo && <span className="tr-badge ai muted">{aiToo}</span>}
      </div>
      {bar !== null && <span className={`tr-bar${low ? " low" : ""}${o.source === "rule" ? " rule" : ""}`} aria-hidden><i style={{ width: `${Math.round(bar * 100)}%` }} /></span>}
      <div className="tr-opt-act">
        {chosen
          ? (step.by === "clinician" && <button type="button" className="linkish tr-act" onClick={onUndo}>Take back my choice</button>)
          : <button type="button" className="linkish tr-act" onClick={() => onChoose(o.child)}>Choose this instead</button>}
        {src && <button type="button" className="linkish tr-act" onClick={() => open(src)}>Show on NCCN page</button>}
      </div>
    </li>
  );
}

function Decision({ step, n }: { step: TrailStep; n: number }) {
  const { g, setOverride, ai } = useApp();
  const [all, setAll] = useState(false);
  const fav = step.disagree ? favouredByAi(step) : null;
  // the chosen option first among the options shown, the rest in the order the trail gives them
  const options = useMemo(() => {
    const first = step.options.filter((o) => o.child === step.chosen);
    const rest = step.options.filter((o) => o.child !== step.chosen);
    return [...first, ...rest];
  }, [step]);
  const shown = all ? options : options.slice(0, MORE_AFTER);
  return (
    <li className="tr-step" data-page={step.page}>
      <div className="tr-q"><span className="tr-n" aria-hidden>{n}</span><span>{clip(questionText(g, step.node), 220)}</span></div>
      {fav && <p className="tr-warn" role="note">The AI favoured ‘{clip(fav.text, 90)}’ ({percent(fav.prob!)}); the guideline rule was followed.</p>}
      <ul className="tr-opts">
        {shown.map((o) => (
          <Option key={o.child} step={step} o={o} g={g} threshold={ai.threshold}
            onChoose={(child) => setOverride(step.node, child)} onUndo={() => setOverride(step.node, null)} />
        ))}
      </ul>
      {options.length > MORE_AFTER && (
        <button type="button" className="linkish tr-act" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer options" : `Show ${options.length - MORE_AFTER} more option${options.length - MORE_AFTER === 1 ? "" : "s"}`}
        </button>
      )}
    </li>
  );
}

/** Where the walk could not go on by itself: the clinician decides, or says what is missing. */
function Stop({ quiet, t }: { quiet: boolean; t: AiWalkResult }) {
  const { g, ai, setOverride, focusFact } = useApp();
  if (!t.stoppedFor || t.stoppedFor === "error") return null;
  const q = clip(questionText(g, t.end), 220);
  const pg = g.node(t.end)?.page;
  const where = pg ? <p className="tr-fine">On the NCCN page {g.bundle.pages[pg]?.title ? `${g.bundle.pages[pg].title} (${pg})` : pg}.</p> : null;
  const options = t.options ?? [];
  const missing = (t.missing ?? []).slice(0, 8);
  const list = (
    <ul className="tr-opts">
      {options.slice(0, 8).map((o) => (
        <li key={o.child} className="tr-opt">
          <div className="tr-opt-main">
            <span className="tr-opt-t" title={o.text}>{clip(readable(g, o.text), 150)}</span>
            {typeof o.prob === "number" && <span className="tr-badge ai">AI {percent(o.prob)}</span>}
            {o.verdict === false && <span className="tr-badge rule no">Rule ✗</span>}
          </div>
          {typeof o.prob === "number" && <span className="tr-bar" aria-hidden><i style={{ width: `${Math.round(o.prob * 100)}%` }} /></span>}
          <div className="tr-opt-act">
            <button type="button" className="btn small tr-pick" aria-label={`Choose: ${clip(o.text, 80)}`} onClick={() => setOverride(t.end, o.child)}>Choose</button>
          </div>
        </li>
      ))}
    </ul>
  );
  if (t.stoppedFor === "not-enough") {
    return (
      <div className={`tr-stop${quiet ? " quiet" : ""}`} role="group" aria-label="Not enough information">
        <h4 className="tr-stop-h">Not enough information to decide {q}</h4>
        {where}
        {missing.length > 0 ? (
          <>
            <p className="tr-fine">Answering {missing.length === 1 ? "this" : "one of these"} would settle it:</p>
            <div className="rc-qs">{missing.map((m) => <button key={m} type="button" className="rc-q" onClick={() => focusFact(m)}>{label(m)}</button>)}</div>
          </>
        ) : options.length > 0 && <><p className="tr-fine">Choose it yourself:</p>{list}</>}
      </div>
    );
  }
  return (
    <div className={`tr-stop${quiet ? " quiet" : ""}`} role="group" aria-label={quiet ? "Open choice" : "Your decision needed"}>
      <h4 className="tr-stop-h">{quiet ? "Still open" : "Your decision needed"}: {q}</h4>
      {where}
      {!quiet && (options.some((o) => typeof o.prob === "number")
        ? <p className="tr-fine">The AI was not confident enough to choose for you (it needs at least {percent(ai.threshold)}).</p>
        : <p className="tr-fine">The guideline does not encode this choice, so it is yours to make.</p>)}
      {quiet && <p className="tr-fine">The answers entered do not settle this step. Choose, or answer more questions.</p>}
      {list}
    </div>
  );
}

/**
 * "How we got here": the decisions the guideline's rules, the AI and the clinician made on the
 * way to the recommendation, each with all of its options. Collapsed to one line by default.
 */
export function DecisionTrail({ p }: { p?: Pathway }) {
  const { ai } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const f = () => {
      setOpen(true);
      window.setTimeout(() => document.getElementById("rc-trail")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 40);
    };
    window.addEventListener("oc-open-trail", f);
    return () => window.removeEventListener("oc-open-trail", f);
  }, []);
  // the decisions on the way to the recommendation shown (not the pages that follow it)
  const t = useMemo(() => (p ? trimToRoute(ai.trail, new Set(p.steps.map((x) => x.node))) : ai.trail), [ai.trail, p]);
  const steps = useMemo(() => decisionSteps(t), [t]);
  const st = useMemo(() => trailStats(t), [t]);
  const stopped = t.stoppedFor === "ask" || t.stoppedFor === "not-enough";
  const aiDone = ai.on && !!ai.ai;   // the AI has answered for these answers (the trail is not the rules-only stand-in)
  if (!steps.length && !stopped && !(ai.on && ai.failed)) return null;
  const summary = steps.length ? trailSummary(st, ai.on) : "No decisions made yet";
  return (
    <section id="rc-trail" className="how-trail" aria-label="How we got here">
      {aiDone && stopped && <Stop quiet={false} t={t} />}
      {ai.on && ai.failed && <p className="tr-fine tr-muted">AI scoring unavailable — showing the guideline rules only.</p>}
      <button type="button" className="tr-head" aria-expanded={open} aria-controls="tr-body" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
        <span className="tr-title">How we got here</span>
        <span className="tr-sum" data-testid="trail-summary">{summary}</span>
        {ai.on && ai.loading && <span className="tr-wait" role="status"><Sparkles size={12} aria-hidden /> AI checking…</span>}
      </button>
      {open && (
        <div id="tr-body" className="tr-body">
          {steps.length > 0 && <ol className="tr-steps">{steps.map((s, i) => <Decision key={`${s.node}>${s.chosen}`} step={s} n={i + 1} />)}</ol>}
          {!aiDone && !ai.loading && stopped && <Stop quiet t={t} />}
          {ai.on && ai.model && steps.some((s) => s.by === "ai") && <p className="tr-fine tr-muted">Scored by {ai.model}. The AI never overrides a guideline rule; below {percent(ai.threshold)} it asks you.</p>}
        </div>
      )}
    </section>
  );
}
