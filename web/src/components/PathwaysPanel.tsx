import { Fragment, useMemo, useState } from "react";
import { Check, CircleDashed, CircleHelp, GitFork, ArrowRight, LocateFixed, Minus, FileText, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useApp, useAdvanced } from "../store";
import type { Pathway, PStep } from "../lib/pathways";
import { likelihoodWord, startingFacts } from "../lib/pathways";
import { conditionTree, type CondNode } from "../lib/humanize";
import { derive } from "../lib/predicates";
import { label } from "../lib/factMeta";
import { Blocks, Linked } from "./Rich";
import { PageCrop, SrcChip, useSource, useSrc, type SrcTarget } from "../source";
import type { Graph } from "../lib/graph";
import type { Block, Inline, Item } from "../lib/parseBox";
import { Summary } from "./Summary";
import { T, matchWord, pageName, supportPhrase } from "../lib/terms";
import "../styles/reco.css";

export const pct = (x: number) => (x >= 0.995 ? "100%" : x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
export const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);
export const plain = (g: Graph, id: string) => g.parsed.get(id)?.plain ?? id;

export function boxSrc(g: Graph, id: string): SrcTarget | null {
  const n = g.node(id);
  const pdf = g.bundle.pages[n?.page ?? ""]?.pdf;
  if (!n || pdf === undefined || pdf === null) return null;
  return { page: pdf, bbox: n.bbox, label: n.page, excerpt: n.text.replace(/\u0017/g, "◦") };
}

// ---------------------------------------------------------------- what a route recommends

/** A box that only sends the reader to another algorithm page, e.g. "Monitoring (PROS-8)". */
export function gotoPage(g: Graph, id: string): string | null {
  const n = g.node(id);
  if (!n) return null;
  const target = n.links.find((l) => g.bundle.pages[l] && l !== n.page);
  return target && (g.parsed.get(id)?.plain.length ?? 0) < 110 ? target : null;
}
const isCondition = (g: Graph, st: PStep) => !!g.preds[st.node] || st.kind === "uncoded";
const hasTags = (g: Graph, id: string) => {
  const p = g.parsed.get(id);
  return !!p && (p.tags.length > 0 || p.blocks.some((b) => b.t === "tier"));
};

export interface Focus { key: PStep; follow: PStep | null; choice: PStep | null; parentOfChoice: string | null }
/**
 * The box to headline for a route: after the route's last decision, the last box that carries
 * recommendation tags (Preferred, category); else the last box that is not just a page
 * reference; else the final box. Whatever follows it (monitoring, a page link) is "then".
 */
export function routeFocus(g: Graph, p: Pathway): Focus {
  const s = p.steps;
  let lastCond = -1;
  s.forEach((st, i) => { if (isCondition(g, st)) lastCond = i; });
  const after = s.slice(lastCond + 1);
  const key = [...after].reverse().find((st) => hasTags(g, st.node))
    ?? [...after].reverse().find((st) => !gotoPage(g, st.node))
    ?? s[s.length - 1];
  const last = s[s.length - 1];
  let ci = -1;
  s.forEach((st, i) => { if (st.kind === "option" || st.kind === "inferred") ci = i; });
  return { key, follow: last !== key ? last : null, choice: ci > 0 ? s[ci] : null, parentOfChoice: ci > 0 ? s[ci - 1].node : null };
}

// ---------------------------------------------------------------- score words

/** How much of the route's criteria the entered details cover. */
export const dataWord = (p: Pathway) => {
  const crit = p.met + p.open;
  if (!crit) return "No criteria";
  return p.coverage >= 0.999 ? "Complete" : p.coverage >= 0.6 ? "Partial" : "Sparse";
};
/** How reliably the route's arrows and conditions were extracted from the PDF. */
export const extractionWord = (p: Pathway) => (p.encoding >= 0.97 ? "High" : p.encoding >= 0.88 ? "Good" : "Mixed");
const tone = (w: string) => (["Complete", "High"].includes(w) ? "high" : ["Partial", "Good"].includes(w) ? "moderate" : "low");

