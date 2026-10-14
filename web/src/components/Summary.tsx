import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Printer, X } from "lucide-react";
import { useApp } from "../store";
import type { Pathway } from "../lib/pathways";
import { likelihoodWord } from "../lib/pathways";
import { derive } from "../lib/predicates";
import { factValue, label, valueLabel } from "../lib/factMeta";
import type { Block, Inline, Item } from "../lib/parseBox";
import { Blocks } from "./Rich";
import { clip, conditionText, dataWord, extractionWord, gotoPage, pct, plain, routeFocus } from "./PathwaysPanel";

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

/** A one-page record of the route for a note or a case discussion: copy as text, or print. */
export function Summary({ p, onClose }: { p: Pathway; onClose: () => void }) {
  const { g, s, bundle } = useApp();
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
    const f = routeFocus(g, p);
    const page = (id: string) => { const n = g.node(id)!; const pdf = bundle.pages[n.page]?.pdf; return `${n.page}${pdf !== undefined && pdf !== null ? `, PDF p.${pdf + 1}` : ""}`; };
    const steps = p.steps.map((st) => ({
      text: clip(plain(g, st.node), 220), where: page(st.node), kind: KIND_WORD[st.kind],
      cond: g.preds[st.node] ? conditionText(g, st.node, facts) : "",
    }));
    const goto = f.follow ? gotoPage(g, f.follow.node) : null;
    return {
      entered, worked, steps,
      reco: plain(g, f.key.node), recoLines: blocksText(g.parsed.get(f.key.node)?.blocks ?? []), recoBlocks: g.parsed.get(f.key.node)?.blocks ?? [], recoWhere: page(f.key.node),
      then: f.follow ? plain(g, f.follow.node) + (goto ? ` (continues on ${goto})` : "") : "",
      next: p.end === "later" ? p.next.map((id) => clip(plain(g, id), 140)) : [],
      missing: p.missing.map(label),
      scores: `${likelihoodWord(p.likelihood)} (${pct(p.likelihood)} of open routes) · patient data ${dataWord(p).toLowerCase()} (${p.met} of ${p.met + p.open} criteria) · extraction ${extractionWord(p).toLowerCase()} (${Math.round(p.encoding * 100)}%)`,
    };
  }, [g, s.facts, s.age, p, bundle]);

  const date = new Date().toISOString().slice(0, 10);
  const text = [
    `${bundle.title} — route summary (${date})`,
    "",
    "PATIENT DETAILS ENTERED",
    ...(data.entered.length ? data.entered.map(([k, v]) => `- ${k}: ${v}`) : ["- none"]),
    ...(data.worked.length ? ["", "WORKED OUT FROM THE ENTRIES", ...data.worked.map(([k, v]) => `- ${k}: ${v}`)] : []),
    "",
    `RECOMMENDED AT THIS POINT [${data.recoWhere}]`,
    ...data.recoLines,
    ...(data.then ? [`Then: ${data.then}`] : []),
    "",
    `FIT: ${data.scores}`,
    ...(data.missing.length ? ["", `OPEN QUESTIONS: ${data.missing.join("; ")}`] : []),
    ...(p.uncoded ? [`JUDGMENT CALLS: ${p.uncoded} step(s) without an encoded condition`] : []),
    "",
    "ROUTE",
    ...data.steps.map((st, i) => `${i + 1}. ${st.text} [${st.where}]${st.kind ? ` — ${st.kind}` : ""}${st.cond ? ` (${st.cond})` : ""}`),
    ...(data.next.length ? ["", "WHAT COMES NEXT DEPENDS ON", ...data.next.map((x) => `- ${x}`)] : []),
    "",
    "Generated by an independent research prototype from an encoded copy of the guideline. Conditions were machine-drafted and are not clinician-reviewed; this is not a clinical recommendation. Verify every step against the source pages.",
  ].join("\n");

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard blocked: the text is selectable in the dialog */ }
  };

  return createPortal(
    <div className="modal summary-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box summary-box" role="dialog" aria-modal="true" aria-labelledby="sum-h" tabIndex={-1} ref={box}>
        <div className="sum-bar no-print">
          <h2 id="sum-h">Route summary</h2>
          <span className="grow" />
          <button type="button" className="btn small" onClick={() => void copy()}><Copy size={13} /> {copied ? "Copied" : "Copy as text"}</button>
          <button type="button" className="btn small" onClick={() => window.print()}><Printer size={13} /> Print</button>
          <button type="button" className="ib" aria-label="Close summary" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="sum-doc print-area">
          <p className="sum-meta">{bundle.title} · {date}</p>
          <h3>Recommended at this point</h3>
          <div className="sum-reco"><Blocks blocks={data.recoBlocks} /><span className="sum-src">{data.recoWhere}</span></div>
          {data.then && <p><b>Then:</b> {data.then}</p>}
          <p className="sum-scores">{data.scores}</p>
          <h3>Patient details entered</h3>
          <dl className="sum-dl">{data.entered.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {data.worked.length > 0 && <><h3>Worked out from the entries</h3><dl className="sum-dl">{data.worked.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></>}
          {(data.missing.length > 0 || p.uncoded > 0) && (
            <><h3>Open questions</h3><ul>
              {data.missing.map((m) => <li key={m}>{m} not entered</li>)}
              {p.uncoded > 0 && <li>{p.uncoded} step{p.uncoded > 1 ? "s" : ""} without an encoded condition (clinician judgment)</li>}
            </ul></>
          )}
          <h3>Route</h3>
          <ol className="sum-route">
            {data.steps.map((st, i) => <li key={i}>{st.text} <span className="sum-src">{st.where}</span>{st.kind && <em> — {st.kind}</em>}{st.cond && <div className="sum-cond">{st.cond}</div>}</li>)}
          </ol>
          {data.next.length > 0 && <><h3>What comes next depends on</h3><ul>{data.next.map((x) => <li key={x}>{x}</li>)}</ul></>}
          <p className="sum-fine">Generated by an independent research prototype from an encoded copy of the guideline. Conditions were machine-drafted and are not clinician-reviewed; this is not a clinical recommendation. Verify every step against the source pages.</p>
        </div>
      </div>
    </div>, document.body);
}
