import { Fragment, useMemo, useState } from "react";
import { Check, CircleDashed, CircleHelp, GitFork, ArrowRight, LocateFixed, Minus, FileText, ChevronDown, ChevronRight, ExternalLink, Sparkles } from "lucide-react";
import { useApp, useAdvanced } from "../store";
import type { Pathway, PStep } from "../lib/pathways";
import { isRecommendationEnd, likelihoodWord, startingFacts } from "../lib/pathways";
import { conditionTree, type CondNode } from "../lib/humanize";
import { derive } from "../lib/predicates";
import { factValue, label } from "../lib/factMeta";
import { remainingQuestions } from "../lib/formAssist";
import { Blocks, Linked } from "./Rich";
import { PageCrop, SrcChip, useSource, useSrc, type SrcTarget } from "../source";
import { resolveRef, type Graph } from "../lib/graph";
import { gateSentence } from "../lib/moments";
import { whyNothingFits } from "../lib/formAssist";
import type { Block, Inline, Item } from "../lib/parseBox";
import { Summary } from "./Summary";
import { DecisionTrail } from "./Trail";
import { aiAssistedLine, trailStats, trimToRoute } from "../lib/trailView";
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
    <button type="button" className={`btn${primary ? " primary" : ""} rc-verify`} title="Opens the NCCN page in a new window" {...hover} onClick={() => open(src)}>
      <ExternalLink size={14} aria-hidden /> {T.verify}
    </button>
  );
}

// ---- text hygiene: footnote letters glued to words ("imagingg", "ADTaa,zz", "CSPCh")

interface TextIndex { holders: Map<string, Set<string>>; letters: Set<string> }
const indexCache = new WeakMap<Graph, TextIndex>();
const wordsOf = (t: string) => t.split(/[\s•\u0017◊]+/).filter(Boolean);
const marksCache = new WeakMap<Graph, Map<string, Set<string>>>();
function pageMarksOf(g: Graph): Map<string, Set<string>> {
  let m = marksCache.get(g);
  if (!m) {
    m = new Map();
    for (const n of g.nodes.values()) {
      const set = m.get(n.page) ?? m.set(n.page, new Set()).get(n.page)!;
      n.footnotes.forEach((f) => set.add(f[0]));
    }
    marksCache.set(g, m);
  }
  return m;
}
function textIndex(g: Graph): TextIndex {
  let x = indexCache.get(g);
  if (x) return x;
  x = { holders: new Map(), letters: new Set() };
  for (const n of g.nodes.values()) {
    for (const w of wordsOf(n.text)) {
      (x.holders.get(w) ?? x.holders.set(w, new Set()).get(w)!).add(n.full);
      x.letters.add(w.replace(/[^A-Za-z]/g, "").toLowerCase());
    }
  }
  indexCache.set(g, x);
  return x;
}

/**
 * The text of a box without the footnote marks the extraction left glued to words. A word loses a
 * trailing mark only when that mark is one of the box's own footnote letters, every box that holds
 * the word carries it, and the word without the mark is a word the guideline uses elsewhere.
 */
