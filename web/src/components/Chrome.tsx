import { Library as LibraryIcon, ArrowLeft, ArrowRight, BookOpen, UserRound, ListChecks, FileText, CircleHelp, History, LayoutGrid, RotateCcw, Search, ExternalLink } from "lucide-react";
import { useApp } from "../store";
import { PdfButton, useSource } from "../source";
import { startingFacts } from "../lib/pathways";
import { label } from "../lib/factMeta";

export function Rail() {
  const { s, set, go, library } = useApp();
  const toggle = (v: "toc" | "search" | "hist") => set({ left: s.left === v ? null : v });
  const b = (label: string, icon: React.ReactNode, on: boolean, f: () => void, id: string) => (
    <button className={on ? "on" : ""} aria-label={label} title={label} aria-pressed={on} onClick={f} data-testid={id}>{icon}</button>
  );
  return (
    <nav className="rail" aria-label="Navigator">
      {library && b("All guidelines", <LibraryIcon size={20} />, false, library.home, "rail-library")}
      {b("Whole guideline", <LayoutGrid size={20} />, s.loc.kind === "map", () => go({ kind: "map" }), "rail-map")}
      {b("Contents", <BookOpen size={20} />, s.left === "toc", () => toggle("toc"), "rail-toc")}
      {b("Search", <Search size={20} />, s.left === "search", () => toggle("search"), "rail-search")}
      {b("History", <History size={20} />, s.left === "hist", () => toggle("hist"), "rail-hist")}
      <span className="grow" />
      {b("Help", <CircleHelp size={20} />, s.help, () => set({ help: true }), "rail-help")}
    </nav>
  );
}

export function TitleBar() {
  const { s, g, dispatch, set } = useApp();
  const l = s.loc;
  const title = l.kind === "flow" ? g.bundle.pages[l.page].title || l.page : l.kind === "doc" ? g.bundle.docs[l.code].title : "Whole guideline";
  const code = l.kind === "flow" ? l.page : l.kind === "doc" ? l.code : "";
  const flow = l.kind === "flow";
  return (
    <div className="titlebar">
      <button className="ib" aria-label="Back" title="Back" disabled={s.hpos < 1} onClick={() => dispatch({ type: "hist", delta: -1 })}><ArrowLeft size={18} /></button>
      <button className="ib" aria-label="Forward" title="Forward" disabled={s.hpos >= s.hist.length - 1} onClick={() => dispatch({ type: "hist", delta: 1 })}><ArrowRight size={18} /></button>
      <h1 className="tb-title" data-testid="title">{code && <code>{code}</code>}<span>{title}</span></h1>
      {flow && (
        <>
          <label className="switch sm" title="Other paths: show the paths that do not go through your selected answers"><input type="checkbox" aria-label="Other paths" checked={s.showNon} onChange={(e) => set({ showNon: e.target.checked })} data-testid="non-active" /><i /><span>Other paths</span></label>
          <button className="ib" aria-label="Clear selected answers" title="Clear selected answers" disabled={!s.answers.length} onClick={() => dispatch({ type: "clear" })} data-testid="clear">
            <RotateCcw size={17} />{s.answers.length > 0 && <b className="count">{s.answers.length}</b>}
          </button>
          <label className="switch sm conf" title="Arrow certainty: mark arrows found by only one of the two extraction methods"><input type="checkbox" aria-label="Arrow certainty" checked={s.conf} onChange={(e) => set({ conf: e.target.checked })} /><i /><span>Arrow certainty</span></label>
        </>
      )}
      <PdfButton />
      <a className="ib ext" href="https://www.nccn.org/guidelines/category_1" target="_blank" rel="noopener noreferrer" title="Official NCCN guidelines" aria-label="Official NCCN guidelines"><ExternalLink size={16} /></a>
    </div>
  );
}

