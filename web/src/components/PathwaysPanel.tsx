import { Fragment, useState } from "react";
import { Check, CircleDashed, CircleHelp, GitFork, ArrowRight, LocateFixed } from "lucide-react";
import { useApp } from "../store";
import type { Pathway, PStep } from "../lib/pathways";
import { confidenceWord, likelihoodWord } from "../lib/pathways";
import { conditionTree, type CondNode } from "../lib/humanize";
import { derive } from "../lib/predicates";
import { label } from "../lib/factMeta";
import { Blocks, Linked } from "./Rich";
import { SrcChip, useSrc, type SrcTarget } from "../source";
import type { Graph } from "../lib/graph";

const pct = (x: number) => (x >= 0.995 ? "100%" : x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);
const plain = (g: Graph, id: string) => g.parsed.get(id)?.plain ?? id;

export function boxSrc(g: Graph, id: string): SrcTarget | null {
  const n = g.node(id);
  const pdf = g.bundle.pages[n?.page ?? ""]?.pdf;
  if (!n || pdf === undefined || pdf === null) return null;
  return { page: pdf, bbox: n.bbox, label: n.page, excerpt: n.text.replace(/\u0017/g, "◦") };
}

/** The box a route ends on, minus bare page references such as "Monitoring (PROS-8)". */
function endText(g: Graph, p: Pathway) {
  return plain(g, p.steps[p.steps.length - 1].node);
}
const pagesOf = (p: Pathway) => [...new Set(p.steps.map((s) => s.node.split(":")[0]))];

function Meter({ value }: { value: number }) {
  return <span className="lbar" aria-hidden><i style={{ width: `${Math.max(2, value * 100)}%` }} /></span>;
}

function PathCard({ p, rank, on, onPick }: { p: Pathway; rank: number; on: boolean; onPick: () => void }) {
  const { g } = useApp();
  const crit = p.met + p.open;
  return (
    <li>
      <button type="button" className={`pcard${on ? " on" : ""}`} aria-current={on} onClick={onPick}>
        <span className="pc-top">
          <span className="pc-rank">{rank}</span>
          <span className="pc-word">{likelihoodWord(p.likelihood)}</span>
          <span className="pc-pages">{pagesOf(p).join(" → ")}</span>
        </span>
        <span className="pc-end">{clip(endText(g, p), 150)}</span>
        {(() => {
          // The last real decision on the route, so routes ending on similar follow-up boxes differ.
          const d = [...p.steps].reverse().find((x, i) => i > 0 && x.kind !== "flow");
          return d ? <span className="pc-via">via {clip(plain(g, d.node), 70)}</span> : null;
        })()}
        <span className="pc-stats">
          <span className="pc-like"><Meter value={p.likelihood} /><b>{pct(p.likelihood)}</b></span>
          <span title="Encoded conditions on this route that your entries satisfy">{crit ? <>{p.met}/{crit} criteria</> : "no criteria"}</span>
          <span className={`cf ${confidenceWord(p.confidence).toLowerCase()}`} title="Confidence: criteria coverage × extraction reliability"><i />{p.confidence}</span>
        </span>
      </button>
    </li>
  );
}

function Cond({ c, top = true }: { c: CondNode; top?: boolean }) {
  const { focusFact } = useApp();
  const mark = (v: boolean | null) => (v === true ? <Check size={13} className="ok" aria-label="met" /> : v === false ? <span className="no" aria-label="not met">✕</span> : <CircleDashed size={13} className="q" aria-label="unknown" />);
  if (c.t === "leaf") {
    return (
      <span className={`cl ${c.verdict === true ? "ok" : c.verdict === false ? "no" : "q"}`}>
        {mark(c.verdict)} {c.text}
        {c.value !== null ? <em> · patient: {c.value}</em> : <> · <button type="button" className="need" onClick={() => focusFact(c.fact)}>add {label(c.fact).toLowerCase()}</button></>}
      </span>
    );
  }
  if (c.word === "not") return <span className="cl">not ( <Cond c={c.items[0]} top={false} /> )</span>;
  return (
    <span className={`cg${top ? " top" : ""}`}>
      {c.items.map((x, i) => (
        <Fragment key={i}>{i > 0 && <span className="cw">{c.word === "all" ? "and" : "or"}</span>}<Cond c={x} top={false} /></Fragment>
      ))}
    </span>
  );
}

