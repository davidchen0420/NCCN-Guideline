import { useMemo, useState } from "react";
import { ArrowRight, Footprints, Undo2, RotateCcw, Copy } from "lucide-react";
import { useApp } from "../store";
import { Blocks, Linked } from "./Rich";
import { conditionTree } from "../lib/humanize";
import { derive } from "../lib/predicates";
import { PatientPanel } from "./PatientPanel";
import { GuideBar } from "./Guide";
import { PathwaysPanel, boxSrc } from "./PathwaysPanel";
import { SrcChip } from "../source";
import { verdicts } from "../lib/walk";
import { resolveRef } from "../lib/graph";
import { splitParagraphs } from "../lib/docFormat";

const clip = (t: string, n = 90) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);
const plainOf = (g: { parsed: Map<string, { plain: string }> }, id: string) => g.parsed.get(id)?.plain ?? id;

export function RightPanel() {
  const { s, set } = useApp();
  const { ranking } = useApp();
  const tabs: ["patient" | "paths" | "details" | "walk", string][] = [["patient", "Patient"], ["paths", "Pathways"], ["details", "Details"], ["walk", "Walk"]];
  const keys = tabs.map((t) => t[0]);
  return (
    <div className="rp">
      <div className="rp-tabs" role="tablist" aria-label="Panel"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const i = keys.indexOf(s.rightTab), n = keys[(i + (e.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length];
          set({ rightTab: n }); document.getElementById(`tab-${n}`)?.focus();
        }}>
        {tabs.map(([k, l]) => (
          <button key={k} id={`tab-${k}`} role="tab" aria-selected={s.rightTab === k} aria-controls="rp-panel" tabIndex={s.rightTab === k ? 0 : -1}
            className={s.rightTab === k ? "on" : ""} onClick={() => set({ rightTab: k })}>
            {l}{k === "paths" && ranking.paths.length > 0 && <span className="tab-n">{ranking.paths.length}</span>}
          </button>
        ))}
        <button className="sheet-close" aria-label="Close panel" onClick={() => set({ sheet: false })}>×</button>
      </div>
      <GuideBar />
      <div className="rp-body" id="rp-panel" role="tabpanel" aria-labelledby={`tab-${s.rightTab}`}>
        {s.rightTab === "patient" && <PatientPanel />}
        {s.rightTab === "paths" && <PathwaysPanel />}
        {s.rightTab === "details" && <Details />}
        {s.rightTab === "walk" && <WalkPanel />}
      </div>
    </div>
  );
}

// Step details and the walk (imports kept here so the tab bar above stays untouched).
import { useAdvanced } from "../store";
import { pageName } from "../lib/terms";

function RefCard({ code }: { code: string }) {
  const { g, goRef, library } = useApp();
  const t = resolveRef(g, code);
  if (t.type === "none" || (t.type === "external" && !library)) return null;
  if (t.type === "external") {
    const e = library!.entries.find((x) => x.slug === t.slug);
    return (
      <button className="ref-card" onClick={() => goRef(code)}>
        <span className="ref-top"><b>{e?.title ?? t.slug}</b><ArrowRight size={13} /></span>
        <code>{code}</code><span className="ex">Another guideline in the library</span>
      </button>
    );
  }
  const title = t.type === "doc" ? g.bundle.docs[t.code].title : g.bundle.pages[t.page].title;
  const excerpt = t.type === "doc" ? splitParagraphs(g.bundle.docs[t.code].pages[0].text).find((p) => p.length > 60) : undefined;
  return (
    <button className="ref-card" onClick={() => goRef(code)}>
      <span className="ref-top"><b>{title}</b><ArrowRight size={13} /></span>
      <code>{code}</code>
      {excerpt && <span className="ex">{clip(excerpt, 130)}</span>}
    </button>
  );
}

