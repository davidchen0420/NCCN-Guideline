/**
 * Wayfinding in the reader: where you are in the three steps (patient details, pathways, source
 * page) and the one thing worth doing next, with a button that does it.
 */
import { useEffect, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { useApp } from "../store";
import { startingFacts } from "../lib/pathways";
import { fieldCount, filledCount, label } from "../lib/factMeta";

const KEY = "oc-guide-hidden";
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function GuideBar() {
  const { s, g, set, ranking, focusFact, setFacts, bundle } = useApp();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  if (hidden) {
    return <button type="button" className="guide-show" onClick={() => { setHidden(false); try { localStorage.removeItem(KEY); } catch { /* blocked */ } }}>Show steps</button>;
  }
  const schema = bundle.schema;
  const filled = schema ? filledCount(s.facts, schema) : 0;
  const total = schema ? fieldCount(schema) : 0;
  const n = ranking.paths.length;
  const step = filled === 0 ? 1 : s.pathSel === null && s.rightTab !== "paths" ? 1 : s.pathSel === null ? 2 : 3;
  const steps: [number, string, string, () => void][] = [
    [1, "Patient details", filled ? `${filled} of ${total}` : "start here", () => set({ rightTab: "patient", sheet: true })],
    [2, "Pathways", n ? `${n} fit` : "none yet", () => set({ rightTab: "paths", sheet: true })],
    [3, "Check the source", "hover a step", () => set({ rightTab: "paths", sheet: true })],
  ];
  const start = startingFacts(g, 3);
  const examples = bundle.examples ?? [];
  let next: React.ReactNode;
  if (!total) next = <>This guideline has no patient details to enter: open <b>Pathways</b> to see its routes, or click boxes on the page.</>;
  else if (filled === 0) {
    next = (<>
      <b>Start with</b>{" "}
      {start.map((f, i) => <span key={f}>{i > 0 && (i === start.length - 1 ? " and " : ", ")}<button type="button" className="need" onClick={() => focusFact(f)}>{label(f)}</button></span>)}
      {start.length ? " — they decide the first branches." : "what the record says."}
      {examples.length > 0 && <> Or <button type="button" className="need" onClick={() => { setFacts({ ...examples[0].facts }); set({ age: examples[0].age ?? null, pathSel: null, rightTab: "paths" }); }}>load an example patient</button>.</>}
    </>);
  } else if (s.rightTab === "patient") {
    next = (<>
      {ranking.nextBest && ranking.nextBest.share > 0.15
        ? <><b>Most useful next:</b> <button type="button" className="need" onClick={() => focusFact(ranking.nextBest!.fact)}>{label(ranking.nextBest.fact)}</button> (open on routes holding {pct(ranking.nextBest.share)} of the fit). </>
        : <>Enough to rank the routes. </>}
      <button type="button" className="guide-go" onClick={() => set({ rightTab: "paths" })}>See {n} {n === 1 ? "route" : "routes"} <ArrowRight size={12} aria-hidden /></button>
    </>);
  } else if (s.rightTab === "paths" && s.pathSel === null) {
    next = <><b>Pick a route</b> to light it up on the page and list its steps; the top one fits best.</>;
  } else {
    next = <><b>Hover a step</b> to preview the guideline page it came from; click to open it. Unmet criteria link back to their field.</>;
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
      <button type="button" className="guide-x" aria-label="Hide these steps" title="Hide these steps" onClick={() => { setHidden(true); try { localStorage.setItem(KEY, "1"); } catch { /* blocked */ } }}><X size={13} /></button>
    </div>
  );
}

/** First visit to the algorithm canvas: how to move around it. */
export function CanvasHint() {
  const { s, set } = useApp();
  const [show, setShow] = useState(() => { try { return localStorage.getItem("oc-canvas-hint") !== "1"; } catch { return true; } });
  const close = () => { setShow(false); try { localStorage.setItem("oc-canvas-hint", "1"); } catch { /* blocked */ } };
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
      <span><b>Click a box</b> to follow its branch</span>
      <span><b>Drag</b> to move · <b>scroll</b> or pinch to zoom</span>
      <span><b>Blue codes</b> open linked pages</span>
      <span><kbd>?</kbd> help</span>
      <button type="button" aria-label="Dismiss" onClick={close}><X size={13} /></button>
    </div>
  );
}