export function cleanText(g: Graph, id: string, text: string): string {
  const n = g.node(id);
  if (!n) return text;
  const idx = textIndex(g);
  // Marks the box's page declares: a word loses a trailing one when every box holding the word carries it.
  const pageMarks = pageMarksOf(g);
  const marks = [...(pageMarks.get(n.page) ?? [])].sort((a, b) => b.length - a.length);
  const alt = marks.map((m) => m.replace(/[^A-Za-z0-9]/g, "")).join("|");
  const tail = marks.length ? new RegExp(`(?:${alt})(?:,(?:${alt}))*$`) : null;
  const owns = (node: string, tl: string) => { const have = pageMarks.get(g.node(node)?.page ?? ""); return !!have && tl.split(",").every((m) => have.has(m)); };
  const holdersN = (t: string) => idx.holders.get(t)?.size ?? 0;
  /** Table cells declare no footnotes: recognise the glued shapes themselves ("imagingg", "ADTaa,zz", "cores)k", "CSPCh"). */
  const loose = (w: string): string | null => {
    const pairs = /^(.+?)((?:[a-z]{2})(?:,[a-z]{2})*)$/.exec(w);
    if (pairs && pairs[2].split(",").every((p) => p[0] === p[1]) && pairs[1].length >= 2 && (/[A-Z0-9)\]]$/.test(pairs[1]) || holdersN(pairs[1]) >= 2)) return pairs[1];
    if (/^.{3,}\)[a-z]$/.test(w)) return w.slice(0, -1);
    const caps = /^([A-Z]{3,})([a-z])$/.exec(w);
    if (caps && !"sm".includes(caps[2]) && holdersN(caps[1]) >= 3 * Math.max(1, holdersN(w))) return caps[1];
    const last = w.slice(-1), base = w.slice(0, -1);
    if (base.length >= 4 && /[a-z]/.test(last) && base.endsWith(last) && holdersN(base) >= 2 && !/[^A-Za-z]/.test(base)) return base;
    // a mark glued mid-sentence ("Oligometastatich CSPC"): the word without it is common, with it rare (plurals excluded)
    if (base.length >= 6 && /[a-z]/.test(last) && last !== "s" && /^[A-Za-z]+$/.test(base) && holdersN(base) >= 3 * Math.max(1, holdersN(w))) return base;
    return null;
  };
  return text.split(/(\s+)/).map((tok) => {
    const m = /^(.*?)([,.;:]*)$/.exec(tok)!;
    const w = m[1];
    const t = tail?.exec(w);
    if (t && t.index >= 2) {
      const base = w.slice(0, t.index);
      const holders = idx.holders.get(w);
      const letters = base.replace(/[^A-Za-z]/g, "").toLowerCase();
      if (holders && [...holders].every((h) => owns(h, t[0])) && letters.length >= 2 && idx.letters.has(letters)) return base + m[2];
    }
    const b = w.length > 3 ? loose(w) : null;
    return b ? b + m[2] : tok;
  }).join("");
}

/** A box's content with page references as plain text and footnote marks removed. */
export function tidyBlocks(g: Graph, id: string, blocks: Block[]): Block[] {
  const inl = (xs: Inline[]): Inline[] => xs.map((x) => (x.t === "ref" ? { t: "text", v: cleanText(g, id, x.label) } : x.t === "link" ? { t: "text", v: cleanText(g, id, x.text) } : x.t === "text" ? { ...x, v: cleanText(g, id, x.v) } : x));
  const item = (it: Item): Item => ({ inline: inl(it.inline), children: it.children.map(item) });
  return blocks.map((b) => (b.t === "lead" || b.t === "para" ? { ...b, inline: inl(b.inline) } : b.t === "list" ? { ...b, items: b.items.map(item) } : b));
}

// ---- what a route offers

const keyId = (g: Graph, p: Pathway) => routeFocus(g, p).key.node;
const keyText = (g: Graph, p: Pathway) => cleanText(g, keyId(g, p), plain(g, keyId(g, p)));
const normText = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Does the route get as far as a recommendation, or does it stop at a criteria box / an open branch? */
export function reachesRecommendation(g: Graph, p: Pathway): boolean {
  const key = routeFocus(g, p).key;
  // a route that hands over to another page, or stops at an open branch, ends in no recommendation (never a page heading)
  if (!isRecommendationEnd(p)) return false;
  if (key.kind === "unknown" || key.kind === "uncoded") return false;
  const kn = g.node(key.node);
  if (g.bundle.structured) return kn?.decision !== "condition" && !/condition/.test(kn?.role ?? "");
  return !(key === p.steps[p.steps.length - 1] && isCondition(g, key));
}