function Details() {
  const { s, g, go, startWalkAt, library } = useApp();
  const adv = useAdvanced();
  const facts = useMemo(() => derive(s.facts, g.bundle.schema), [s.facts, g]);
  const loc = s.loc;
  const hits = loc.kind === "doc" ? g.refIndex.get(loc.code) ?? [] : [];
  const nodeId = loc.kind === "flow" ? loc.node : undefined;
  const n = nodeId ? g.node(nodeId) : undefined;
  const parsed = nodeId ? g.parsed.get(nodeId) : undefined;
  const refs = useMemo(() => {
    if (!n || !parsed) return [] as string[];
    const set = new Set<string>([...parsed.refs, ...n.links]);
    n.footnotes.forEach(([, t]) => { (t.match(/\b[A-Z]+-(?:[A-Z]\b|\d+[A-Z]?)/g) ?? []).forEach((c) => set.add(c)); });
    return [...set].filter((c) => { const t = resolveRef(g, c).type; return t !== "none" && (t !== "external" || !!library) && !(loc.kind === "flow" && c === loc.page); });
  }, [n, parsed, g, loc]);

  if (loc.kind === "map") return <p className="note">Pick a page from the overview.</p>;
  if (loc.kind === "doc") {
    const byPage = new Map<string, typeof hits>();
    hits.forEach((h) => byPage.set(h.page, [...(byPage.get(h.page) ?? []), h]));
    return (
      <div className="det">
        <h3>{g.bundle.docs[loc.code].title}</h3>
        <p className="note">{g.bundle.docs[loc.code].pages.length} page{g.bundle.docs[loc.code].pages.length > 1 ? "s" : ""}</p>
        <h4>Referenced from</h4>
        {hits.length === 0 && <p className="note">No algorithm box or footnote refers to this page.</p>}
        {[...byPage.entries()].map(([page, hs]) => (
          <div key={page} className="usage">
            <button className="link" onClick={() => go({ kind: "flow", page })}>{pageName(page, g.bundle.pages[page].title)}</button>
            {hs.slice(0, 6).map((h, i) => <button key={i} className="usage-item" onClick={() => go({ kind: "flow", page, node: h.node })}>{clip(plainOf(g, h.node!), 70)}<em>{h.via === "footnote" ? "in a footnote" : "in a step"}</em></button>)}
          </div>
        ))}
      </div>
    );
  }
  if (!n || !parsed) {
    const entries = g.bundle.roots[loc.page] ?? [];
    return (
      <div className="det">
        <h3>{g.bundle.pages[loc.page].title || loc.page}</h3>
        <p className="note">{loc.page} · {g.bundle.pages[loc.page].nodes.filter((x) => x.kind === "box").length} steps</p>
        <p>Click a step in the diagram to see its details here and open the NCCN page it came from.</p>
        {adv && entries.length > 0 && <button className="primary" onClick={() => startWalkAt(loc.page, null)}><Footprints size={15} /> Start guided walk</button>}
      </div>
    );
  }
  const out = g.kids(n.full), inc = g.parents[n.full] ?? [];
  const nav = (id: string) => go({ kind: "flow", page: id.split(":")[0], node: id });
  return (
    <div className="det">
      <div className="det-head"><b className="det-page">{pageName(n.page, g.bundle.pages[n.page]?.title)}</b>{s.answers.includes(n.full) && <span className="pill">Selected answer</span>}<span className="grow" />{boxSrc(g, n.full) && <SrcChip t={boxSrc(g, n.full)!} text="View on the NCCN page" />}</div>
      <div className="det-card"><Blocks blocks={parsed.blocks} /></div>
      {adv && n.pred && (
        <>
          <h4>Branch condition<span className="draft">{n.review === "reviewed" ? "machine-drafted, model-reviewed" : "machine-drafted, not reviewed"} · not clinician-reviewed</span></h4>
          <div className="cond-box"><CondView id={n.full} facts={facts} /></div>
        </>
      )}
      {n.footnotes.length > 0 && (
        <>
          <h4>Footnotes</h4>
          {n.footnotes.map(([l, t, pg]) => (
            <div key={l} className="fn-line"><span className="fb big">{l}</span><p><Linked text={t} />{pg !== undefined && pg !== null && <> <SrcChip t={{ page: pg, label: `Footnote ${l}`, excerpt: t }} text={`p.${pg + 1}`} /></>}</p></div>
          ))}
        </>
      )}
      {refs.length > 0 && <><h4>Related pages</h4><div className="refs">{refs.slice(0, 8).map((c) => <RefCard key={c} code={c} />)}</div></>}
      {library && (n.ext ?? []).length > 0 && (
        <><h4>Other guidelines cited</h4><div className="refs">
          {[...new Map((n.ext ?? []).map((x) => [x.slug, x])).values()].map((x) => {
            const e = library.entries.find((y) => y.slug === x.slug);
            return (
              <button key={x.slug} className="ref-card" onClick={() => library.open(x.slug, x.code)}>
                <span className="ref-top"><code>{x.code ?? "Guideline"}</code><ArrowRight size={13} /></span>
                <b>{e?.title ?? x.slug}</b>{e?.version && <span className="ex">Version {e.version}</span>}
              </button>
            );
          })}
        </div></>
      )}
      {out.length > 0 && <><h4>Leads to</h4>{out.map((id) => <StepLink key={id} id={id} here={n.page} onClick={() => nav(id)} />)}</>}
      {inc.length > 0 && <><h4>Reached from</h4>{inc.map((id) => <StepLink key={id} id={id} here={n.page} onClick={() => nav(id)} />)}</>}
      {adv && <button className="primary" onClick={() => startWalkAt(n.page, n.full)}><Footprints size={15} /> Start guided walk here</button>}
    </div>
  );
}

