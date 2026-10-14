import { useMemo, useState } from "react";
import { ArrowRight, Footprints, Undo2, RotateCcw, Copy } from "lucide-react";
import { useApp } from "../store";
import { Blocks, Linked } from "./Rich";
import { humanizePred, factLabel } from "../lib/humanize";
import { derive } from "../lib/predicates";
import { verdicts } from "../lib/walk";
import { resolveRef } from "../lib/graph";
import { splitParagraphs } from "../lib/docFormat";

const clip = (t: string, n = 90) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);
const plainOf = (g: { parsed: Map<string, { plain: string }> }, id: string) => g.parsed.get(id)?.plain ?? id;

export function RightPanel() {
  const { s, set } = useApp();
  const tabs: ["details" | "walk" | "facts", string][] = [["details", "Details"], ["walk", "Walk"], ["facts", "Patient facts"]];
  return (
    <div className="rp">
      <div className="rp-tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={s.rightTab === k} className={s.rightTab === k ? "on" : ""} onClick={() => set({ rightTab: k })}>{l}</button>)}
        <button className="sheet-close" aria-label="Close panel" onClick={() => set({ sheet: false })}>×</button>
      </div>
      <div className="rp-body">
        {s.rightTab === "details" && <Details />}
        {s.rightTab === "walk" && <WalkPanel />}
        {s.rightTab === "facts" && <FactsPanel />}
      </div>
    </div>
  );
}

function RefCard({ code }: { code: string }) {
  const { g, goRef } = useApp();
  const t = resolveRef(g, code);
  if (t.type === "none") return null;
  const title = t.type === "doc" ? g.bundle.docs[t.code].title : g.bundle.pages[t.page].title;
  const excerpt = t.type === "doc" ? splitParagraphs(g.bundle.docs[t.code].pages[0].text).find((p) => p.length > 60) : undefined;
  return (
    <button className="ref-card" onClick={() => goRef(code)}>
      <span className="ref-top"><code>{code}</code><ArrowRight size={13} /></span>
      <b>{title}</b>
      {excerpt && <span className="ex">{clip(excerpt, 130)}</span>}
    </button>
  );
}

function Details() {
  const { s, g, go, startWalkAt } = useApp();
  const loc = s.loc;
  const hits = loc.kind === "doc" ? g.refIndex.get(loc.code) ?? [] : [];
  const nodeId = loc.kind === "flow" ? loc.node : undefined;
  const n = nodeId ? g.node(nodeId) : undefined;
  const parsed = nodeId ? g.parsed.get(nodeId) : undefined;
  const refs = useMemo(() => {
    if (!n || !parsed) return [] as string[];
    const set = new Set<string>([...parsed.refs, ...n.links]);
    n.footnotes.forEach(([, t]) => { (t.match(/\b[A-Z]+-(?:[A-Z]\b|\d+[A-Z]?)/g) ?? []).forEach((c) => set.add(c)); });
    return [...set].filter((c) => resolveRef(g, c).type !== "none" && !(loc.kind === "flow" && c === loc.page));
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
            <button className="link" onClick={() => go({ kind: "flow", page })}><code>{page}</code> {g.bundle.pages[page].title}</button>
            {hs.slice(0, 6).map((h, i) => <button key={i} className="usage-item" onClick={() => go({ kind: "flow", page, node: h.node })}>{clip(plainOf(g, h.node!), 70)}<em>{h.via === "footnote" ? "in a footnote" : "in a box"}</em></button>)}
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
        <p className="note">{loc.page} · {g.bundle.pages[loc.page].nodes.filter((x) => x.kind === "box").length} boxes</p>
        <p>Click a card to select it as an answer. Its pathway lights up, and the other paths hide until you switch on “Non-active paths”.</p>
        {entries.length > 0 && <button className="primary" onClick={() => startWalkAt(loc.page, null)}><Footprints size={15} /> Start guided walk</button>}
      </div>
    );
  }
  const out = g.kids(n.full), inc = g.parents[n.full] ?? [];
  const nav = (id: string) => go({ kind: "flow", page: id.split(":")[0], node: id });
  return (
    <div className="det">
      <div className="det-head"><code>{n.full}</code>{s.answers.includes(n.full) && <span className="pill">Selected answer</span>}</div>
      <div className="det-card"><Blocks blocks={parsed.blocks} /></div>
      {n.pred && (
        <>
          <h4>Branch condition{g.bundle.preds_draft && <span className="draft">machine-drafted, not clinician-reviewed</span>}</h4>
          <p className="cond">{humanizePred(n.pred, g.bundle.schema)}</p>
        </>
      )}
      {n.footnotes.length > 0 && (
        <>
          <h4>Footnotes</h4>
          {n.footnotes.map(([l, t]) => <div key={l} className="fn-line"><span className="fb big">{l}</span><p><Linked text={t} /></p></div>)}
        </>
      )}
      {refs.length > 0 && <><h4>Related pages</h4><div className="refs">{refs.slice(0, 8).map((c) => <RefCard key={c} code={c} />)}</div></>}
      {out.length > 0 && <><h4>Leads to</h4>{out.map((id) => <button key={id} className="usage-item" onClick={() => nav(id)}><code>{id.split(":")[0] !== n.page ? id.split(":")[0] : ""}</code>{clip(plainOf(g, id))}</button>)}</>}
      {inc.length > 0 && <><h4>Reached from</h4>{inc.map((id) => <button key={id} className="usage-item" onClick={() => nav(id)}><code>{id.split(":")[0] !== n.page ? id.split(":")[0] : ""}</code>{clip(plainOf(g, id))}</button>)}</>}
      <button className="primary" onClick={() => startWalkAt(n.page, n.full)}><Footprints size={15} /> Start guided walk here</button>
    </div>
  );
}

