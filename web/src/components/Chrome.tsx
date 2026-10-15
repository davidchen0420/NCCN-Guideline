import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Library as LibraryIcon, ArrowLeft, ArrowRight, BookOpen, UserRound, ListChecks, CircleHelp, RotateCcw, Search, ExternalLink, Settings } from "lucide-react";
import { useApp } from "../store";
import { PdfButton } from "../source";
import { readPref, writePref } from "../lib/prefs";
import { T } from "../lib/terms";
import { setGuideSteps, useGuideSteps } from "./Guide";
import "../styles/shell.css";

/** Settings: Advanced tools, the 3-step guide, Help. A small popover beside the rail button. */
function SettingsMenu() {
  const { s, set, isPhone } = useApp();
  const guideSteps = useGuideSteps();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left?: number; right?: number; top?: number; bottom?: number }>({});
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos(isPhone
      ? { top: r.bottom + 6, right: 8 }
      : { left: r.right + 8, bottom: Math.max(8, window.innerHeight - r.bottom) });
  }, [open, isPhone]);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", f); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", f); document.removeEventListener("keydown", k); };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className={open ? "on" : ""} aria-label="Settings" title="Settings" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} data-testid="rail-settings"><Settings size={20} /></button>
      {open && createPortal(
        <div ref={menu} className="set-menu" role="dialog" aria-label="Settings" style={pos}>
          <h3>Settings</h3>
          <label className="set-row">
            <input type="checkbox" className="sw" checked={s.advanced} onChange={(e) => set({ advanced: e.target.checked })} data-testid="advanced-toggle" />
            <span className="set-t"><b>Advanced tools</b>
              <small>Reviewer views: arrow certainty, other paths, scores, guided walk, encoding details</small></span>
          </label>
          <label className="set-row">
            <input type="checkbox" className="sw" checked={guideSteps} onChange={(e) => setGuideSteps(e.target.checked)} data-testid="guide-toggle" />
            <span className="set-t"><b>Show the 3-step guide</b>
              <small>Patient, Recommendation, Check the NCCN page: a progress strip above the panel</small></span>
          </label>
          <button type="button" className="set-help" onClick={() => { setOpen(false); set({ help: true }); }}><CircleHelp size={16} aria-hidden />Help</button>
        </div>, document.body)}
    </>
  );
}

const LEFT_KEY = "oc-left";

/** On wide screens Contents starts closed (the diagram needs the room) unless Advanced tools are on
 * or the reader last left it open. Runs once, before the first paint. */