export function Help() {
  const { s, set } = useApp();
  if (!s.help) return null;
  const close = () => { try { localStorage.setItem("nav-help", "1"); } catch { /* ignore */ } set({ help: false }); };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="How to use this navigator" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-box">
        <h2>How to use this navigator</h2>
        <ol>
          <li><b>Patient</b>: enter what the record says (or load an example). Leave anything unknown blank.</li>
          <li><b>Pathways</b>: every route through the algorithm that your entries leave open, ranked by how well it fits. Each shows how many of its criteria are met and a confidence score; pick one to see every step and light it up on the page.</li>
          <li><b>Sources</b>: hover a step, card or footnote to preview the guideline page it came from; click to open the page in a window you can move, zoom and pop out. Connect the PDF once (it stays in this browser) to see original pages.</li>
          <li><b>Contents</b>: pick a page; blue is the algorithm, teal the principles, amber the discussion. The grid icon shows the whole guideline.</li>
          <li><b>Select answers</b>: click a card. Its pathway lights up and other paths hide until you switch on <i>Other paths</i>. The reset arrow clears every answer.</li>
          <li><b>Links</b>: page references (blue chips and underlined titles) open that page; Back and Forward retrace your steps.</li>
          <li><b>Footnotes</b>: tap a letter on a card, then use the arrows to step through every place it applies.</li>
          <li><b>Search</b>: results are listed beside the page. Quotes find an exact phrase, and filters gray out cards that do not apply.</li>
          <li><b>Walk</b>: step through the algorithm yourself from any card. Branches your entries decide are followed for you.</li>
        </ol>
        <details><summary>Are the branch conditions clinician-reviewed?</summary><p>No. A language model drafted them and a second pass reviewed them; conditions that failed review are dropped. Always check the source page.</p></details>
        <details><summary>What do likelihood and confidence mean?</summary><p>Likelihood shares 100% across the routes your entries leave open, split at each branch by which arms fit. Confidence multiplies how many of a route's criteria are met by how reliably its arrows and conditions were extracted. Neither is a clinical probability.</p></details>
        <details><summary>Is this the official NCCN tool?</summary><p>No. It is an independent research prototype built from public descriptions of the NCCN Guidelines Navigator. Use the official guidelines for clinical decisions.</p></details>
        <div className="modal-actions"><button className="primary" onClick={close}>Got it</button></div>
      </div>
    </div>
  );
}

/** First visit: three ways in, plus the optional PDF. Replaces a wall of help text. */
export function Welcome() {
  const { s, set, setFacts, bundle, g } = useApp();
  const start = startingFacts(g, 5);
  const { pdf, pick } = useSource();
  if (!s.welcome) return null;
  const close = (patch: Parameters<typeof set>[0] = {}) => {
    try { localStorage.setItem("nav-help", "1"); } catch { /* storage may be blocked */ }
    set({ welcome: false, ...patch });
  };
  const examples = bundle.examples ?? [];
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-box welcome" role="dialog" aria-modal="true" aria-labelledby="wl-h">
        <span className="eyebrow">{bundle.title}</span>
        <h2 id="wl-h">Find where a patient sits in the guideline</h2>
        <p className="wl-lead">Enter what the record says. The navigator ranks every route through the algorithm that fits, shows which criteria are met, and links each step to the guideline page it came from.</p>
        <div className="wl-choices">
          <button type="button" className="wl-choice" onClick={() => close({ rightTab: "patient", sheet: true })} autoFocus>
            <UserRound size={20} aria-hidden /><b>Enter a patient</b><span>{start.length ? <>Start with {start.map(label).join(", ")}.</> : "Enter what the record says; pathways update as you type."}</span>
          </button>
          {examples.length > 0 && (
            <div className="wl-choice as-div">
              <ListChecks size={20} aria-hidden /><b>Try an example</b>
              <span>Hand-encoded from public vignettes.</span>
              <div className="wl-ex">
                {examples.map((x) => (
                  <button key={x.id} type="button" className="linkish" onClick={() => { setFacts({ ...x.facts }); close({ age: x.age ?? null, pathSel: null, start: "auto", rightTab: "paths", sheet: true }); }}>{x.label}</button>
                ))}
              </div>
            </div>
          )}
          <button type="button" className="wl-choice" onClick={() => close({ left: "toc" })}>
            <BookOpen size={20} aria-hidden /><b>Browse the guideline</b><span>Read the algorithm pages, principles and discussion with every reference linked.</span>
          </button>
        </div>
        <div className="wl-pdf">
          <FileText size={16} aria-hidden />
          {pdf.status === "ready"
            ? <span>Source PDF connected: <b>{pdf.name}</b>. Hover any step to preview its page.</span>
            : <span>Optional: connect your copy of the guideline PDF to preview original pages. It stays in this browser and is never uploaded.</span>}
          {pdf.status !== "ready" && <button type="button" className="btn small" onClick={pick}>Connect PDF</button>}
        </div>
        <p className="wl-fine">An independent research prototype, not the official NCCN tool. Branch conditions are machine-drafted and not clinician-reviewed; always check the source page. <button type="button" className="linkish" onClick={() => close({ help: true })}>How it works</button></p>
      </div>
    </div>
  );
}