const BANDS = ["Best match", "Also possible", "Less likely", "Unlikely"];
/** NCCN preference of an option: 0 preferred, then category 1, 2A, 2B, 3, then the rest. */
function preference(g: Graph, p: Pathway): number {
  const id = keyId(g, p);
  const parsed = g.parsed.get(id);
  const tags = parsed?.tags ?? [];
  if (tags.includes("Preferred") || /\bpreferred\b/i.test(parsed?.plain ?? "")) return 0;
  const cat = tags.find((t) => t.startsWith("Category"));
  if (!cat) return 9;
  const c = /\d/.exec(cat);
  return c ? 1 + Number(c[0]) + (/B/.test(cat) ? 0.5 : 0) : 9;
}
const sameUsed = (a: Pathway, b: Pathway) => a.used.length === b.used.length && a.used.every((x) => b.used.includes(x));

/** How many of the patient's answers decided a step on this route (the route's own list). */
export const usedCount = (p: Pathway) => p.used.length;

/** The answers the patient gave that are on file (raw facts), without carried-over ones awaiting confirmation. */
function enteredFacts(facts: Record<string, unknown>, stale: string[]) {
  return Object.entries(facts).filter(([k, v]) => !stale.includes(k) && !k.endsWith("_stated") && v !== undefined && v !== null && v !== "" && v !== "unknown");
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

interface CardProps { p: Pathway; tied: number; isTop: boolean }

function RecoCard({ p, tied, isTop }: CardProps) {
  const { g, go, set, s, isPhone, focusFact, ai } = useApp();
  const { pdf, open } = useSource();
  const f = routeFocus(g, p);
  // "AI-assisted": the decisions on the way to this recommendation that the AI chose
  const aiLine = useMemo(() => (ai.on && ai.ai ? aiAssistedLine(trailStats(trimToRoute(ai.ai, new Set(p.steps.map((x) => x.node))))) : null), [ai.on, ai.ai, p]);
  const id = f.key.node;
  const n = g.node(id)!;
  const src = boxSrc(g, id);
  const hover = useSrc(src, { click: false });
  const schema = g.bundle.schema;
  const used = p.used;
  const entered = useMemo(() => enteredFacts(s.facts, s.stale), [s.facts, s.stale]);
  const why = useMemo(() => used.filter((k) => s.facts[k] !== undefined && s.facts[k] !== null).map((k) => [label(k), factValue(k, s.facts[k], schema)] as [string, string]), [used, s.facts, schema]);
  const notUsed = useMemo(() => entered.filter(([k]) => !used.includes(k)).map(([k]) => label(k)), [entered, used]);
  const [allWhy, setAllWhy] = useState(false);
  const [allMissing, setAllMissing] = useState(false);
  const [allUnused, setAllUnused] = useState(false);
  const [fn, setFn] = useState(false);
  const [summary, setSummary] = useState(false);
  const goto = gotoPage(g, id) ?? (f.follow ? gotoPage(g, f.follow.node) : null);
  const title = g.bundle.pages[n.page]?.title;
  const name = pageName(n.page, title);
  const toDiagram = (page: string, node?: string) => { go({ kind: "flow", page, node }); if (isPhone) set({ sheet: false }); };
  const missing = allMissing ? p.missing : p.missing.slice(0, 6);
  // Be honest about support, from this route's own answers: a route that used none is only where the guideline starts.
  const start = used.length === 0;
  const word = matchWord(p.likelihood);
  const eyebrow = start ? "Possible starting point" : tied > 0 ? `One of ${tied + 1} possible recommendations` : word;
  const lead = !start && !tied && word === "Best match" ? "NCCN recommends" : start || tied > 0 ? "NCCN lists" : "NCCN also lists";
  const support = p.missing.length ? supportPhrase(p.missing.length) : isTop ? "Matches your answers" : word === "Also possible" ? "Also fits your answers" : "";
  const shownWhy = allWhy ? why : why.slice(0, 4);
  const unused = allUnused ? notUsed : notUsed.slice(0, 6);
  return (
    <section className="reco reco-card" aria-label="Recommendation">
      <div className="rc-top">
        <span className="rc-match">{eyebrow}</span>
        {!start && support && <span className={`rc-support${p.missing.length ? " open" : ""}`}>{support}</span>}
      </div>
      {start && (
        <div className="rc-start">
          <p className="rc-none">Not based on your answers yet — answer the questions to narrow it down</p>
          <button type="button" className="btn small" onClick={() => set({ rightTab: "patient" })}>Go to the patient questions <ArrowRight size={13} aria-hidden /></button>
        </div>
      )}
      <div className="rc-main">
        <span className="rc-label">{lead}</span>
        <div className="reco-box" tabIndex={0} {...hover}><Blocks blocks={tidyBlocks(g, id, g.parsed.get(id)!.blocks)} /></div>
        {(n.footnotes.length > 0 || f.follow || goto) && (
          <div className="rc-more">
            {goto ? (
              <p className="reco-then">
                <b>Then:</b> continues on <button type="button" className="linkish rc-tap" onClick={() => toDiagram(goto)}>{pageName(goto, g.bundle.pages[goto]?.title)} <ArrowRight size={12} aria-hidden /></button>
              </p>
            ) : f.follow && <p className="reco-then"><b>Then:</b> {cleanText(g, f.follow.node, plain(g, f.follow.node))}</p>}
            {n.footnotes.length > 0 && (
              <button type="button" className="linkish rc-tap" aria-expanded={fn} onClick={() => setFn(!fn)}>
                {fn ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} Notes ({n.footnotes.length})
              </button>
            )}
            {fn && <Footnotes id={id} />}
          </div>
        )}
      </div>

      {aiLine && (
        <p className="rc-ai" data-testid="ai-assisted">
          <Sparkles size={13} aria-hidden />
          <span>{aiLine.replace(/ Review in How we got here\.$/, "")}</span>
          <button type="button" className="linkish rc-tap" onClick={() => window.dispatchEvent(new CustomEvent("oc-open-trail"))}>Review in How we got here.</button>
        </p>
      )}

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
            <button type="button" className="linkish rc-tap" onClick={() => toDiagram(n.page, n.full)}><LocateFixed size={13} aria-hidden /> Show this page in the diagram</button>
          </div>
        </div>
      </div>

      <div className="rc-sec">
        <h4 className="rc-h">Why</h4>
        {why.length > 0 ? (
          <>
            <ul className="rc-why">{shownWhy.map(([k, v]) => <li key={k}><span>{k}</span><b>{v}</b></li>)}</ul>
            {why.length > 4 && <button type="button" className="linkish rc-tap" aria-expanded={allWhy} onClick={() => setAllWhy(!allWhy)}>{allWhy ? "Show fewer" : `Show all ${why.length}`}</button>}
          </>
        ) : <p className="rc-none">Nothing you have entered is needed yet: this is where the guideline starts for this patient.</p>}
        {notUsed.length > 0 && (
          <p className="rc-none">
            Not used for this recommendation: {unused.join(", ")}
            {notUsed.length > 6 && !allUnused && <> and <button type="button" className="linkish rc-tap" onClick={() => setAllUnused(true)}>{notUsed.length - 6} more</button></>}
          </p>
        )}
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

/** Where the NCCN page for a code can be opened: the page itself, its parent page for a continuation
 * ("REC-3A" -> REC-3), a document page, or else the box that sends the reader there. */
function pageSource(g: Graph, code: string, fromNode: string): { page: string | null; src: SrcTarget | null } {
  const t = resolveRef(g, code);
  const page = t.type === "flow" ? t.page : null;
  const pdf = page ? g.bundle.pages[page]?.pdf : t.type === "doc" ? g.bundle.docs[t.code]?.pages[0]?.pdf : undefined;
  if (pdf !== undefined && pdf !== null) {
    const excerpt = page ? g.bundle.pages[page].title : t.type === "doc" ? g.bundle.docs[t.code].title : undefined;
    return { page, src: { page: pdf, label: code, excerpt } };
  }
  return { page, src: boxSrc(g, fromNode) };
}

/** The route hands over to another page of the guideline: no recommendation yet, but one clear way on. */
function ContinuesCard({ p, to }: { p: Pathway; to: string }) {
  const { g, go, set, s, isPhone } = useApp();
  const { open } = useSource();
  const last = p.steps[p.steps.length - 1].node;
  const { page, src } = pageSource(g, to, last);
  const title = g.bundle.pages[page ?? to]?.title;
  const name = pageName(to, title && title !== to ? title : null);
  const schema = g.bundle.schema;
  const why = useMemo(() => p.used.filter((k) => s.facts[k] !== undefined && s.facts[k] !== null).map((k) => [label(k), factValue(k, s.facts[k], schema)] as [string, string]), [p.used, s.facts, schema]);
  return (
    <section className="reco reco-card continues" aria-label="Next step" data-testid="continues-card">
      <div className="rc-top"><span className="rc-match">Next step</span></div>
      <div className="rc-main">
        <h3 className="rc-next">The next step is on <b>{name}</b></h3>
        <p className="rc-none">The guideline hands over to that page here. Open it to see the options and what decides between them.</p>
        <div className="rc-src-actions">
          {src && <button type="button" className="btn primary rc-verify" title="Opens the NCCN page in a new window" onClick={() => open(src)}><ExternalLink size={14} aria-hidden /> Open the NCCN page</button>}
          {page && <button type="button" className="btn small" onClick={() => { go({ kind: "flow", page }); if (isPhone) set({ sheet: false }); }}><LocateFixed size={13} aria-hidden /> Show this page</button>}
        </div>
      </div>
      {why.length > 0 && (
        <div className="rc-sec">
          <h4 className="rc-h">Why</h4>
          <ul className="rc-why">{why.slice(0, 6).map(([k, v]) => <li key={k}><span>{k}</span><b>{v}</b></li>)}</ul>
        </div>
      )}
      <div className="rc-foot"><p className="rc-fine">{T.prototype}</p></div>
    </section>
  );
}

/** The best route stops before a recommendation: say which answers would get it there. */
function NeedsCard({ p }: { p: Pathway }) {
  const { g, set, s, ranking, focusFact } = useApp();
  const [all, setAll] = useState(false);
  const questions = useMemo(() => {
    const names = [...remainingQuestions(g, ranking, s.facts).map((d) => d.fact), ...p.missing, ...p.laterMissing];
    return [...new Set(names)].filter((f) => g.bundle.schema.variables[f]);
  }, [g, ranking, s.facts, p]);
  const shown = all ? questions : questions.slice(0, 6);
  return (
    <section className="reco reco-card needs" aria-label="More answers needed">
      <div className="rc-top"><span className="rc-match">More answers needed</span></div>
      <p className="rc-needs-h">Answer these to reach a recommendation:</p>
      {questions.length > 0 && (
        <div className="rc-qs">
          {shown.map((m) => <button key={m} type="button" className="rc-q" onClick={() => focusFact(m)}>{label(m)}</button>)}
          {questions.length > 6 && <button type="button" className="linkish rc-tap" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show fewer" : `${questions.length - 6} more`}</button>}
        </div>
      )}
      <div className="rc-start"><button type="button" className="btn small" onClick={() => set({ rightTab: "patient" })}>Go to the patient questions <ArrowRight size={13} aria-hidden /></button></div>
      <div className="rc-foot"><p className="rc-fine">{T.prototype}</p></div>
    </section>
  );
}

function OtherItem({ p, onPick, start }: { p: Pathway; onPick: () => void; start: boolean }) {
  const { g } = useApp();
  const id = keyId(g, p);
  const n = g.node(id)!;
  const word = matchWord(p.likelihood);
  const text = keyText(g, p);
  // each card's phrase comes from its own route; "Matches your answers" is the top card's alone
  const support = p.missing.length ? supportPhrase(p.missing.length) : p.used.length && word === "Also possible" ? "Also fits your answers" : "";
  return (
    <li>
      <button type="button" className="pcard other" onClick={onPick} aria-label={`${start ? "Possible" : word}: ${text}. Show this recommendation`}>
        <span className="pc-top">
          <span className="pc-word">{start ? "Possible starting point" : word}</span>
          {!start && support && <span className="pc-support">{support}</span>}
        </span>
        <span className="pc-end">{text}</span>
        <Tags id={id} />
        <span className="pc-where">{pageName(n.page, g.bundle.pages[n.page]?.title)}</span>
      </button>
    </li>
  );
}

function ClinicianView() {
  const { g, go, set, s, isPhone, ranking, showPath } = useApp();
  const [all, setAll] = useState(false);
  const top = ranking.paths[0];
  // Distinct recommendations that reach one: identical wording counts once; within a likelihood band, NCCN-preferred first.
  const ordered = useMemo(() => {
    const seen = new Set<string>();
    const list: { p: Pathway; i: number }[] = [];
    ranking.paths.forEach((x, i) => {
      if (!reachesRecommendation(g, x)) return;
      const k = normText(keyText(g, x));
      if (seen.has(k)) return;
      seen.add(k);
      list.push({ p: x, i });
    });
    const band = (x: Pathway) => BANDS.indexOf(matchWord(x.likelihood));
    return list.sort((a, b) => band(a.p) - band(b.p) || preference(g, a.p) - preference(g, b.p) || a.i - b.i).map((x) => x.p);
  }, [g, ranking]);
  const picked = s.pathSel ? ranking.paths.find((x) => x.id === s.pathSel) : undefined;
  const p = picked ?? (top && !reachesRecommendation(g, top) ? top : ordered[0] ?? top);
  if (!p) return null;
  const reaches = reachesRecommendation(g, p);
  // a route that hands over to another page: the card says where the next step is
  const next = reaches || p.end !== "continues" ? null : p.continuesTo ?? null;
  const mine = normText(keyText(g, p));
  const others = reaches ? ordered.filter((x) => x.id !== p.id && normText(keyText(g, x)) !== mine) : ordered;
  const shown = all ? others : others.slice(0, 4);
  // Same likelihood band and the same answers behind them: the app has no basis to rank them, so none is presented as the advice.
  const tiedWith = others.filter((x) => matchWord(x.likelihood) === matchWord(p.likelihood) && sameUsed(x, p));
  const tied = reaches ? tiedWith.length : 0;
  const pages = routePages(p);
  const pick = (id: string) => { showPath(id); document.getElementById("rp-panel")?.scrollTo({ top: 0 }); };
  const toOthers = () => {
    const el = document.getElementById("rc-others"), sc = document.getElementById("rp-panel");
    if (el && sc) sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8, behavior: "smooth" });
  };
  return (
    <>
      {reaches ? <RecoCard key={p.id} p={p} tied={tied} isTop={p.id === ordered[0]?.id} /> : next ? <ContinuesCard key={p.id} p={p} to={next} /> : <NeedsCard key={p.id} p={p} />}
      <DecisionTrail p={p} />
      {reaches && others.length > 0 && (
        <button type="button" className="linkish rc-tap rc-below" onClick={toOthers}>{others.length} other possible recommendation{others.length === 1 ? "" : "s"} below <ChevronDown size={13} aria-hidden /></button>
      )}
      {others.length > 0 && (
        <section id="rc-others" className="rc-others" aria-label="Other possible recommendations">
          <h3 className="rc-h2">Other possible recommendations ({others.length}){reaches && tied > 0 && tied === others.length && " — equally possible from your answers"}</h3>
          <ol className="plist">{shown.map((x) => <OtherItem key={x.id} p={x} start={x.used.length === 0} onPick={() => pick(x.id)} />)}</ol>
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
  const gate = useMemo(() => (s.start === "auto" && !entered ? null : whyNothingFits(g, s.facts, s.start)), [g, s.facts, s.start, entered]);
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
          <p>{gate ? gateSentence(g, gate, s.facts) : "Check the answers, or say what the patient needs."}{adv && <> Every route from this starting point contradicts something entered ({r.ruledOut} arms ruled out).</>}</p>
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

      {!r.paths.length || !selected ? <EmptyState /> : !adv ? <ClinicianView /> : (
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
          <DecisionTrail p={selected} />
        </>
      )}
    </div>
  );
}