function Meter({ value }: { value: number }) {
  return <span className="lbar" aria-hidden><i style={{ width: `${Math.max(2, value * 100)}%` }} /></span>;
}

function Tags({ id }: { id: string }) {
  const { g } = useApp();
  const tags = g.parsed.get(id)?.tags ?? [];
  if (!tags.length) return null;
  return <span className="tags">{tags.slice(0, 3).map((t) => <span key={t} className={`tag ${t === "Preferred" ? "tag-pref" : t.startsWith("Category") ? "tag-cat" : "tag-other"}`}>{t}</span>)}</span>;
}

function PathCard({ p, rank, on, onPick }: { p: Pathway; rank: number; on: boolean; onPick: () => void }) {
  const { g } = useApp();
  const f = routeFocus(g, p);
  const crit = p.met + p.open;
  const goto = f.follow && gotoPage(g, f.follow.node);
  return (
    <li>
      <button type="button" className={`pcard${on ? " on" : ""}`} aria-current={on} onClick={onPick}
        aria-label={`${likelihoodWord(p.likelihood)}, rank ${rank}: ${clip(plain(g, f.key.node), 120)}`}>
        <span className="pc-top">
          <span className="pc-word">{likelihoodWord(p.likelihood)}</span>
          <span className="pc-pages">{[...new Set(p.steps.map((s) => s.node.split(":")[0]))].join(" → ")}</span>
        </span>
        <span className="pc-end">{clip(plain(g, f.key.node), 140)}</span>
        <Tags id={f.key.node} />
        {f.follow && <span className="pc-via">then {goto ? `${goto} · ${clip(g.bundle.pages[goto]?.title ?? "", 50)}` : clip(plain(g, f.follow.node), 70)}</span>}
        <span className="pc-stats">
          <span className="pc-like" title="Share of the routes your entries leave open (not a clinical probability)"><Meter value={p.likelihood} /><span>{pct(p.likelihood)}</span></span>
          <span title="Encoded conditions on this route that your entries satisfy">{crit ? <>{p.met}/{crit} criteria</> : "no criteria"}</span>
          {p.uncoded > 0 && <span className="pc-judge" title="Branches on this route have no encoded condition">{p.uncoded} judgment call{p.uncoded > 1 ? "s" : ""}</span>}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------- conditions and steps

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
  uncoded: { text: "Condition not encoded — your judgment", cls: "uncoded" },
  option: { text: "One of several options", cls: "option" },
  inferred: { text: "Matches treatment received", cls: "option" },
  flow: { text: "", cls: "flow" },
};

function StepMeta({ id, fnOpen, setFn, edgeUnsure }: { id: string; fnOpen: boolean; setFn: (v: boolean) => void; edgeUnsure: boolean }) {
  const { g, go } = useApp();
  const n = g.node(id)!;
  const src = boxSrc(g, id);
  return (
    <div className="st-meta">
      {src && <SrcChip t={src} />}
      <button type="button" className="linkish" onClick={() => go({ kind: "flow", page: n.page, node: n.full })}><LocateFixed size={12} /> Show in algorithm</button>
      {n.footnotes.length > 0 && <button type="button" className="linkish" aria-expanded={fnOpen} onClick={() => setFn(!fnOpen)}>Footnotes {n.footnotes.map((f) => f[0]).join(", ")}</button>}
      {edgeUnsure && <span className="warn-s" title="Only one of the two extraction methods found this arrow">arrow found by one extractor only</span>}
    </div>
  );
}

function Footnotes({ id }: { id: string }) {
  const { g } = useApp();
  return (
    <div className="fn-list">
      {g.node(id)!.footnotes.map(([l, t, pg]) => (
        <p key={l}><sup>{l}</sup><span><Linked text={t} />{pg !== undefined && pg !== null && <> <SrcChip t={{ page: pg, label: `Footnote ${l}`, excerpt: t }} text={`p.${pg + 1}`} /></>}</span></p>
      ))}
    </div>
  );
}

function Step({ st, facts, isKey }: { st: PStep; facts: Record<string, unknown>; isKey: boolean }) {
  const { g } = useApp();
  const n = g.node(st.node)!;
  const parsed = g.parsed.get(st.node)!;
  const hover = useSrc(boxSrc(g, st.node), { click: false });
  const [fn, setFn] = useState(false);
  const [open, setOpen] = useState(false);
  const k = KIND[st.kind];
  // Workup and pass-through boxes collapse to one line; decisions and the recommendation stay open.
  const compact = st.kind === "flow" && !isKey && !open;
  return (
    <li className={`step ${k.cls}${compact ? " compact" : ""}${isKey ? " key" : ""}`}>
      <span className="mk" aria-hidden>
        {st.kind === "met" || st.kind === "otherwise" ? <Check size={12} strokeWidth={3} /> : st.kind === "unknown" ? "?" : st.kind === "uncoded" ? <Minus size={12} strokeWidth={3} /> : st.kind === "option" || st.kind === "inferred" ? <GitFork size={11} /> : null}
      </span>
      <div className="st-body">
        {compact ? (
          <button type="button" className="st-line" aria-expanded={false} onClick={() => setOpen(true)} {...hover}>
            <ChevronRight size={12} aria-hidden /><span>{clip(parsed.plain, 96)}</span>
          </button>
        ) : (
          <>
            {st.kind === "flow" && !isKey && (
              <button type="button" className="st-line open" aria-expanded onClick={() => setOpen(false)}><ChevronDown size={12} aria-hidden /><span className="sr">Collapse</span></button>
            )}
            <div className="st-text" tabIndex={0} {...hover}><Blocks blocks={parsed.blocks} /></div>
            {(k.text || n.pred) && (
              <div className="st-why">
                {k.text && <span className={`tag-s ${k.cls}`}>{k.text}{st.share < 0.999 && st.kind !== "flow" ? ` · ${pct(st.share)} of this branch` : ""}</span>}
                {n.pred && <Cond c={conditionTree(n.pred, facts, g.bundle.schema)} />}
                {st.kind === "uncoded" && <span className="note">{n.review === "rejected" ? "A drafted condition for this box failed review, so the app cannot check it against your entries." : "Other arms here have conditions, but this one has none encoded, so the app cannot check it."}</span>}
              </div>
            )}
            <StepMeta id={st.node} fnOpen={fn} setFn={setFn} edgeUnsure={st.edge === "unsure"} />
            {fn && <Footnotes id={st.node} />}
          </>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- recommendation card

function Recommendation({ p }: { p: Pathway }) {
  const { g, go, s } = useApp();
  const f = routeFocus(g, p);
  const id = f.key.node;
  const n = g.node(id)!;
  const hover = useSrc(boxSrc(g, id), { click: false });
  const goto = gotoPage(g, id) ?? (f.follow ? gotoPage(g, f.follow.node) : null);
  const [fn, setFn] = useState(false);
  const alts = f.parentOfChoice ? g.kids(f.parentOfChoice) : [];
  const facts = derive(s.facts, g.bundle.schema);
  return (
    <section className="reco" aria-label="Recommended at this point">
      <span className="eyebrow">Recommended at this point · {n.page}</span>
      <div className="reco-box" tabIndex={0} {...hover}><Blocks blocks={g.parsed.get(id)!.blocks} /></div>
      <StepMeta id={id} fnOpen={fn} setFn={setFn} edgeUnsure={false} />
      {fn && <Footnotes id={id} />}
      <div className="rc-verify-row"><VerifyButton id={id} /><span className="rc-fine">{T.prototype}</span></div>
      {f.follow && (
        <p className="reco-then">
          <b>Then:</b> {clip(plain(g, f.follow.node), 160)}
          {goto && <> <button type="button" className="linkish" onClick={() => go({ kind: "flow", page: goto })}>Open {goto} <ArrowRight size={12} /></button></>}
        </p>
      )}
      {!f.follow && goto && <p className="reco-then"><button type="button" className="linkish" onClick={() => go({ kind: "flow", page: goto })}>Continues on {goto} · {g.bundle.pages[goto]?.title} <ArrowRight size={12} /></button></p>}
      {alts.length > 1 && f.choice && (
        <details className="alts" open={alts.length <= 4}>
          <summary>Options at this branch on {f.choice.node.split(":")[0]} ({alts.length})</summary>
          <ul>
            {alts.map((a) => {
              const v = g.preds[a] ? conditionTree(g.preds[a], facts, g.bundle.schema).verdict : null;
              return (
                <li key={a} className={a === f.choice!.node ? "chosen" : v === false ? "out" : ""}>
                  <span className="alt-text">{clip(plain(g, a), 140)}</span> <Tags id={a} />
                  {a === f.choice!.node && <span className="alt-tag">this route</span>}
                  {v === false && <span className="alt-tag">ruled out</span>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- clinician view

/** Opens the original NCCN page for a box (the page window, with the box marked). */
function VerifyButton({ id, primary = false }: { id: string; primary?: boolean }) {
  const { g } = useApp();
  const { open } = useSource();
  const src = boxSrc(g, id);
  const hover = useSrc(src, { click: false });
  if (!src) return null;
  return (
    <button type="button" className={`btn${primary ? " primary" : ""} rc-verify`} {...hover} onClick={() => open(src)}>
      <ExternalLink size={14} aria-hidden /> {T.verify}
    </button>
  );
}

/** The patient answers that decided a step on the way (fact name to the patient's value). */
export function usedAnswers(g: Graph, p: Pathway, facts: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const collect = (c: CondNode) => {
    if (c.t === "leaf") { if (c.value !== null && !out.has(c.fact)) out.set(c.fact, c.value); return; }
    if (c.verdict !== true) return;
    c.items.forEach((x) => { if (c.word === "any" && x.verdict !== true) return; collect(x); });
  };
  for (const st of p.steps) {
    if (st.kind === "met" && g.preds[st.node]) collect(conditionTree(g.preds[st.node], facts, g.bundle.schema));
    const received = st.kind === "inferred" ? g.node(st.node)?.received : null;   // "the patient already had this treatment"
    if (received) collect(conditionTree(received, facts, g.bundle.schema));
  }
  return out;
}

/** The patient answers that satisfied the conditions on the way to the recommendation, as label and value. */
export function whyAnswers(g: Graph, p: Pathway, facts: Record<string, unknown>): [string, string][] {
  return [...usedAnswers(g, p, facts)].map(([k, v]) => [label(k), v]);
}

/** How many of the patient's answers decided a step on this route (the route's own `used` when it has one). */
export const usedCount = (g: Graph, p: Pathway, facts: Record<string, unknown>) =>
  (p as { used?: string[] }).used?.length ?? usedAnswers(g, p, facts).size;

/** A box's content with page references as plain text (the headline is not a link). */
function plainBlocks(blocks: Block[]): Block[] {
  const inl = (xs: Inline[]): Inline[] => xs.map((x) => (x.t === "ref" ? { t: "text", v: x.label } : x.t === "link" ? { t: "text", v: x.text } : x));
  const item = (it: Item): Item => ({ inline: inl(it.inline), children: it.children.map(item) });
  return blocks.map((b) => (b.t === "lead" || b.t === "para" ? { ...b, inline: inl(b.inline) } : b.t === "list" ? { ...b, items: b.items.map(item) } : b));
}

/** The pages a route passes through, in order, with the first box on each. */
function routePages(p: Pathway) {
  const out: { code: string; node: string; judgment: boolean }[] = [];
  p.steps.forEach((st) => {
    const code = st.node.split(":")[0];
    if (!out.length || out[out.length - 1].code !== code) out.push({ code, node: st.node, judgment: false });
    if (st.kind === "uncoded") out[out.length - 1].judgment = true;
  });
  return out;
}

/** `used`: how many of the patient's answers decided a step on this route; `tied`: other recommendations in the same likelihood band. */
function RecoCard({ p, used, tied }: { p: Pathway; used: number; tied: number }) {
  const { g, go, set, s, isPhone, focusFact } = useApp();
  const { pdf, open } = useSource();
  const f = routeFocus(g, p);
  const id = f.key.node;
  const n = g.node(id)!;
  const src = boxSrc(g, id);
  const hover = useSrc(src, { click: false });
  const facts = useMemo(() => derive(s.facts, g.bundle.schema), [s.facts, g]);
  const why = useMemo(() => whyAnswers(g, p, facts), [g, p, facts]);
  const [allWhy, setAllWhy] = useState(false);
  const [allMissing, setAllMissing] = useState(false);
  const [fn, setFn] = useState(false);
  const [summary, setSummary] = useState(false);
  const goto = gotoPage(g, id) ?? (f.follow ? gotoPage(g, f.follow.node) : null);
  const title = g.bundle.pages[n.page]?.title;
  const name = pageName(n.page, title);
  const toDiagram = (page: string, node?: string) => { go({ kind: "flow", page, node }); if (isPhone) set({ sheet: false }); };
  const missing = allMissing ? p.missing : p.missing.slice(0, 6);
  // Be honest about support: a route that used none of the answers is only where the guideline starts.
  const start = used === 0;
  const word = matchWord(p.likelihood);
  const eyebrow = start ? "Possible starting point" : tied > 0 ? `One of ${tied + 1} possible recommendations` : word;
  const lead = !start && !tied && word === "Best match" ? "NCCN recommends" : start || tied > 0 ? "NCCN lists" : "NCCN also lists";
  return (
    <section className="reco reco-card" aria-label="Recommendation">
      <div className="rc-top">
        <span className="rc-match">{eyebrow}</span>
        {!start && <span className={`rc-support${p.missing.length ? " open" : ""}`}>{supportPhrase(p.missing.length)}</span>}
      </div>
      {start && (
        <div className="rc-start">
          <p className="rc-none">Not based on your answers yet — answer the questions to narrow it down</p>
          <button type="button" className="btn small" onClick={() => set({ rightTab: "patient" })}>Go to the patient questions <ArrowRight size={13} aria-hidden /></button>
        </div>
      )}
      <div className="rc-main">
        <span className="rc-label">{lead}</span>
        <div className="reco-box" tabIndex={0} {...hover}><Blocks blocks={plainBlocks(g.parsed.get(id)!.blocks)} /></div>
        {(n.footnotes.length > 0 || f.follow || goto) && (
          <div className="rc-more">
            {goto ? (
              <p className="reco-then">
                <b>Then:</b> continues on <button type="button" className="linkish rc-tap" onClick={() => toDiagram(goto)}>{pageName(goto, g.bundle.pages[goto]?.title)} <ArrowRight size={12} aria-hidden /></button>
              </p>
            ) : f.follow && <p className="reco-then"><b>Then:</b> {plain(g, f.follow.node)}</p>}
            {n.footnotes.length > 0 && (
              <button type="button" className="linkish rc-tap" aria-expanded={fn} onClick={() => setFn(!fn)}>
                {fn ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} Footnotes {n.footnotes.map((x) => x[0]).join(", ")}
              </button>
            )}
            {fn && <Footnotes id={id} />}
          </div>
        )}
      </div>

      <div className="rc-source">
        {pdf.status === "ready" && src && (
          <button type="button" className="rc-thumb" aria-label={`Open the NCCN page: ${name}`} {...hover} onClick={() => open(src)}>
            <PageCrop t={src} width={190} />
          </button>
        )}
        <div className="rc-src-text">
          <span className="rc-label">Shown on</span>
          <b className="rc-src-title">{name}</b>
          {src && <span className="rc-src-pdf">NCCN page, PDF p.{src.page + 1}</span>}
          <div className="rc-src-actions">
            <VerifyButton id={id} primary />
            <button type="button" className="linkish rc-tap" onClick={() => toDiagram(n.page, n.full)}><LocateFixed size={13} aria-hidden /> Show in the diagram</button>
          </div>
        </div>
      </div>

      <div className="rc-sec">
        <h4 className="rc-h">Why</h4>
        {why.length > 0 ? (
          <>
            <ul className="rc-why">{(allWhy ? why : why.slice(0, 4)).map(([k, v]) => <li key={k}><span>{k}</span><b>{v}</b></li>)}</ul>
            {why.length > 4 && <button type="button" className="linkish rc-tap" aria-expanded={allWhy} onClick={() => setAllWhy(!allWhy)}>{allWhy ? "Show fewer" : `Show all ${why.length}`}</button>}
          </>
        ) : <p className="rc-none">Nothing you have entered is needed yet: this is where the guideline starts for this patient.</p>}
      </div>

      {p.missing.length > 0 && (
        <div className="rc-sec">
          <h4 className="rc-h">Still unknown</h4>
          <p className="rc-none">Answering {p.missing.length === 1 ? "this" : "these"} could change the recommendation.</p>
          <div className="rc-qs">
            {missing.map((m) => <button key={m} type="button" className="rc-q" onClick={() => focusFact(m)}>{label(m)}</button>)}
            {p.missing.length > 6 && <button type="button" className="linkish rc-tap" aria-expanded={allMissing} onClick={() => setAllMissing(!allMissing)}>{allMissing ? "Show fewer" : `${p.missing.length - 6} more`}</button>}
          </div>
        </div>
      )}
      {p.uncoded > 0 && (
        <div className="rc-sec">
          <h4 className="rc-h">{T.judgment}</h4>
          <p className="rc-none">The guideline branches at {p.uncoded === 1 ? "1 step" : `${p.uncoded} steps`} on the way and OncoCarta cannot check {p.uncoded === 1 ? "it" : "them"}.</p>
        </div>
      )}

      <div className="rc-foot">
        <button type="button" className="btn small" onClick={() => setSummary(true)}><FileText size={14} aria-hidden /> Summary to copy or print</button>
        <p className="rc-fine">{T.prototype}</p>
      </div>
      {summary && <Summary p={p} onClose={() => setSummary(false)} />}
    </section>
  );
}

function OtherItem({ p, onPick, start }: { p: Pathway; onPick: () => void; start: boolean }) {
  const { g } = useApp();
  const f = routeFocus(g, p);
  const n = g.node(f.key.node)!;
  return (
    <li>
      <button type="button" className="pcard other" onClick={onPick}
        aria-label={`${start ? "Possible" : matchWord(p.likelihood)}: ${clip(plain(g, f.key.node), 120)}. Show this recommendation`}>
        <span className="pc-top">
          <span className="pc-word">{start ? "Possible starting point" : matchWord(p.likelihood)}</span>
          {!start && <span className="pc-support">{supportPhrase(p.missing.length)}</span>}
        </span>
        <span className="pc-end clamp">{plain(g, f.key.node)}</span>
        <Tags id={f.key.node} />
        <span className="pc-where">{pageName(n.page, g.bundle.pages[n.page]?.title)}</span>
      </button>
    </li>
  );
}

function ClinicianView({ p }: { p: Pathway }) {
  const { g, go, set, s, isPhone, ranking, showPath } = useApp();
  const [all, setAll] = useState(false);
  const facts = useMemo(() => derive(s.facts, g.bundle.schema), [s.facts, g]);
  const used = usedCount(g, p, facts);
  // Routes that end in the same recommendation count once.
  const others = useMemo(() => {
    const seen = new Set([routeFocus(g, p).key.node]);
    return ranking.paths.filter((x) => {
      if (x.id === p.id) return false;
      const k = routeFocus(g, x).key.node;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [g, ranking, p]);
  const shown = all ? others : others.slice(0, 4);
  // Same likelihood band: the app has no basis for ordering them, so none is presented as the advice.
  const tied = others.filter((x) => matchWord(x.likelihood) === matchWord(p.likelihood)).length;
  const pages = routePages(p);
  const pick = (id: string) => { showPath(id); document.getElementById("rp-panel")?.scrollTo({ top: 0 }); };
  return (
    <>
      <RecoCard key={p.id} p={p} used={used} tied={tied} />
      {others.length > 0 && (
        <section className="rc-others" aria-label="Other possible recommendations">
          <h3 className="rc-h2">Other possible recommendations ({others.length}){used > 0 && tied === others.length && " — equally possible from your answers"}</h3>
          <ol className="plist">{shown.map((x) => <OtherItem key={x.id} p={x} start={used === 0} onPick={() => pick(x.id)} />)}</ol>
          {others.length > 4 && <button type="button" className="btn ghost small wide" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${others.length}`}</button>}
        </section>
      )}
      {pages.length > 0 && (
        <section className="rc-gets" aria-label="How the patient gets here">
          <h3 className="rc-h2">How the patient gets here</h3>
          <ol className="gets">
            {pages.map((x, i) => (
              <li key={i} className={i === pages.length - 1 ? "last" : ""}>
                <button type="button" className="gets-btn" aria-current={i === pages.length - 1 ? "step" : undefined}
                  onClick={() => { go({ kind: "flow", page: x.code, node: x.node }); if (isPhone) set({ sheet: false }); }}>
                  {pageName(x.code, g.bundle.pages[x.code]?.title)}
                  {x.judgment && <span className="gets-judge">{T.judgment}</span>}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- route detail

function Detail({ p }: { p: Pathway }) {
  const { g, s, focusFact } = useApp();
  const [why, setWhy] = useState(false);
  const [summary, setSummary] = useState(false);
  const facts = derive(s.facts, g.bundle.schema);
  const crit = p.met + p.open;
  const f = routeFocus(g, p);
  const byPage: { page: string; steps: PStep[] }[] = [];
  p.steps.forEach((st) => {
    const pg = st.node.split(":")[0];
    if (byPage.length && byPage[byPage.length - 1].page === pg) byPage[byPage.length - 1].steps.push(st);
    else byPage.push({ page: pg, steps: [st] });
  });
  const unsure = p.steps.filter((x) => x.edge === "unsure").length;
  const drafts = p.steps.filter((x) => g.preds[x.node] && g.node(x.node)?.review !== "reviewed").length;
  const dw = dataWord(p), ew = extractionWord(p);
  return (
    <article className="pdetail" aria-label="Selected pathway">
      <Recommendation p={p} />
      <div className="scores">
        <div><span className="sv">{likelihoodWord(p.likelihood)}</span><span className="sl">fit · {pct(p.likelihood)} of open routes</span></div>
        <div><span className={`sv tone-${tone(dw)}`}>{dw}</span><span className="sl">patient data · {crit ? `${p.met} of ${crit} criteria` : "nothing to check"}</span></div>
        <div><span className={`sv tone-${tone(ew)}`}>{ew}</span><span className="sl">extraction · {Math.round(p.encoding * 100)}%</span></div>
      </div>
      <div className="pd-actions">
        <button type="button" className="linkish" aria-expanded={why} onClick={() => setWhy(!why)}><CircleHelp size={13} /> How these are worked out</button>
        <button type="button" className="btn small" onClick={() => setSummary(true)}><FileText size={13} /> Summary to copy or print</button>
      </div>
      {why && (
        <div className="why">
          <p><b>Fit</b> ranks the routes your entries leave open. At each branch, arms whose criteria are met share the route's weight; arms that need more details share it equally, and keep only a small share once another arm is met. The percentage is this route's share. It describes how well the route matches what you entered, not a clinical probability.</p>
          <p><b>Patient data</b> counts the encoded conditions on this route that your entries satisfy ({p.met}) against those still open ({p.open}{p.uncoded ? `, including ${p.uncoded} with no encoded condition` : ""}). Treatment options the guideline offers side by side are not counted.</p>
          <p><b>Extraction</b> averages how reliably each step was read from the PDF: arrows found by both extraction methods count 100%, image-verified 95%, one method only 70% ({unsure} here); conditions not confirmed in review count 85% ({drafts} here).</p>
          <p className="note">Conditions were drafted and reviewed by a language model, not by clinicians. Check every step against the guideline page.</p>
        </div>
      )}
      {(p.missing.length > 0 || p.uncoded > 0) && (
        <div className="missing">
          {p.missing.length > 0 && <p>To firm this up, add: {p.missing.map((m, i) => <Fragment key={m}>{i > 0 && ", "}<button type="button" className="need" onClick={() => focusFact(m)}>{label(m)}</button></Fragment>)}</p>}
          {p.uncoded > 0 && <p>{p.uncoded} step{p.uncoded > 1 ? "s rely" : " relies"} on your judgment: the guideline branches there but no condition is encoded. They are marked <span className="tag-s uncoded">not encoded</span> below.</p>}
        </div>
      )}
      <h4 className="trail-h">Every step</h4>
      <ol className="trail">
        {byPage.map(({ page, steps }, i) => (
          <li key={i} className="trail-page">
            <div className="tp-head"><code>{page}</code><span>{g.bundle.pages[page]?.title}</span></div>
            <ol>{steps.map((st) => <Step key={st.node} st={st} facts={facts} isKey={st === f.key} />)}</ol>
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
      {summary && <Summary p={p} onClose={() => setSummary(false)} />}
    </article>
  );
}

export function conditionText(g: Graph, id: string, facts: Record<string, unknown>) {
  const c = conditionTree(g.preds[id], facts, g.bundle.schema);
  const flat = (x: CondNode): string => (x.t === "leaf" ? x.text : x.items.map(flat).join(x.word === "all" ? " and " : " or "));
  return flat(c);
}

function EmptyState() {
  const { s, g, set, ranking: r } = useApp();
  const adv = useAdvanced();
  const entered = Object.keys(s.facts).length > 0;
  const toQuestions = () => set({ rightTab: "patient" });
  return (
    <div className="empty">
      {s.start === "auto" && !entered ? (
        <>
          <h3>Answer a few questions to see the recommendation</h3>
          <p>{startingFacts(g, 6).length ? <>Start with what decides the first steps: {startingFacts(g, 6).map(label).join(", ")}.</> : "Answer what the record says."}{(g.bundle.examples ?? []).length > 0 && " Or load an example patient."}</p>
          <button type="button" className="btn primary" onClick={toQuestions}>Go to the patient questions <ArrowRight size={14} /></button>
        </>
      ) : (
        <>
          <h3>No recommendation fits these answers</h3>
          <p>Check the answers, or say where the patient is now.{adv && <> Every route from this starting point contradicts something entered ({r.ruledOut} arms ruled out).</>}</p>
          <button type="button" className="btn primary" onClick={toQuestions}>Back to the patient questions <ArrowRight size={14} /></button>
        </>
      )}
    </div>
  );
}

export function PathwaysPanel() {
  const { s, g, setStart, ranking: r, selected, showPath, focusFact } = useApp();
  const adv = useAdvanced();
  const [all, setAll] = useState(false);
  const shown = all ? r.paths : r.paths.slice(0, 5);
  return (
    <div className="paths">
      {adv && (
        <div className="start">
          <label htmlFor="start">Start from</label>
          <select id="start" className="sel" value={s.start} onChange={(e) => setStart(e.target.value)}>
            <option value="auto">Wherever the patient's details point</option>
            {g.flowPages.filter((p) => (g.bundle.roots[p] ?? []).length).map((p) => <option key={p} value={p}>{p} · {clip(g.bundle.pages[p].title ?? "", 52)}</option>)}
          </select>
        </div>
      )}

      {!r.paths.length || !selected ? <EmptyState /> : !adv ? <ClinicianView p={selected} /> : (
        <>
          <p className="summary" aria-live="polite">
            {r.paths.length === 1 ? "One route fits" : `${r.paths.length} routes fit`} your entries{r.ruledOut ? `; ${r.ruledOut} arms ruled out` : ""}.
            {r.truncated && " Only the first 4,000 routes were scored."}
          </p>
          {r.nextBest && r.nextBest.share > 0.2 && (
            <p className="nudge">
              <b>Most useful next:</b> <button type="button" className="need" onClick={() => focusFact(r.nextBest!.fact)}>{label(r.nextBest.fact)}</button>
              <span> — still open on routes holding {pct(r.nextBest.share)} of the fit.</span>
            </p>
          )}
          <ol className="plist">
            {shown.map((p, i) => <PathCard key={p.id} p={p} rank={i + 1} on={selected.id === p.id} onPick={() => showPath(p.id)} />)}
          </ol>
          {r.paths.length > 5 && <button type="button" className="btn ghost small wide" onClick={() => setAll(!all)}>{all ? "Show top 5" : `Show all ${r.paths.length} routes`}</button>}
          <Detail p={selected} />
        </>
      )}
    </div>
  );
}

