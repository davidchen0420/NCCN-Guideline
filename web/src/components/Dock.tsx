import { useEffect, useRef } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Asterisk } from "lucide-react";
import { useApp } from "../store";
import { Linked } from "./Rich";
import type { DockTab } from "../store";
import { SrcChip } from "../source";

const EVID: [string, string][] = [
  ["Category 1", "Based on high-level evidence, with uniform NCCN consensus that the intervention is appropriate."],
  ["Category 2A", "Based on lower-level evidence, with uniform NCCN consensus. This is the default for most recommendations."],
  ["Category 2B", "Based on lower-level evidence, with NCCN consensus that the intervention is appropriate."],
  ["Category 3", "Based on any level of evidence, with major NCCN disagreement that the intervention is appropriate."],
];
const PREF: [string, string, string][] = [
  ["Preferred", "pref", "Interventions favoured on superior efficacy, safety and evidence and, where relevant, affordability."],
  ["Other Recommended", "other", "Interventions that may be somewhat less effective, more toxic, or based on less mature data, or less affordable."],
  ["Useful In Certain Circumstances", "useful", "Interventions used for selected patient populations, as defined with the recommendation."],
];

export function Dock() {
  const { s, g, set, go } = useApp();
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.querySelector(".fn-item.on")?.scrollIntoView({ block: "nearest" }); }, [s.fn, s.dock]);
  const page = s.loc.kind === "flow" ? s.loc.page : null;
  const tabs: [DockTab, string][] = [["fn", "Footnotes"], ["E", "Evidence"], ["P", "Preference"]];

  const notes = new Map<string, { text: string; nodes: string[]; pdf?: number }>();
  if (page) for (const n of g.bundle.pages[page].nodes) for (const [l, t, pdf] of n.footnotes) {
    const e = notes.get(l) ?? { text: t, nodes: [], pdf: pdf ?? undefined };
    e.nodes.push(`${page}:${n.id}`);
    notes.set(l, e);
  }
  const sorted = [...notes.entries()].sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]));
  const step = (d: number) => {
    const inst = notes.get(s.fn ?? "")?.nodes ?? [];
    if (!inst.length || !page) return;
    const idx = (s.fnIdx + d + inst.length) % inst.length;
    set({ fnIdx: idx });
    go({ kind: "flow", page, node: inst[idx] });
  };

  return (
    <div className={`dock${s.dock ? " open" : ""}`}>
      <div className="dock-tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={s.dock === k} className={s.dock === k ? "on" : ""} title={label}
            onClick={() => set({ dock: s.dock === k ? null : k, sheet: false })}>
            {k === "fn" ? <Asterisk size={17} /> : k}<span className="sr">{label}</span>
          </button>
        ))}
        <span className="grow" />
        {s.dock && <button className="close" aria-label="Close panel" onClick={() => set({ dock: null })}><ChevronDown size={18} /></button>}
      </div>
      {s.dock && (
        <div className="dock-body" ref={bodyRef}>
          {s.dock === "E" && <><h3>Categories of evidence and consensus</h3><p className="note">Summaries in our own words; see the guideline for the official wording.</p>
            {EVID.map(([k, t]) => <div className="def" key={k}><span className="tag tag-cat">{k}</span><p>{t}</p></div>)}</>}
          {s.dock === "P" && <><h3>Categories of preference</h3><p className="note">Summaries in our own words; see the guideline for the official wording.</p>
            {PREF.map(([k, c, t]) => <div className="def" key={k}><span className={`tag tag-${c}`}>{k}</span><p>{t}</p></div>)}</>}
          {s.dock === "fn" && <>
            <h3>Footnotes{page ? ` · ${page}` : ""}</h3>
            {!sorted.length && <p className="note">{page ? "This page has no footnotes." : "Open an algorithm page to see its footnotes."}</p>}
            {sorted.map(([l, v]) => {
              const on = s.fn === l;
              return (
                <div key={l} className={`fn-item${on ? " on" : ""}`} onClick={() => !on && set({ fn: l, fnIdx: 0 })}>
                  <span className={`fb big${on ? " on" : ""}`}>{l}</span>
                  <div>
                    {on && v.nodes.length > 0 && (
                      <div className="inst">
                        <button aria-label="Previous instance" onClick={(e) => { e.stopPropagation(); step(-1); }}><ChevronLeft size={14} /></button>
                        <span>{s.fnIdx + 1} of {v.nodes.length} instance{v.nodes.length > 1 ? "s" : ""}</span>
                        <button aria-label="Next instance" onClick={(e) => { e.stopPropagation(); step(1); }}><ChevronRight size={14} /></button>
                      </div>
                    )}
                    <p><Linked text={v.text} />{v.pdf !== undefined && <> <SrcChip t={{ page: v.pdf, label: `Footnote ${l}`, excerpt: v.text }} text={`p.${v.pdf + 1}`} /></>}</p>
                  </div>
                </div>
              );
            })}
          </>}
        </div>
      )}
    </div>
  );
}
