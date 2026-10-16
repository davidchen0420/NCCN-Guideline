import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Printer, X } from "lucide-react";
import { useApp, useAdvanced } from "../store";
import type { Pathway } from "../lib/pathways";
import { likelihoodWord, recommendationOf } from "../lib/pathways";
import { byTag, decisionByChosen, percent, trimToRoute } from "../lib/trailView";
import { T, matchWord, pageName, supportPhrase } from "../lib/terms";
import { derive } from "../lib/predicates";
import { factValue, label, valueLabel } from "../lib/factMeta";
import type { Block, Inline, Item } from "../lib/parseBox";
import { Blocks } from "./Rich";
import { clip, conditionText, dataWord, extractionWord, gotoPage, pct, plain, routeFocus, usedCount, cleanText, tidyBlocks } from "./PathwaysPanel";

/** A box's structure as plain text: tiers as headings, bullets kept, "or" on its own line. */
function inlineText(xs: Inline[]): string {
  return xs.map((x) => (x.t === "text" ? x.v : x.t === "ref" ? x.label : x.t === "link" ? `${x.text} (${x.label})` : x.t === "tag" ? `(${x.label})` : x.t === "url" ? x.href : "or ")).join("").replace(/\s+/g, " ").trim();
}
function blocksText(blocks: Block[]): string[] {
  const out: string[] = [];
  const item = (it: Item, depth: number) => { out.push(`${"  ".repeat(depth)}• ${inlineText(it.inline)}`); it.children.forEach((c) => item(c, depth + 1)); };
  for (const b of blocks) {
    if (b.t === "lead" || b.t === "para") out.push(inlineText(b.inline));
    else if (b.t === "tier") out.push(`${b.label}:`);
    else if (b.t === "or") out.push("— or —");
    else b.items.forEach((it) => item(it, 0));
  }
  return out;
}

const KIND_WORD: Record<string, string> = {
  met: "criteria met", otherwise: "other arms ruled out", unknown: "needs details", uncoded: "condition not encoded (judgment)",
  option: "one of several options", inferred: "matches treatment received", flow: "",
};
/** The same markers in clinical words: only what a reader needs to act on. */
const KIND_PLAIN: Record<string, string> = { unknown: "needs more answers", uncoded: "clinical judgment needed", option: "one of several options" };