export function useInitialLeft() {
  const { s, set } = useApp();
  useLayoutEffect(() => {
    if (window.innerWidth <= 1180 || s.left !== "toc") return;
    const pref = readPref(LEFT_KEY);
    if (pref === "0" || (pref === null && !s.advanced)) set({ left: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Rail() {
  const { s, set, library, isPhone } = useApp();
  const toggle = (v: "toc" | "search") => {
    const left = s.left === v || (v === "toc" && s.left === "hist") ? null : v;
    if (!isPhone) writePref(LEFT_KEY, left ? "1" : "0");   // remembered for next time (wide screens)
    set({ left });
  };
  const b = (label: string, icon: React.ReactNode, on: boolean, f: () => void, id: string) => (
    <button className={on ? "on" : ""} aria-label={label} title={label} aria-pressed={on} onClick={f} data-testid={id}>{icon}</button>
  );
  return (
    <nav className="rail" aria-label="OncoCarta">
      {library && b("All guidelines", <LibraryIcon size={20} />, false, () => library.home(s.loc.kind === "flow" ? s.loc.page : null), "rail-library")}
      {b("Contents", <BookOpen size={20} />, s.left === "toc" || s.left === "hist", () => toggle("toc"), "rail-toc")}
      {b("Search", <Search size={20} />, s.left === "search", () => toggle("search"), "rail-search")}
      <span className="grow" />
      {b("Help", <CircleHelp size={20} />, s.help, () => set({ help: true }), "rail-help")}
      <SettingsMenu />
    </nav>
  );
}

export function TitleBar() {
  const { s, g, dispatch, set } = useApp();
  const l = s.loc;
  const title = l.kind === "flow" ? g.bundle.pages[l.page].title || l.page : l.kind === "doc" ? g.bundle.docs[l.code].title : "Guideline overview";
  const code = l.kind === "flow" ? l.page : l.kind === "doc" ? l.code : "";
  const flow = l.kind === "flow";
  const adv = s.advanced;
  return (
    <div className="titlebar">
      <button className="ib" aria-label="Back" title="Back" disabled={s.hpos < 1} onClick={() => dispatch({ type: "hist", delta: -1 })}><ArrowLeft size={18} /></button>
      <button className="ib" aria-label="Forward" title="Forward" disabled={s.hpos >= s.hist.length - 1} onClick={() => dispatch({ type: "hist", delta: 1 })}><ArrowRight size={18} /></button>
      <h1 className="tb-title" data-testid="title"><span>{title}</span>{code && code !== title && <code>{code}</code>}</h1>
      {flow && s.answers.length > 0 && (
        <button type="button" className="clear-chip" onClick={() => dispatch({ type: "clear" })} data-testid="clear" title="Clear the selected answers and show the whole diagram">
          <RotateCcw size={14} aria-hidden /><span className="cc-t">Clear selection</span><b className="cc-n">{s.answers.length}</b>
        </button>
      )}
      {flow && adv && (
        <>
          <label className="switch sm" title="Other paths: show the paths that do not go through your selected answers"><input type="checkbox" aria-label="Other paths" checked={s.showNon} onChange={(e) => set({ showNon: e.target.checked })} data-testid="non-active" /><i /><span>Other paths</span></label>
          <label className="switch sm conf" title="Arrow certainty: mark arrows found by only one of the two extraction methods"><input type="checkbox" aria-label="Arrow certainty" checked={s.conf} onChange={(e) => set({ conf: e.target.checked })} /><i /><span>Arrow certainty</span></label>
        </>
      )}
      <PdfButton />
      <a className="ib ext quiet" href="https://www.nccn.org/guidelines/category_1" target="_blank" rel="noopener noreferrer" title="Official NCCN guidelines" aria-label="NCCN.org, official NCCN guidelines"><ExternalLink size={15} /><span className="ext-t">NCCN.org</span></a>
    </div>
  );
}

export function Help() {
  const { s, set, library } = useApp();
  if (!s.help) return null;
  const close = () => { writePref("nav-help", "1"); set({ help: false }); };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="How to use OncoCarta" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-box">
        <h2>How to use OncoCarta</h2>
        <ol className="help-steps">
          <li><b>Pick a guideline.</b> {library ? <>Use <i>All guidelines</i> (top of the left bar) to choose the cancer type.</> : <>This file holds one NCCN guideline; use <i>Contents</i> to move between its pages.</>}</li>
          <li><b>Say where the patient is, and answer the questions.</b> In the <i>Patient</i> tab, choose the point in care, then answer what you know. Leave anything unknown blank.</li>
          <li><b>Read the recommendation.</b> The <i>Recommendation</i> tab lists the options that fit this patient, best match first, and says what is still missing. Pick one to light it up on the diagram.</li>
          <li><b>Check the NCCN page.</b> Hover a step on the diagram to preview its NCCN page with the step highlighted. Click a step to open that page in its own window.</li>
          <li><b>Save or print.</b> Open the summary from the <i>Recommendation</i> tab to copy it or print it for the record.</li>
        </ol>
        <p className="help-tip">Press <kbd>?</kbd> any time to open this help. <i>Settings</i> (the gear) has the reviewer tools, under <i>Advanced tools</i>.</p>
        <p className="help-fine">{T.prototype}</p>
        {s.advanced && (
          <details className="help-data"><summary>About the data</summary>
            <details><summary>Are the branch conditions clinician-reviewed?</summary><p>No. A language model drafted them and a second pass reviewed them; conditions that failed review are dropped. Always check the source page.</p></details>
            <details><summary>What do likelihood and confidence mean?</summary><p>Likelihood shares 100% across the routes your entries leave open, split at each branch by which arms fit. Confidence multiplies how many of a route's criteria are met by how reliably its arrows and conditions were extracted. Neither is a clinical probability; the plain words Best match, Also possible and Less likely come from the likelihood.</p></details>
          </details>
        )}
        <div className="modal-actions"><button className="primary" onClick={close}>Got it</button></div>
      </div>
    </div>
  );
}

/** First visit: three ways in. Replaces a wall of help text. */
export function Welcome() {
  const { s, set, setFacts, bundle } = useApp();
  if (!s.welcome) return null;
  const close = (patch: Parameters<typeof set>[0] = {}) => {
    writePref("nav-help", "1");
    set({ welcome: false, ...patch });
  };
  const examples = bundle.examples ?? [];
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-box welcome" role="dialog" aria-modal="true" aria-labelledby="wl-h">
        <span className="eyebrow">OncoCarta · {bundle.title}</span>
        <h2 id="wl-h">Find where a patient sits in the guideline</h2>
        <p className="wl-lead">Tell OncoCarta about your patient. It shows the NCCN recommendations that fit, and each step links to the original NCCN page so you can check it.</p>
        <div className="wl-choices">
          <button type="button" className="wl-choice primary-choice" onClick={() => close({ rightTab: "patient", sheet: true })} autoFocus>
            <UserRound size={20} aria-hidden /><b>Enter a patient</b><span>Find the NCCN recommendation for them</span>
          </button>
          {examples.length > 0 && (
            <div className="wl-choice as-div">
              <ListChecks size={20} aria-hidden /><b>Try an example</b>
              <span>See how it works with a made-up patient.</span>
              <div className="wl-ex">
                {examples.map((x) => (
                  <button key={x.id} type="button" className="linkish" onClick={() => { setFacts({ ...x.facts }); close({ age: x.age ?? null, pathSel: null, start: "auto", stale: [], rightTab: "paths", sheet: true }); }}>{x.label}</button>
                ))}
              </div>
            </div>
          )}
          <button type="button" className="wl-choice" onClick={() => close({ left: "toc" })}>
            <BookOpen size={20} aria-hidden /><b>Browse the guideline</b><span>Read the pages one by one, with every reference linked.</span>
          </button>
        </div>
        <p className="wl-fine">{T.prototype} <button type="button" className="linkish" onClick={() => close({ help: true })}>How to use it</button></p>
      </div>
    </div>
  );
}