function WalkPanel() {
  const { s, g, set, go, chooseStep, startWalkAt } = useApp();
  const w = s.walk;
  const [copied, setCopied] = useState(false);
  if (!w) {
    return (
      <div className="det">
        <p>Walk the algorithm step by step. At each step, choose the branch that fits the patient. If you have entered patient facts, branches they decide are followed for you.</p>
        <h4>Start from</h4>
        <div className="chips">{g.flowPages.map((p) => <button key={p} className="chip" title={g.bundle.pages[p].title} onClick={() => startWalkAt(p, null)}>{p}</button>)}</div>
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
        <button onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(w.path.map((p) => p.node))); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Copy size={14} /> {copied ? "Copied" : "Copy path"}</button>
      </div>
      <h4>Path so far</h4>
      <ol className="steps">
        {w.path.map((st, i) => (
          <li key={i}><button onClick={() => go({ kind: "flow", page: st.node.split(":")[0], node: st.node.endsWith(":START") ? undefined : st.node })}>
            <span className="by">{st.by === "predicate" ? "from facts" : st.by === "single-arrow" ? "next" : st.by === "reconverge" ? "skipped undecided branch" : st.by}</span>
            <span>{clip(st.node.endsWith(":START") ? "Page entry" : plainOf(g, st.node), 80)}</span></button></li>
        ))}
      </ol>
      <h4>Next step</h4>
      {kids.length === 0 && <p className="note">This is the end of the encoded pathway for this box.</p>}
      {kids.length > 1 && hasFacts && (kids.every((c) => !g.preds[c])
        ? <p className="note">These branches have no encoded condition yet, so they need your choice.</p>
        : <p className="note">The facts you entered do not decide this branch. Choose below.</p>)}
      {kids.map((c) => (
        <button key={c} className={`choice${v[c] === false ? " off" : ""}`} onClick={() => chooseStep(c)}>
          <span>{clip(plainOf(g, c), 130)}</span>
          {v[c] === true && <em className="ok">matches facts</em>}{v[c] === false && <em>excluded by facts</em>}
        </button>
      ))}
    </div>
  );
}