/** A one-page record of the route for a note or a case discussion: copy as text, or print. */
export function Summary({ p, onClose }: { p: Pathway; onClose: () => void }) {
  const { g, s, bundle, ai, ranking } = useApp();
  const adv = useAdvanced();
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const data = useMemo(() => {
    const schema = bundle.schema;
    const facts = derive(s.facts, schema);
    const entered = Object.entries(s.facts).filter(([k]) => !k.endsWith("_stated") || s.facts[k] === true)
      .map(([k, v]) => [label(k), factValue(k, v, schema)] as [string, string]);
    if (s.age !== null) entered.unshift(["Age", `${s.age} y`]);
    const worked = Object.entries(facts).filter(([k, v]) => schema.derived?.[k] && !(k in s.facts) && v !== null && v !== undefined && !k.includes("_or_") && !k.startsWith("gt5y"))
      .map(([k, v]) => [label(k), valueLabel(v)] as [string, string]);
    const f = routeFocus(g, p, ranking.paths);
    const rec = recommendationOf(g, p, ranking.paths);
    // who decided each step: the guideline rule, the AI (with its probability), or the clinician
    const decided = decisionByChosen(trimToRoute(ai.trail, new Set(p.steps.map((x) => x.node))));
    const aiSteps = [...decided.values()].filter((d) => d.by === "ai");
    const pl = (id: string) => (adv ? plain(g, id) : cleanText(g, id, plain(g, id)));   // clinicians see text without glued footnote marks
    const blocksOf = (id: string) => (adv ? g.parsed.get(id)?.blocks ?? [] : tidyBlocks(g, id, g.parsed.get(id)?.blocks ?? []));
    const page = (id: string) => {
      const n = g.node(id)!; const pdf = bundle.pages[n.page]?.pdf;
      return `${adv ? n.page : pageName(n.page, bundle.pages[n.page]?.title)}${pdf !== undefined && pdf !== null ? `${adv ? "" : ", NCCN page"}, PDF p.${pdf + 1}` : ""}`;
    };
    const steps = p.steps.map((st) => ({
      text: clip(pl(st.node), 220), where: page(st.node), kind: (adv ? KIND_WORD : KIND_PLAIN)[st.kind] ?? "",
      cond: g.preds[st.node] ? conditionText(g, st.node, facts) : "",
      by: decided.has(st.node) ? byTag(decided.get(st.node)!) : "",
      assumed: (decided.get(st.node)?.by === "ai" ? decided.get(st.node)!.assumed ?? [] : []).map(label),
    }));
    const aiUsed = ai.on ? `AI used: ${ai.model ?? "language model"}, threshold ${percent(ai.threshold)}${aiSteps.length ? `; it chose ${aiSteps.length} step${aiSteps.length === 1 ? "" : "s"} on this route (lowest ${percent(Math.min(...aiSteps.map((d) => d.prob ?? 1)))})` : "; it chose no step on this route"}. The model weighs only branches the guideline rules leave open.` : "";
    const options = rec.options.length > 1 ? rec.options.map((o) => clip(pl(o), 200)) : [];
    const thens = rec.then.slice(0, 3).map((id) => { const to = gotoPage(g, id); return to ? `continues on ${adv ? to : pageName(to, bundle.pages[to]?.title)}` : clip(pl(id), 160); });
    const goto = f.follow ? gotoPage(g, f.follow.node) : null;
    return {
      entered, worked, steps,
      reco: pl(f.key.node), recoLines: blocksText(blocksOf(f.key.node)), recoBlocks: blocksOf(f.key.node), recoWhere: page(f.key.node),
      then: thens.join(" → ") || (f.follow ? pl(f.follow.node) + (goto ? ` (continues on ${adv ? goto : pageName(goto, bundle.pages[goto]?.title)})` : "") : ""),
      options, aiUsed,
      next: p.end === "later" ? p.next.map((id) => clip(pl(id), 140)) : [],
      missing: p.missing.map(label),
      match: usedCount(p) === 0 ? "Possible starting point · Not based on your answers yet" : `${matchWord(p.likelihood)} · ${supportPhrase(p.missing.length)}`,
      scores: `${likelihoodWord(p.likelihood)} (${pct(p.likelihood)} of open routes) · patient data ${dataWord(p).toLowerCase()} (${p.met} of ${p.met + p.open} criteria) · extraction ${extractionWord(p).toLowerCase()} (${Math.round(p.encoding * 100)}%)`,
    };
  }, [g, s.facts, s.age, p, bundle, adv, ai.trail, ai.on, ai.model, ai.threshold, ranking]);

  const date = new Date().toISOString().slice(0, 10);
  const text = [
    `${bundle.title} — ${adv ? "route summary" : "recommendation summary"} (${date})`,
    "",
    adv ? "PATIENT DETAILS ENTERED" : "PATIENT DETAILS",
    ...(data.entered.length ? data.entered.map(([k, v]) => `- ${k}: ${v}`) : ["- none"]),
    ...(data.worked.length ? ["", adv ? "WORKED OUT FROM THE ENTRIES" : "WORKED OUT FROM THE DETAILS", ...data.worked.map(([k, v]) => `- ${k}: ${v}`)] : []),
    "",
    adv ? `RECOMMENDED AT THIS POINT [${data.recoWhere}]` : `RECOMMENDATION [${data.recoWhere}]`,
    ...(data.options.length ? ["The guideline lists these options at this step:", ...data.options.map((o) => `- ${o}`)] : data.recoLines),
    ...(data.then ? [`Then: ${data.then}`] : []),
    ...(adv ? ["", `FIT: ${data.scores}`] : [data.match]),
    ...(data.missing.length ? ["", adv ? `OPEN QUESTIONS: ${data.missing.join("; ")}` : `STILL UNKNOWN: ${data.missing.join("; ")}`] : []),
    ...(data.aiUsed ? ["", data.aiUsed] : []),
    ...(p.uncoded ? [adv ? `JUDGMENT CALLS: ${p.uncoded} step(s) without an encoded condition` : `${p.uncoded} step(s) rely on your clinical judgment`] : []),
    "",
    adv ? "ROUTE" : "HOW THE PATIENT GETS HERE",
    ...data.steps.map((st, i) => `${i + 1}. ${st.text} [${st.where}]${st.kind ? ` — ${st.kind}` : ""}${st.by ? ` (${st.by})` : ""}${st.assumed.length ? ` [assumed, not entered: ${st.assumed.join(", ")}]` : ""}${st.cond ? ` (${st.cond})` : ""}`),
    ...(data.next.length ? ["", "WHAT COMES NEXT DEPENDS ON", ...data.next.map((x) => `- ${x}`)] : []),
    "",
    T.prototype,
  ].join("\n");

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard blocked: the text is selectable in the dialog */ }
  };

  return createPortal(
    <div className="modal summary-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box summary-box" role="dialog" aria-modal="true" aria-labelledby="sum-h" tabIndex={-1} ref={box}>
        <div className="sum-bar no-print">
          <h2 id="sum-h">{adv ? "Route summary" : "Summary"}</h2>
          <span className="grow" />
          <button type="button" className="btn small" onClick={() => void copy()}><Copy size={13} /> {copied ? "Copied" : "Copy as text"}</button>
          <button type="button" className="btn small" onClick={() => window.print()}><Printer size={13} /> Print</button>
          <button type="button" className="ib" aria-label="Close summary" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="sum-doc print-area">
          <p className="sum-meta">{bundle.title} · {date}</p>
          <h3>{adv ? "Recommended at this point" : "Recommendation"}</h3>
          <div className="sum-reco">
            {data.options.length ? <><p>The guideline lists these options at this step:</p><ul>{data.options.map((o) => <li key={o}>{o}</li>)}</ul></> : <Blocks blocks={data.recoBlocks} />}
            <span className="sum-src">{data.recoWhere}</span>
          </div>
          {data.then && <p><b>Then:</b> {data.then}</p>}
          {adv ? <p className="sum-scores">{data.scores}</p> : <p className="sum-match">{data.match}</p>}
          {data.aiUsed && <p className="sum-match">{data.aiUsed}</p>}
          <h3>{adv ? "Patient details entered" : "Patient details"}</h3>
          <dl className="sum-dl">{data.entered.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {data.worked.length > 0 && <><h3>{adv ? "Worked out from the entries" : "Worked out from the details"}</h3><dl className="sum-dl">{data.worked.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></>}
          {(data.missing.length > 0 || p.uncoded > 0) && (
            <><h3>{adv ? "Open questions" : "Still unknown"}</h3><ul>
              {data.missing.map((m) => <li key={m}>{m}{adv ? " not entered" : ""}</li>)}
              {p.uncoded > 0 && <li>{adv ? `${p.uncoded} step${p.uncoded > 1 ? "s" : ""} without an encoded condition (clinician judgment)` : `${p.uncoded} step${p.uncoded > 1 ? "s rely" : " relies"} on your clinical judgment`}</li>}
            </ul></>
          )}
          <h3>{adv ? "Route" : "How the patient gets here"}</h3>
          <ol className="sum-route">
            {data.steps.map((st, i) => <li key={i}>{st.text} <span className="sum-src">{st.where}</span>{st.kind && <em> — {st.kind}</em>}{st.by && <em> ({st.by})</em>}{st.assumed.length > 0 && <em> [assumed, not entered: {st.assumed.join(", ")}]</em>}{st.cond && <div className="sum-cond">{st.cond}</div>}</li>)}
          </ol>
          {data.next.length > 0 && <><h3>What comes next depends on</h3><ul>{data.next.map((x) => <li key={x}>{x}</li>)}</ul></>}
          <p className="sum-fine">{T.prototype}</p>
        </div>
      </div>
    </div>, document.body);
}