/** A neighbouring step; when it sits on another page, that page's title comes first. */
function StepLink({ id, here, onClick }: { id: string; here: string; onClick: () => void }) {
  const { g } = useApp();
  const page = id.split(":")[0];
  return (
    <button type="button" className="usage-item" onClick={onClick}>
      {clip(plainOf(g, id))}
      {page !== here && <em>On {pageName(page, g.bundle.pages[page]?.title)}</em>}
    </button>
  );
}

function WalkPanel() {
  const { s, g, set, go, chooseStep, startWalkAt } = useApp();
  const adv = useAdvanced();
  const w = s.walk;
  const [copied, setCopied] = useState(false);
  if (!w) {
    return (
      <div className="det">
        <p>Walk through the guideline one step at a time. At each step, choose the branch that fits the patient; branches the patient's answers decide are followed for you.</p>
        <h4>Start at</h4>
        <div className="chips">{g.flowPages.map((p) => <button key={p} className="chip" title={pageName(p, g.bundle.pages[p].title)} onClick={() => startWalkAt(p, null)}>{p}</button>)}</div>
      </div>
    );
  }
  const kids = g.kids(w.at);
  const v = verdicts(g, kids, s.facts);
  const hasFacts = Object.values(s.facts).some((x) => x !== null && x !== undefined && x !== "");
  const undo = () => {
    if (w.path.length < 2) return;
    const path = w.path.slice(0, -1);
    const at = path[path.length - 1].node;
    set({ walk: { path, at } });
    go({ kind: "flow", page: at.split(":")[0], node: at.endsWith(":START") ? undefined : at });
  };
  return (
    <div className="det">
      <div className="btn-row">
        <button onClick={undo} disabled={w.path.length < 2}><Undo2 size={14} /> Undo</button>
        <button onClick={() => set({ walk: null })}><RotateCcw size={14} /> Reset</button>
        {adv && <button onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(w.path.map((p) => p.node))); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Copy size={14} /> {copied ? "Copied" : "Copy path"}</button>}
      </div>
      <h4>Steps so far</h4>
      <ol className="steps">
        {w.path.map((st, i) => (
          <li key={i}><button onClick={() => go({ kind: "flow", page: st.node.split(":")[0], node: st.node.endsWith(":START") ? undefined : st.node })}>
            <span className="by">{st.by === "predicate" ? "from answers" : st.by === "single-arrow" ? "next" : st.by === "reconverge" ? "skipped an undecided branch" : st.by}</span>
            <span>{clip(st.node.endsWith(":START") ? "Start of page" : plainOf(g, st.node), 80)}</span></button></li>
        ))}
      </ol>
      <h4>Next step</h4>
      {kids.length === 0 && <p className="note">This is the last step on this path.</p>}
      {kids.length > 1 && hasFacts && (kids.every((c) => !g.preds[c])
        ? <p className="note">The guideline does not say how to choose between these, so it is your call.</p>
        : <p className="note">The patient’s answers do not decide this branch. Choose below.</p>)}
      {kids.map((c) => (
        <button key={c} className={`choice${v[c] === false ? " off" : ""}`} onClick={() => chooseStep(c)}>
          <span>{clip(plainOf(g, c), 130)}</span>
          {v[c] === true && <em className="ok">matches the answers</em>}{v[c] === false && <em>ruled out by the answers</em>}
        </button>
      ))}
    </div>
  );
}

function CondView({ id, facts }: { id: string; facts: Record<string, unknown> }) {
  const { g } = useApp();
  const c = conditionTree(g.preds[id], facts, g.bundle.schema);
  const render = (x: ReturnType<typeof conditionTree>, top: boolean): React.ReactNode => {
    if (x.t === "leaf") {
      const cls = x.verdict === true ? "ok" : x.verdict === false ? "no" : "q";
      return <span className={`cl ${cls}`}>{x.verdict === true ? "✓" : x.verdict === false ? "✕" : "?"} {x.text}{x.value !== null && <em> · patient: {x.value}</em>}</span>;
    }
    if (x.word === "not") return <span className="cl">not ( {render(x.items[0], false)} )</span>;
    return <span className={`cg${top ? " top" : ""}`}>{x.items.map((y, i) => <span key={i}>{i > 0 && <span className="cw">{x.word === "all" ? "and" : "or"}</span>}{render(y, false)}</span>)}</span>;
  };
  return <>{render(c, true)}</>;
}
