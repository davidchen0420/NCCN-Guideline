/**
 * Wayfinding in the reader: where you are in the three steps (patient, recommendation, the NCCN
 * page) and the one thing worth doing next, with a button that does it.
 */
import { useEffect, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { useApp } from "../store";
import { startingFacts } from "../lib/pathways";
import { fieldCount, filledCount, label } from "../lib/factMeta";
import { readFlag, writeFlag } from "../lib/prefs";
import { T } from "../lib/terms";

export const GUIDE_KEY = "oc-guide-hidden";
const GUIDE_EVENT = "oc-guide-hidden-changed";
const HINT_KEY = "oc-canvas-hint";
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Hide or show the 3-step guide (remembered in this browser; Settings and the guide both use it). */
export function setGuideHidden(hidden: boolean): void {
  writeFlag(GUIDE_KEY, hidden);
  window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: hidden }));
}
export function useGuideHidden(): boolean {
  const [hidden, setHidden] = useState(() => readFlag(GUIDE_KEY));
  useEffect(() => {
    const f = (e: Event) => setHidden(!!(e as CustomEvent).detail);
    window.addEventListener(GUIDE_EVENT, f);
    return () => window.removeEventListener(GUIDE_EVENT, f);
  }, []);
  return hidden;
}

export function GuideBar() {
  const { s, g, set, ranking, focusFact, setFacts, bundle } = useApp();
  const hidden = useGuideHidden();
  if (hidden) {
    return <button type="button" className="guide-show" onClick={() => setGuideHidden(false)}>Show the 3-step guide</button>;
  }
  const schema = bundle.schema;
  const filled = schema ? filledCount(s.facts, schema) : 0;
  const total = schema ? fieldCount(schema) : 0;
  const n = ranking.paths.length;
  const step = filled === 0 ? 1 : s.pathSel === null && s.rightTab !== "paths" ? 1 : s.pathSel === null ? 2 : 3;
  const steps: [number, string, string, () => void][] = [
    [1, "Patient", filled ? `${filled} of ${total} answered` : "start here", () => set({ rightTab: "patient", sheet: true })],
    [2, "Recommendation", n ? `${n} possible` : "none yet", () => set({ rightTab: "paths", sheet: true })],
    [3, "Check the NCCN page", "hover a step", () => set({ rightTab: "paths", sheet: true })],
  ];
  const start = startingFacts(g, 3);
  const examples = bundle.examples ?? [];
  let next: React.ReactNode;
  if (!total) next = <>This guideline has no patient questions to answer: open <b>Recommendation</b>, or click steps on the diagram.</>;
  else if (filled === 0) {
    next = (<>
      {start.length > 0
        ? <>Start with{" "}{start.map((f, i) => <span key={f}>{i > 0 && (i === start.length - 1 ? " and " : ", ")}<button type="button" className="need" onClick={() => focusFact(f)}>{label(f)}</button></span>)} — they decide the first steps.</>
        : <>Start with what the record says.</>}
      {examples.length > 0 && <> Or <button type="button" className="need" onClick={() => { setFacts({ ...examples[0].facts }); set({ age: examples[0].age ?? null, pathSel: null, rightTab: "paths" }); }}>load an example patient</button>.</>}
    </>);
  } else if (s.rightTab === "patient") {
    next = (<>
      {ranking.nextBest && ranking.nextBest.share > 0.15
        ? <><b>Best next question:</b> <button type="button" className="need" onClick={() => focusFact(ranking.nextBest!.fact)}>{label(ranking.nextBest.fact)}</button>{s.advanced ? <> (open on routes holding {pct(ranking.nextBest.share)} of the fit)</> : null}. </>
        : <>That is enough to narrow it down. </>}
      {n > 0
        ? <button type="button" className="guide-go" onClick={() => set({ rightTab: "paths" })}>See {n} possible {n === 1 ? T.recommendation : T.recommendations} <ArrowRight size={12} aria-hidden /></button>
        : <span>No {T.recommendation} fits these answers yet.</span>}
    </>);
  } else if (s.rightTab === "paths" && s.pathSel === null) {
    next = <><b>Pick an option</b> to light it up on the diagram and list its steps. The first one is the best match.</>;
  } else {
    next = <><b>Hover a step</b> to see its NCCN page; click to open it in its own window.</>;
  }
  return (
    <div className="guide" role="region" aria-label="Steps">
      <ol className="guide-steps">
        {steps.map(([k, t, sub, f]) => (
          <li key={k} className={k < step ? "done" : k === step ? "on" : ""}>
            <button type="button" onClick={f} aria-current={k === step ? "step" : undefined}>
              <span className="gs-n" aria-hidden>{k < step ? <Check size={11} /> : k}</span>
              <span className="gs-t">{t}</span><span className="gs-s">{sub}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="guide-next">{next}</p>
      <button type="button" className="guide-x" aria-label="Hide these steps" title="Hide these steps (Settings brings them back)" onClick={() => setGuideHidden(true)}><X size={13} /></button>
    </div>
  );
}

/** First visit to the algorithm canvas: how to move around it. */
export function CanvasHint() {
  const { s, set, isPhone } = useApp();
  const [show, setShow] = useState(() => !readFlag(HINT_KEY));
  const close = () => { setShow(false); writeFlag(HINT_KEY, true); };
  useEffect(() => {
    // "?" opens the help from anywhere outside a text field
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "?" && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) { e.preventDefault(); set({ help: true }); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [set]);
  if (!show || s.welcome || s.loc.kind !== "flow") return null;
  return (
    <div className="canvas-hint" role="note">
      {isPhone ? (
        <>
          <span><b>Tap</b> a step to follow it</span>
          <span><b>Drag</b> to move, <b>pinch</b> to zoom</span>
        </>
      ) : (
        <>
          <span><b>Click</b> a step to follow it</span>
          <span><b>Hover</b> to preview its NCCN page</span>
          <span><b>Drag</b> to move, <b>scroll</b> to zoom</span>
        </>
      )}
      <button type="button" aria-label="Dismiss" onClick={close}><X size={13} /></button>
    </div>
  );
}
