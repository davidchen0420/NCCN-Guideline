import { ArrowLeft, ArrowRight, BookOpen, CircleHelp, History, LayoutGrid, RotateCcw, Search, ExternalLink } from "lucide-react";
import { useApp } from "../store";

export function Rail() {
  const { s, set, go } = useApp();
  const toggle = (v: "toc" | "search" | "hist") => set({ left: s.left === v ? null : v });
  const b = (label: string, icon: React.ReactNode, on: boolean, f: () => void, id: string) => (
    <button className={on ? "on" : ""} aria-label={label} title={label} aria-pressed={on} onClick={f} data-testid={id}>{icon}</button>
  );
  return (
    <nav className="rail" aria-label="Navigator">
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
          <label className="switch sm"><input type="checkbox" checked={s.showNon} onChange={(e) => set({ showNon: e.target.checked })} data-testid="non-active" /><i /><span>Non-active paths</span></label>
          <button className="ib" aria-label="Clear selected answers" title="Clear selected answers" disabled={!s.answers.length} onClick={() => dispatch({ type: "clear" })} data-testid="clear">
            <RotateCcw size={17} />{s.answers.length > 0 && <b className="count">{s.answers.length}</b>}
          </button>
          <label className="switch sm conf"><input type="checkbox" checked={s.conf} onChange={(e) => set({ conf: e.target.checked })} /><i /><span>Arrow confidence</span></label>
        </>
      )}
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
          <li><b>Contents</b>: pick a page; blue is the algorithm, teal the principles, amber the discussion. The grid icon shows the whole guideline.</li>
          <li><b>Select answers</b>: click a card. Its pathway lights up and other paths hide until you switch on <i>Non-active paths</i>. The reset arrow clears every answer.</li>
          <li><b>Links</b>: page references (blue chips and underlined titles) open that page; Back and Forward retrace your steps.</li>
          <li><b>Footnotes</b>: tap a letter on a card, then use the arrows to step through every place it applies.</li>
          <li><b>Search</b>: results are listed beside the page. Quotes find an exact phrase, and filters gray out cards that do not apply.</li>
          <li><b>Patient facts</b>: enter what you know, then walk the algorithm. Branches your facts decide are followed for you.</li>
        </ol>
        <details><summary>Are the branch conditions clinician-reviewed?</summary><p>No. They are machine-drafted and labelled as such. Always check the source guideline.</p></details>
        <details><summary>Is this the official NCCN tool?</summary><p>No. It is an independent research prototype built from public descriptions of the NCCN Guidelines Navigator. Use the official guidelines for clinical decisions.</p></details>
        <div className="modal-actions"><button className="primary" onClick={close}>Got it</button></div>
      </div>
    </div>
  );
}