const GROUPS: [string, RegExp][] = [
  ["Patient", /life_expectancy|age|ecog|comorb|symptom|performance|health/],
  ["Labs", /psa|testosterone|alk|ldh|hemoglobin|creatinine/],
  ["Staging and pathology", /category|stage|grade|cores|histology|gleason|volume|extent|risk|gg_/],
  ["Metastases and imaging", /metast|visceral|bone|nodal|imaging|pet|scan/],
  ["Biomarkers and genetics", /brca|hrr|msi|mmr|tmb|pten|germline|somatic|mutation|biomarker/],
  ["Treatment and history", /treatment|therapy|adt|arpi|rt_|radiation|prostatectomy|prior|progress|recurr|castrat|response|docetaxel/],
];

function FactsPanel() {
  const { s, g, setFacts, startWalkAt } = useApp();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(g.flowPages[0]);
  const vars = g.bundle.schema.variables;
  const names = Object.keys(vars).filter((n) => !q || n.replace(/_/g, " ").includes(q.toLowerCase()));
  const grouped = useMemo(() => {
    const m = new Map<string, string[]>();
    names.forEach((n) => { const gk = GROUPS.find(([, r]) => r.test(n))?.[0] ?? "Other"; m.set(gk, [...(m.get(gk) ?? []), n]); });
    return [...m.entries()];
  }, [names]);
  const derived = useMemo(() => { const d = derive(s.facts, g.bundle.schema); return Object.entries(d).filter(([k]) => !(k in s.facts) || s.facts[k] === undefined); }, [s.facts, g]);
  const set1 = (name: string, v: unknown) => { const f = { ...s.facts }; if (v === "" || v === null || Number.isNaN(v)) delete f[name]; else f[name] = v; setFacts(f); };
  const filled = Object.keys(s.facts).length;
  if (!Object.keys(vars).length) return <p className="note">This guideline has no fact schema, so facts cannot decide branches.</p>;
  return (
    <div className="det facts">
      <p className="note">Enter what you know and leave the rest blank. Only boxes with an encoded condition can be decided automatically. {g.bundle.preds_draft && "The conditions are machine-drafted and not clinician-reviewed."}</p>
      <input type="search" className="mini" placeholder="Find a fact…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a fact" />
      {grouped.map(([title, list]) => (
        <details key={title} open={!!q || title === grouped[0][0]}>
          <summary>{title}<em>{list.filter((n) => n in s.facts).length}/{list.length}</em></summary>
          {list.map((n) => {
            const v = vars[n];
            const cur = s.facts[n];
            return (
              <label className="frow" key={n} title={v.definition}>
                <span>{factLabel(n)}{v.unit && v.unit !== "count" ? <small> {v.unit}</small> : null}</span>
                {v.type === "bool" ? (
                  <select value={cur === undefined ? "" : String(cur)} onChange={(e) => set1(n, e.target.value === "" ? "" : e.target.value === "true")}><option value="">unknown</option><option value="true">yes</option><option value="false">no</option></select>
                ) : v.type === "enum" ? (
                  <select value={(cur as string) ?? ""} onChange={(e) => set1(n, e.target.value)}><option value="">unknown</option>{(v.values ?? []).map((x) => <option key={x}>{x}</option>)}</select>
                ) : (
                  <input type="number" step="any" value={cur === undefined ? "" : String(cur)} onChange={(e) => set1(n, e.target.value === "" ? "" : Number(e.target.value))} />
                )}
              </label>
            );
          })}
        </details>
      ))}
      {derived.length > 0 && <><h4>Worked out from your facts</h4><div className="chips">{derived.map(([k, v]) => <span className="chip static" key={k}>{factLabel(k)}: <b>{String(v)}</b></span>)}</div></>}
      <div className="run">
        <select value={page} onChange={(e) => setPage(e.target.value)} aria-label="Start page">{g.flowPages.map((p) => <option key={p} value={p}>{p} · {clip(g.bundle.pages[p].title ?? "", 36)}</option>)}</select>
        <button className="primary" onClick={() => startWalkAt(page, null)}><Footprints size={15} /> Walk with these facts</button>
        <button onClick={() => setFacts({})} disabled={!filled}>Clear</button>
      </div>
    </div>
  );
}