const KIND: Record<PStep["kind"], { text: string; cls: string }> = {
  met: { text: "Criteria met", cls: "met" },
  otherwise: { text: "Other arms ruled out", cls: "met" },
  unknown: { text: "Needs details", cls: "unknown" },
  option: { text: "One of several options", cls: "option" },
  inferred: { text: "Matches treatment received", cls: "option" },
  flow: { text: "", cls: "flow" },
};

function Step({ st, facts }: { st: PStep; facts: Record<string, unknown> }) {
  const { g, go } = useApp();
  const n = g.node(st.node)!;
  const parsed = g.parsed.get(st.node)!;
  const src = boxSrc(g, st.node);
  const hover = useSrc(src, { click: false });
  const [fn, setFn] = useState(false);
  const k = KIND[st.kind];
  return (
    <li className={`step ${k.cls}`}>
      <span className="mk" aria-hidden>{st.kind === "met" || st.kind === "otherwise" ? <Check size={12} strokeWidth={3} /> : st.kind === "unknown" ? "?" : st.kind === "option" || st.kind === "inferred" ? <GitFork size={11} /> : null}</span>
      <div className="st-body">
        <div className="st-text" tabIndex={0} {...hover}><Blocks blocks={parsed.blocks} /></div>
        {(k.text || n.pred) && (
          <div className="st-why">
            {k.text && <span className={`tag-s ${k.cls}`}>{k.text}{st.share < 0.999 && st.kind !== "flow" ? ` · ${pct(st.share)} of this branch` : ""}</span>}
            {n.pred && <Cond c={conditionTree(n.pred, facts, g.bundle.schema)} />}
          </div>
        )}
        <div className="st-meta">
          {src && <SrcChip t={src} />}
          <button type="button" className="linkish" onClick={() => go({ kind: "flow", page: n.page, node: n.full })}><LocateFixed size={12} /> Show in algorithm</button>
          {n.footnotes.length > 0 && <button type="button" className="linkish" aria-expanded={fn} onClick={() => setFn(!fn)}>Footnotes {n.footnotes.map((f) => f[0]).join(", ")}</button>}
          {st.edge === "unsure" && <span className="warn-s" title="Only one of the two extraction methods found this arrow">arrow found by one extractor only</span>}
        </div>
        {fn && (
          <div className="fn-list">
            {n.footnotes.map(([l, t, pg]) => (
              <p key={l}><sup>{l}</sup><span><Linked text={t} />{pg !== undefined && pg !== null && <> <SrcChip t={{ page: pg, label: `Footnote ${l}`, excerpt: t }} text={`p.${pg + 1}`} /></>}</span></p>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function Detail({ p }: { p: Pathway }) {
  const { g, s, focusFact } = useApp();
  const [why, setWhy] = useState(false);
  const facts = derive(s.facts, g.bundle.schema);
  const crit = p.met + p.open;
  const byPage: { page: string; steps: PStep[] }[] = [];
  p.steps.forEach((st) => {
    const pg = st.node.split(":")[0];
    if (byPage.length && byPage[byPage.length - 1].page === pg) byPage[byPage.length - 1].steps.push(st);
    else byPage.push({ page: pg, steps: [st] });
  });
  const unsure = p.steps.filter((x) => x.edge === "unsure").length;
  const drafts = p.steps.filter((x) => g.preds[x.node] && g.node(x.node)?.review !== "reviewed").length;
  return (
    <article className="pdetail" aria-label="Selected pathway">
      <header>
        <span className="eyebrow">Where this route leads</span>
        <h3>{clip(endText(g, p), 260)}</h3>
        <div className="scores">
          <div><span className="sv">{pct(p.likelihood)}</span><span className="sl">relative likelihood</span></div>
          <div><span className="sv">{crit ? `${p.met}/${crit}` : "—"}</span><span className="sl">criteria met</span></div>
          <div><span className={`sv conf-v ${confidenceWord(p.confidence).toLowerCase()}`}>{p.confidence}</span><span className="sl">confidence · {confidenceWord(p.confidence).toLowerCase()}</span></div>
        </div>
        <button type="button" className="linkish" aria-expanded={why} onClick={() => setWhy(!why)}><CircleHelp size={13} /> How these are worked out</button>
        {why && (
          <div className="why">
            <p><b>Relative likelihood</b> splits 100% across the routes your entries leave open. At each branch, arms whose criteria are met share it; arms that need more details share it equally, and keep only a small share once another arm is met. It shows how well each route fits what you entered. It is not a clinical probability.</p>
            <p><b>Criteria met</b> counts the encoded conditions on this route that your entries satisfy ({p.met}), against those still open ({p.open}). Treatment options with no condition are not counted.</p>
            <p><b>Confidence</b> = criteria coverage ({Math.round(p.coverage * 100)}%) × encoding reliability ({Math.round(p.encoding * 100)}%). Reliability averages the steps: arrows found by both extractors count 1.0, image-verified 0.95, one extractor only 0.7 ({unsure} here); conditions not confirmed in review count 0.85 ({drafts} here).</p>
            <p className="note">Conditions were drafted and reviewed by a language model, not by clinicians. Check every step against the guideline page.</p>
          </div>
        )}
        {p.missing.length > 0 && (
          <p className="missing">To firm this up, add: {p.missing.map((m, i) => <Fragment key={m}>{i > 0 && ", "}<button type="button" className="need" onClick={() => focusFact(m)}>{label(m)}</button></Fragment>)}</p>
        )}
      </header>
      <ol className="trail">
        {byPage.map(({ page, steps }, i) => (
          <li key={i} className="trail-page">
            <div className="tp-head"><code>{page}</code><span>{g.bundle.pages[page]?.title}</span></div>
            <ol>{steps.map((st) => <Step key={st.node} st={st} facts={facts} />)}</ol>
          </li>
        ))}
      </ol>
      {p.end === "later" && p.next.length > 0 && (
        <div className="next">
          <h4>What comes next depends on later events</h4>
          <ul>{p.next.map((id) => <li key={id}><Linked text={clip(plain(g, id), 140)} />{g.preds[id] && <span className="note"> · {conditionText(g, id, facts)}</span>}</li>)}</ul>
        </div>
      )}
      {p.end === "limit" && <p className="note">This route is very long; it is cut off after 80 steps.</p>}
    </article>
  );
}

function conditionText(g: Graph, id: string, facts: Record<string, unknown>) {
  const c = conditionTree(g.preds[id], facts, g.bundle.schema);
  const flat = (x: CondNode): string => (x.t === "leaf" ? x.text : x.items.map(flat).join(x.word === "all" ? " and " : " or "));
  return flat(c);
}

export function PathwaysPanel() {
  const { s, g, set, ranking, selected, showPath, focusFact } = useApp();
  const [all, setAll] = useState(false);
  const r = ranking;
  const shown = all ? r.paths : r.paths.slice(0, 5);
  const entered = Object.keys(s.facts).length > 0;
  return (
    <div className="paths">
      <div className="start">
        <label htmlFor="start">Start from</label>
        <select id="start" className="sel" value={s.start} onChange={(e) => set({ start: e.target.value, pathSel: null })}>
          <option value="auto">Wherever the patient's details point</option>
          {g.flowPages.filter((p) => (g.bundle.roots[p] ?? []).length).map((p) => <option key={p} value={p}>{p} · {clip(g.bundle.pages[p].title ?? "", 52)}</option>)}
        </select>
      </div>

      {!r.paths.length ? (
        <div className="empty">
          {s.start === "auto" && !entered ? (
            <>
              <h3>Enter a few details to see pathways</h3>
              <p>Start with the essentials: T, N and M category, Grade Group, PSA and life expectancy. Or load an example patient.</p>
              <button type="button" className="btn primary" onClick={() => set({ rightTab: "patient" })}>Enter patient details <ArrowRight size={14} /></button>
            </>
          ) : (
            <>
              <h3>No pathway fits these details</h3>
              <p>Every route from this starting point contradicts something you entered ({r.ruledOut} arms ruled out). Check the entries or pick another starting page.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="summary" aria-live="polite">
            {r.paths.length === 1 ? "One route fits" : `${r.paths.length} routes fit`} your entries{r.ruledOut ? `; ${r.ruledOut} arms ruled out` : ""}.
            {r.truncated && " Only the first 4,000 routes were scored."}
          </p>
          {r.nextBest && r.nextBest.share > 0.2 && (
            <p className="nudge">
              <b>Most useful next:</b> <button type="button" className="need" onClick={() => focusFact(r.nextBest!.fact)}>{label(r.nextBest.fact)}</button>
              <span> — still open on routes holding {pct(r.nextBest.share)} of the likelihood.</span>
            </p>
          )}
          <ol className="plist">
            {shown.map((p, i) => <PathCard key={p.id} p={p} rank={i + 1} on={selected?.id === p.id} onPick={() => showPath(p.id)} />)}
          </ol>
          {r.paths.length > 5 && <button type="button" className="btn ghost small wide" onClick={() => setAll(!all)}>{all ? "Show top 5" : `Show all ${r.paths.length} routes`}</button>}
          {selected && <Detail p={selected} />}
        </>
      )}
    </div>
  );
}
