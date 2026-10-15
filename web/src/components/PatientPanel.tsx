import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp, useAdvanced } from "../store";
import type { Facts, Schema, VarSpec } from "../types";
import { derive } from "../lib/predicates";
import { GROUPS, factValue, filledCount, formatNumber, groupOf, label, meta, numberText, parseNumber, unitLabel, valueLabel } from "../lib/factMeta";
import { contradictions, decidingFacts, plausibility, previewAnswer, previewValues, type Decider, type Preview } from "../lib/formAssist";
import { applyFound, extractFacts, type Found } from "../lib/extract";
import type { Graph } from "../lib/graph";
import type { Ranking } from "../lib/pathways";
import { resolveRef } from "../lib/graph";
import { SrcChip } from "../source";
import { PHASES, followsDisease, moments, momentsFor, reachableFacts, startPhase } from "../lib/moments";
import { T, countRecs, pageName } from "../lib/terms";
import { readPref, writePref } from "../lib/prefs";
import { ArrowRight, ChevronDown, ClipboardPaste, RotateCcw, Save, Search as SearchIcon, Trash2, X } from "lucide-react";
import "../styles/patient.css";

/** A page shown title first with its code after: "Low-Risk Group (PROS-3)". */
function usePageName() {
  const { g } = useApp();
  return useCallback((code: string) => {
    const t = g.bundle.pages[code]?.title;
    return { title: t && t !== code ? t : "", code };
  }, [g]);
}

/** Where an answer leads, in words: the page it reaches (title first), nothing yet, or no match. */
function Leads({ p }: { p: Preview }) {
  const name = usePageName();
  const advanced = useAdvanced();
  if (p.routes === 0) return <span className="pv-none">{T.noneFits}</span>;
  if (p.decides) {
    const n = name(p.decides.page);
    return <span className="pv-to">Leads to: <span className="pv-page">{n.title ? <>{n.title} <i>({n.code})</i></> : n.code}</span></span>;
  }
  return <span className="pv-open">{T.noChangeYet}{advanced && ` · ${p.routes} ${p.routes === 1 ? T.recommendation : T.recommendations} open`}</span>;
}

/** "Decides: Page title (PROS-5)"; Advanced also shows the box text and how much of the fit it is open on. */
function Decides({ why, onPage }: { why: Decider; onPage?: (page: string) => void }) {
  const name = usePageName();
  const advanced = useAdvanced();
  if (!why.node) return null;
  const n = name(why.page);
  return (
    <p className="decides">
      Changes the recommendation at: <button type="button" className="decides-page" onClick={() => onPage?.(why.page)} title="Show this page">
        {n.title ? <><span className="dp-title">{n.title}</span> <span className="dp-code">({n.code})</span></> : <span className="dp-title">{n.code}</span>}
      </button>
      {advanced && why.text && <> <q>{why.text}</q></>}
      {advanced && why.share < 1 && why.share > 0 && <span className="decides-share"> · open on {Math.round(why.share * 100)}% of the fit</span>}
    </p>
  );
}

/** Enum options that fit on one row as buttons; longer lists use a menu. */
const asButtons = (values: string[]) => values.length <= 6 && values.map(valueLabel).join("").length <= 44;

function Segmented({ id, name, values, value, onChange }: { id: string; name: string; values: (string | boolean)[]; value: unknown; onChange: (v: unknown) => void }) {
  return (
    <div className="seg-row" role="radiogroup" aria-labelledby={`${id}-l`} id={id}
      onKeyDown={(e) => {
        // number keys pick a choice: 1 is the first
        if (/^[1-9]$/.test(e.key) && Number(e.key) <= values.length) {
          const n = values[Number(e.key) - 1];
          onChange(n); e.preventDefault();
          (e.currentTarget.querySelectorAll("button")[Number(e.key) - 1] as HTMLButtonElement)?.focus();
          return;
        }
        if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
        const i = values.indexOf(value as string | boolean);
        const n = values[(i + (e.key === "ArrowRight" ? 1 : -1) + values.length) % values.length];
        onChange(n); e.preventDefault();
        (e.currentTarget.querySelectorAll("button")[values.indexOf(n)] as HTMLButtonElement)?.focus();
      }}>
      {values.map((v, i) => {
        const on = value === v;
        return (
          <button key={String(v)} type="button" role="radio" aria-checked={on} tabIndex={on || (value === undefined && i === 0) ? 0 : -1}
            title={on ? "Click again to clear" : i < 9 ? `Key ${i + 1}` : undefined} onClick={() => onChange(on ? undefined : v)}>
            {valueLabel(v)}
          </button>
        );
      })}
      <span className="sr">{name}</span>
    </div>
  );
}

function NumberInput({ id, value, unit, onChange }: { id: string; value: unknown; unit?: string; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(numberText(value));
  const [err, setErr] = useState(false);
  useEffect(() => { setText(numberText(value)); setErr(false); }, [value]);
  const commit = (t: string) => {
    const v = parseNumber(t);
    if (v === null) { setErr(true); return; }
    setErr(false);
    onChange(v);
  };
  return (
    <>
      <div className={`num${err ? " bad" : ""}`}>
        <input id={id} inputMode="decimal" value={text} placeholder="—" aria-invalid={err} aria-describedby={err ? `${id}-err` : undefined}
          onChange={(e) => { setText(e.target.value); if (parseNumber(e.target.value) !== null) commit(e.target.value); }}
          onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }} />
        {unitLabel(unit) && <span className="unit">{unitLabel(unit)}</span>}
      </div>
      {err && <span className="err" id={`${id}-err`}>Use a number, a bound such as &gt;10, or a range such as 5-10.</span>}
    </>
  );
}

interface FieldProps {
  name: string; spec: VarSpec; value: unknown; onChange: (v: unknown) => void; needed: boolean; used: boolean;
  /** the branch this detail decides (deciding details only) */
  why?: Decider | null;
  /** where each answer leads (deciding details only) */
  previews?: Preview[] | null;
  /** shown dimmed: changes none of the routes that are open */
  quiet?: boolean;
  onPage?: (page: string) => void;
  /** label current-state details "now" (the patient is past diagnosis) */
  now?: boolean;
  /** carried over from diagnosis: confirm or clear */
  stale?: { keep: () => void; clear: () => void } | null;
}

function Field({ name, spec, value, onChange, needed, used, why, previews, quiet, onPage, now, stale }: FieldProps) {
  const id = `fact-${name}`;
  const m = meta(name);
  const values = spec.type === "bool" ? [true, false] : spec.values ?? [];
  const check = value !== undefined ? plausibility(name, spec, value) : null;
  return (
    <div className={`pf${needed ? " needed" : ""}${value !== undefined ? " set" : ""}${quiet ? " quiet" : ""}${why ? " decider" : ""}${stale ? " stale" : ""}`}>
      <label id={`${id}-l`} htmlFor={id} className="flabel">
        <span>{m.label}{spec.time && spec.time !== "current" ? <em className="time-tag">{spec.time === "at_diagnosis" ? "at diagnosis" : "history"}</em> : now && <em className="time-tag now">now</em>}{spec.judgment && <em className="time-tag">{T.judgmentShort}</em>}</span>
        {needed && !why && <span className="need-tag">helps narrow the recommendation</span>}
        {!needed && used && value === undefined && <span className="sr">used by the recommendations shown</span>}
      </label>
      {why && why.node && <Decides why={why} onPage={onPage} />}
      {spec.type === "number" ? <NumberInput id={id} value={value} unit={spec.unit} onChange={onChange} />
        : asButtons(values.map(String)) || spec.type === "bool"
          ? <Segmented id={id} name={m.label} values={values} value={value} onChange={onChange} />
          : (
            <select id={id} className="sel" value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value || undefined)}>
              <option value="">Not known</option>
              {values.map((v) => <option key={String(v)} value={String(v)}>{valueLabel(v)}</option>)}
            </select>
          )}
      {stale && (
        <div className="stale-row">
          <span>As of diagnosis: still true?</span>
          <button type="button" className="btn keep" onClick={stale.keep}>Still true</button>
          <button type="button" className="btn" onClick={stale.clear}>Clear</button>
        </div>
      )}
      {check && <span className={`check ${check.level}`} role={check.level === "error" ? "alert" : "status"}>{check.message}</span>}
      {m.hint && <span className="hint">{m.hint}</span>}
      {previews && previews.length > 0 && value === undefined && <Previews previews={previews} onPick={onChange} />}
    </div>
  );
}

/** Where each answer leads: the page its branch reaches on the best-matching recommendation. */
function Previews({ previews, onPick }: { previews: Preview[]; onPick: (v: unknown) => void }) {
  const same = previews.every((p) => p.decides?.node === previews[0].decides?.node && p.routes === previews[0].routes);
  if (same) return null;
  return (
    <ul className="previews" aria-label="Where each answer leads">
      {previews.map((p) => (
        <li key={String(p.value)}>
          <button type="button" onClick={() => onPick(p.value)} title="Choose this answer">
            <b>{valueLabel(p.value)}</b><ArrowRight size={12} aria-hidden />
            <Leads p={p} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** PROS-A: adjust a life-table estimate by the clinician's view of overall health. */
function LifeExpectancyHelper({ age, onApply }: { age: number | null; onApply: (years: number) => void }) {
  const { g } = useApp();
  const [base, setBase] = useState("");
  const [q, setQ] = useState<"best" | "middle" | "worst">("middle");
  const b = Number(base);
  const est = base && b > 0 ? b * (q === "best" ? 1.5 : q === "worst" ? 0.5 : 1) : null;
  const principles = resolveRef(g, "PROS-A").type === "doc" ? g.bundle.docs["PROS-A"] : null;
  return (
    <details className="helper">
      <summary>Estimate from a life table</summary>
      <div className="helper-body">
        <p>Look up the table value for {age ? `a ${age}-year-old` : "the patient's age"} (for example the{" "}
          <a href="https://www.ssa.gov/OACT/STATS/table4c6.html" target="_blank" rel="noopener noreferrer">Social Security period life table</a>), then adjust for overall health.</p>
        <div className="row">
          <label htmlFor="le-base">Table value</label>
          <div className="num small"><input id="le-base" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} placeholder="—" /><span className="unit">y</span></div>
        </div>
        <div className="row">
          <span id="le-q">Health</span>
          <div className="seg-row" role="radiogroup" aria-labelledby="le-q">
            {([["best", "Best quartile +50%"], ["middle", "Middle"], ["worst", "Worst quartile −50%"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={q === k} onClick={() => setQ(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="row end">
          <span>{est ? <>Estimate <b>{+est.toFixed(1)} y</b></> : "Enter the table value"}</span>
          <button type="button" className="btn" disabled={!est} onClick={() => est && onApply(+est.toFixed(1))}>Use estimate</button>
        </div>
        {principles && principles.pages[0].pdf !== undefined && (
          <p className="src-line">Adjustment rule from <SrcChip t={{ page: principles.pages[0].pdf!, label: "PROS-A", excerpt: principles.pages[0].text.slice(0, 900) }} text="Principles of life expectancy estimation (PROS-A)" /></p>
        )}
      </div>
    </details>
  );
}

/* ---------------- previews, computed a few at a time so typing stays smooth ---------------- */

function usePreviews(g: Graph, facts: Facts, deciders: Decider[], ranking: Ranking): Map<string, Preview[]> {
  const [out, setOut] = useState<Map<string, Preview[]>>(new Map());
  const cache = useRef(new Map<string, Preview>());
  useEffect(() => {
    const vars = g.bundle.schema.variables;
    const fkey = JSON.stringify(facts);
    const jobs = deciders.flatMap((d) => previewValues(vars[d.fact]).map((v) => ({ fact: d.fact, v })));
    const result = new Map<string, Preview[]>();
    const flush = () => setOut(new Map(result));
    let i = 0, off = false;
    const step = () => {
      if (off) return;
      const t0 = performance.now();
      while (i < jobs.length && performance.now() - t0 < 12) {
        const { fact, v } = jobs[i++];
        const key = `${fkey}|${fact}|${JSON.stringify(v)}`;
        let p = cache.current.get(key);
        if (!p) { p = previewAnswer(g, facts, fact, v, ranking); cache.current.set(key, p); }
        result.set(fact, [...(result.get(fact) ?? []), p]);
      }
      flush();
      if (i < jobs.length) window.setTimeout(step, 0);
    };
    if (cache.current.size > 2000) cache.current.clear();
    const t = window.setTimeout(step, 30);
    return () => { off = true; window.clearTimeout(t); };
  }, [g, facts, deciders, ranking]);
  return out;
}

/* ---------------- saved patients ---------------- */

interface Saved { id: string; name: string; facts: Facts; age: number | null; at: string }
const savedKey = (slug: string) => `oc-saved:${slug}`;
function readSaved(slug: string): Saved[] { try { return JSON.parse(readPref(savedKey(slug)) ?? "[]"); } catch { return []; } }
function writeSaved(slug: string, list: Saved[]) { writePref(savedKey(slug), JSON.stringify(list)); }

/* ---------------- the form ---------------- */

type Mode = "form" | "interview";
const MODE_KEY = "oc-form-mode";

export function PatientPanel() {
  const { s, g, bundle, set, setFacts, ranking, go, focusFact, slug } = useApp();
  const advanced = useAdvanced();
  const schema = bundle.schema;
  const vars = schema.variables;
  // the moment the patient is at: past a diagnosis, the form leads with the current situation
  const phase = useMemo(() => startPhase(g, s.start), [g, s.start]);
  const past = phase !== null && phase !== "diagnosis";
  const scope = useMemo(() => (s.start !== "auto" && g.bundle.pages[s.start] ? reachableFacts(g, [s.start]) : null), [g, s.start]);
  const [showAll, setShowAll] = useState(false);
  const staleSet = useMemo(() => new Set(s.stale), [s.stale]);
  const inScope = useCallback((n: string) => !scope || showAll || scope.has(n) || s.facts[n] !== undefined, [scope, showAll, s.facts]);
  const scoped = scope ? Object.keys(vars).filter((n) => scope.has(n) || s.facts[n] !== undefined).length : 0;
  // held (carried-over) details are left out until confirmed, as in the ranking
  const derived = useMemo(() => {
    const f = { ...s.facts };
    for (const k of s.stale) delete f[k];
    return derive(f, schema);
  }, [s.facts, s.stale, schema]);
  // a first visit answers one question at a time; the choice is remembered once made
  const [mode, setMode] = useState<Mode>(() => (readPref(MODE_KEY) === "form" ? "form" : "interview"));
  const setModeKeep = (m: Mode) => { setMode(m); writePref(MODE_KEY, m); };
  useEffect(() => {
    // a jump to a field ("add PSA") needs the full form (just this time: the choice is not changed)
    const f = () => setMode("form");
    window.addEventListener("oc-focus-fact", f);
    return () => window.removeEventListener("oc-focus-fact", f);
  }, []);

  const top = ranking.paths.slice(0, 3);
  const needed = useMemo(() => new Set(top.flatMap((p) => p.missing)), [top]);
  const used = useMemo(() => new Set(ranking.paths.flatMap((p) => p.steps.flatMap((st) => st.missing))), [ranking]);

  const set1 = useCallback((name: string, v: unknown) => {
    const f: Facts = { ...s.facts };
    if (v === undefined || v === "" || v === null) delete f[name]; else f[name] = v;
    setFacts(f);
    set({ pathSel: null });
  }, [s.facts, setFacts, set]);

  const sectionVar = bundle.sections?.variable && vars[bundle.sections.variable] ? bundle.sections.variable : null;
  const needDisease = sectionVar !== null && s.facts[sectionVar] === undefined;
  const deciders = useMemo(() => decidingFacts(g, ranking, s.facts).filter((d) => d.fact !== sectionVar && vars[d.fact] && !staleSet.has(d.fact) && inScope(d.fact)), [g, ranking, s.facts, sectionVar, vars, staleSet, inScope]);
  // a question whose answer only restates the chosen subtype (a histology list that holds the
  // subtype itself) is answered for it, so it is not asked; it shows in "Entered so far" and can be cleared
  const secValue = sectionVar ? s.facts[sectionVar] : undefined;
  const autoSet = useRef<Record<string, unknown>>({});
  const autoFor = useRef<unknown>(undefined);
  useEffect(() => {
    if (!sectionVar) return;
    if (autoFor.current !== secValue) {
      // the subtype changed: take back what was filled in for the previous one
      const f: Facts = { ...s.facts };
      let changed = false;
      for (const [k, v] of Object.entries(autoSet.current)) if (JSON.stringify(f[k]) === JSON.stringify(v)) { delete f[k]; changed = true; }
      autoSet.current = {}; autoFor.current = secValue;
      if (changed) { setFacts(f); return; }
    }
    if (secValue === undefined) return;
    const norm = (x: unknown) => String(x).toLowerCase().replace(/[^a-z0-9]/g, "");
    const f: Facts = { ...s.facts };
    let changed = false;
    for (const d of deciders) {
      const spec = vars[d.fact];
      if (spec.type !== "enum" || d.fact in autoSet.current) continue;
      const hit = (spec.values ?? []).find((v) => norm(v) === norm(secValue));
      if (hit !== undefined) { f[d.fact] = hit; autoSet.current[d.fact] = hit; changed = true; }
    }
    if (changed) setFacts(f);
  }, [sectionVar, secValue, deciders, s.facts, vars, setFacts]);
  const previews = usePreviews(g, s.facts, deciders, ranking);
  const conflicts = useMemo(() => contradictions(s.facts, schema), [s.facts, schema]);
  const deciderSet = useMemo(() => new Set(deciders.map((d) => d.fact)), [deciders]);
  const onPage = useCallback((page: string) => go({ kind: "flow", page }), [go]);

  const [find, setFind] = useState("");
  const term = find.trim().toLowerCase();
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    Object.keys(vars).filter((n) => n !== sectionVar && !deciderSet.has(n) && !staleSet.has(n) && (groupOf(n) === "stated" || inScope(n)))
      .filter((n) => !term || `${label(n)} ${n} ${vars[n].definition ?? ""}`.toLowerCase().includes(term))
      .forEach((n) => { const k = groupOf(n); m.set(k, [...(m.get(k) ?? []), n]); });
    if (past && !term) {
      // past diagnosis: what is true now, what has been done, and (rarely needed) how it began
      const order = (n: string) => GROUPS.findIndex((gr) => gr.key === groupOf(n));
      const names = [...m.entries()].filter(([k]) => k !== "stated").flatMap(([, v]) => v).sort((a, b) => order(a) - order(b));
      const when = (n: string) => vars[n].time ?? "current";
      const stated = m.get("stated");
      return [
        { key: "now", title: "Current situation", match: /$^/, names: names.filter((n) => when(n) === "current") },
        { key: "hx", title: "Treatment so far", match: /$^/, names: names.filter((n) => when(n) === "history") },
        { key: "dx", title: "Original diagnosis", match: /$^/, names: names.filter((n) => when(n) === "at_diagnosis"), collapsed: true },
        ...(stated ? [{ key: "stated", title: "", match: /$^/, names: stated }] : []),
      ].filter((x) => x.names.length);
    }
    const other = m.get("other") ?? [];
    if (other.length > 6) {
      m.delete("other");
      const byTime: [string, string, (n: string) => boolean][] = [
        ["now", "Current situation", (n) => !vars[n].time || vars[n].time === "current"],
        ["dx", "At diagnosis", (n) => vars[n].time === "at_diagnosis"],
        ["hx", "History", (n) => vars[n].time === "history"],
      ];
      const extra = byTime.map(([key, title, f]) => ({ key, title, match: /$^/, names: other.filter(f) })).filter((x) => x.names.length);
      return [...GROUPS.filter((gr) => m.has(gr.key)).map((gr) => ({ ...gr, names: m.get(gr.key)! })), ...extra];
    }
    return GROUPS.filter((gr) => m.has(gr.key)).map((gr) => ({ ...gr, names: m.get(gr.key)! }));
  }, [vars, sectionVar, term, deciderSet, staleSet, inScope, past]);
  const hasLE = Object.keys(vars).some((n) => n.startsWith("life_expectancy"));

  const statedOk = Object.entries(schema.derived ?? {}).filter(([, d]) => d.type === "enum" && !d.rules.some((r) => JSON.stringify(r.if).includes("_stated")));
  const computed = Object.entries(derived).filter(([k, v]) => schema.derived?.[k] && !(k in s.facts) && v !== undefined && v !== null && !k.startsWith("gt5y") && !k.includes("_or_"));
  const filled = filledCount(s.facts, schema);
  const examples = bundle.examples ?? [];
  const anyFacts = filled > 0;
  const moreCount = groups.reduce((n, gr) => n + (gr.key === "stated" ? 0 : gr.names.length), 0);
  const [moreOpen, setMoreOpen] = useState(false);
  const startTitle = g.bundle.pages[s.start]?.title;

  if (!Object.keys(vars).length) return <p className="note">This guideline has no patient questions, so nothing you enter can change the recommendation.</p>;
  const field = (n: string, extra: Partial<FieldProps> = {}) => (
    <div key={n}>
      <Field name={n} spec={vars[n]} value={s.facts[n]} onChange={(v) => set1(n, v)} needed={needed.has(n) && s.facts[n] === undefined} used={used.has(n)} onPage={onPage} now={past} {...extra} />
      {n === "life_expectancy_years" && <LifeExpectancyHelper age={s.age} onApply={(y) => set1(n, y)} />}
    </div>
  );
  const diseasePicker = sectionVar && (
    <>
      <Field name={sectionVar} spec={{ ...vars[sectionVar], definition: undefined }} value={s.facts[sectionVar]} onChange={(v) => set1(sectionVar, v)} needed={needed.has(sectionVar) && s.facts[sectionVar] === undefined} used={used.has(sectionVar)} />
      <p className="hint">This guideline covers {bundle.sections!.values.length} diseases or subtypes. Choose the one that applies: each has its own recommendations.</p>
    </>
  );

  return (
    <div className="patient">
      <Summary filled={filled} slug={slug ?? bundle.title} examples={examples} focus={focusFact} />
      {conflicts.length > 0 && (
        <div className="conflicts" role="status">
          {conflicts.map((c, i) => (
            <p key={i}>{c.message} {c.facts.filter((f) => advanced || vars[f]).map((f) => <button key={f} type="button" className="linkish" onClick={() => focusFact(f)}>{label(f)}</button>)}</p>
          ))}
        </div>
      )}

      <WhereNow count={scoped} disease={diseasePicker || null} />
      {s.stale.length > 0 && (
        <fieldset className="fgroup carried" data-testid="carried">
          <legend>Carried over from diagnosis<em>{s.stale.length}</em></legend>
          <p className="note">These described the patient at diagnosis and may have changed. They do not affect the recommendation until you confirm or update them.</p>
          {s.stale.filter((k) => vars[k]).map((k) => field(k, { now: false, stale: { keep: () => set({ stale: s.stale.filter((x) => x !== k) }), clear: () => set1(k, undefined) } }))}
          <button type="button" className="btn" onClick={() => set({ stale: [] })}>All still true</button>
        </fieldset>
      )}

      <fieldset className="fgroup deciders" aria-describedby="dec-note">
        <legend>{anyFacts ? T.questions : T.questionsFirst}{mode === "form" && !needDisease && <em>{deciders.length}</em>}</legend>
        {needDisease ? (
          <p className="note" id="dec-note">Choose the disease or subtype above to see the questions.</p>
        ) : (<>
          <div className="mode-switch" role="group" aria-label="How to answer">
            {mode === "interview"
              ? <button type="button" onClick={() => setModeKeep("form")} data-testid="mode-form">See all questions as a form</button>
              : <button type="button" onClick={() => setModeKeep("interview")} data-testid="mode-interview">One question at a time</button>}
          </div>
          {mode === "interview" ? (
            <Interview deciders={deciders} previews={previews} subtype={typeof secValue === "string" ? secValue : undefined} answer={set1} onPage={onPage} routes={ranking.paths.length} toPaths={() => set({ rightTab: "paths" })} />
          ) : (<>
            <p className="note" id="dec-note">{anyFacts
              ? "Answering any of these can change the recommendation. Under each choice you can see where it leads."
              : "These decide the first steps. Enter what the note says; leave the rest blank."}</p>
            {deciders.length === 0 && <p className="note">{anyFacts ? "Nothing still open changes the recommendation: it is settled by what you entered." : "No questions decide the first steps here; open More questions below."}</p>}
            {deciders.map((d) => field(d.fact, { why: d, previews: previews.get(d.fact) ?? null }))}
          </>)}
        </>)}
      </fieldset>

      <PasteRecord schema={schema} />

      {mode === "form" && (<>
        {computed.length > 0 && (
          <section className="computed" aria-label="Worked out from your answers">
            <h4>Worked out from your answers</h4>
            <dl>
              {computed.map(([k, v]) => (
                <div key={k}>
                  <dt>{label(k)}</dt>
                  <dd>{schema.variables[k]?.type === "number" ? formatNumber(v) : valueLabel(v)}</dd>
                  {advanced && statedOk.some(([n]) => n === k) && <button type="button" className="linkish ovr" onClick={() => { setMoreOpen(true); window.setTimeout(() => focusFact(k), 30); }}>override</button>}
                </div>
              ))}
            </dl>
            <p className="hint">{advanced
              ? "Computed with the guideline's own rules. If the record states a different classification, override it under “Stated in the record”."
              : "Worked out from your answers with the guideline's own definitions."}</p>
          </section>
        )}

        <details className="fgroup more-details" open={moreOpen || !!term} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
          <summary>More questions<em>{moreCount}</em></summary>
          {Object.keys(vars).length > 20 && (
            <div className="field find-fact">
              <SearchIcon size={14} aria-hidden />
              <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Find one of ${Object.keys(vars).length} questions`} aria-label="Find a question" />
            </div>
          )}
          {scope && Object.keys(vars).length > scoped && (
            <p className="note scope-note">{showAll ? `Showing all ${Object.keys(vars).length} questions.` : `Showing the ${scoped} questions that matter from ${pageName(s.start, startTitle && startTitle !== s.start ? clipT(startTitle, 50) : null)}.`}{" "}
              <button type="button" className="linkish" onClick={() => setShowAll((v) => !v)} data-testid="show-all">{showAll ? "Only those that matter from here" : "Show all questions"}</button></p>
          )}
          {anyFacts && <p className="note">Dimmed questions don't change any recommendation that is still possible.</p>}
          {groups.map((gr) => {
            if (gr.key === "stated") return null;
            const legend = <>{gr.title}<em>{gr.names.filter((n) => s.facts[n] !== undefined).length}/{gr.names.length}</em></>;
            const body = (<>
                {(gr.key === "patient" || gr.key === "now") && !vars.age && hasLE && !term && (
                  <div className="pf">
                    <label htmlFor="patient-age" className="flabel"><span>Age</span></label>
                    <NumberInput id="patient-age" value={s.age ?? undefined} unit="years" onChange={(v) => set({ age: typeof v === "number" ? v : null })} />
                    <span className="hint">Used only to help estimate life expectancy.</span>
                  </div>
                )}
                {gr.names.map((n) => field(n, { quiet: anyFacts && !used.has(n) && s.facts[n] === undefined }))}
            </>);
            return "collapsed" in gr && gr.collapsed ? (
              <details key={gr.key} className="fgroup dx-group">
                <summary>{legend}</summary>
                <p className="note">Recorded when the disease was first diagnosed. Few recommendations after diagnosis depend on them.</p>
                {body}
              </details>
            ) : <fieldset key={gr.key} className="fgroup"><legend>{legend}</legend>{body}</fieldset>;
          })}
          {advanced && (
            <details className="fgroup more">
              <summary>Stated in the record</summary>
              <p className="note">Use these when the record states a classification (for example “low-risk”) without the details behind it. A stated value replaces the computed one.</p>
              {groups.find((gr) => gr.key === "stated")?.names.map((n) => field(n))}
              {statedOk.map(([n, d]) => {
                const values = [...new Set([...d.rules.map((r) => String(r.then)), ...(d.else !== undefined && d.else !== null ? [String(d.else)] : [])])];
                return <Field key={n} name={n} spec={{ type: "enum", values }} value={s.facts[n]} onChange={(v) => set1(n, v)} needed={false} used={used.has(n)} />;
              })}
            </details>
          )}
        </details>
      </>)}
    </div>
  );
}

/* ---------------- where the patient is now ---------------- */

const clipT = (t: string, n = 56) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);

/** The moment the patient is at: a new diagnosis, follow-up, recurrence, advanced disease or a
 * later line. It starts the algorithm at that moment's page and limits the form to its details.
 * In a guideline that covers several diseases, the disease or subtype is chosen here too, and the
 * moments offered are that subtype's. When a phase has several pages, they are listed by title. */
function WhereNow({ count, disease }: { count: number; disease: ReactNode }) {
  const { s, g, setStart } = useApp();
  const advanced = useAdvanced();
  const all = useMemo(() => moments(g), [g]);
  const list = useMemo(() => momentsFor(g, all, s.facts), [g, all, s.facts]);
  const sec = g.bundle.sections;
  const secVal = sec ? s.facts[sec.variable] : undefined;
  // a start page left over from another disease or subtype would leave nothing that fits
  useEffect(() => {
    if (s.start === "auto" || !sec || secVal === undefined) return;
    const owner = sec.pages[s.start];
    if (owner && owner !== secVal) setStart("auto");
  }, [s.start, sec, secVal, setStart]);
  const follows = followsDisease(g.bundle.title);
  const present = PHASES.filter((p) => list.some((m) => m.phase === p.id));
  // chips need two moments to choose between; a chosen subtype with one moment just says where it starts
  const chips = follows && present.length >= 2;
  const extra = follows && !chips && secVal !== undefined && list.length > 0;
  const phase = startPhase(g, s.start);
  const isMoment = list.some((m) => m.page === s.start);
  const pages = chips ? (phase && isMoment ? list.filter((m) => m.phase === phase) : []) : extra ? list : [];
  const only = extra && list.length === 1 ? list[0] : null;
  if (!disease && !chips && !only && pages.length < 2) return null;
  const nameOf = (page: string, max = 70) => { const t = g.bundle.pages[page]?.title ?? ""; return pageName(page, t && t !== page ? clipT(t, max) : null); };
  return (
    <fieldset className="fgroup moment" data-testid="moment">
      <legend>Where is the patient now?</legend>
      {disease}
      {disease && chips && <p className="pt-sublabel" id="moment-l">Point in the patient's care</p>}
      {chips && (
        <div className="moment-chips" role="group" aria-label={disease ? undefined : "Where is the patient now?"} aria-labelledby={disease ? "moment-l" : undefined}>
          <button type="button" aria-pressed={s.start === "auto"} onClick={() => setStart("auto")} title="Let your answers decide where the recommendation starts">Not sure</button>
          {present.map((p) => (
            <button key={p.id} type="button" aria-pressed={isMoment && phase === p.id} title={p.hint}
              onClick={() => { if (!(isMoment && phase === p.id)) setStart(list.find((m) => m.phase === p.id)!.page); }}>{p.label}</button>
          ))}
        </div>
      )}
      {pages.length > 1 && (advanced ? (
        <select className="sel small" aria-label="Which page" value={pages.some((m) => m.page === s.start) ? s.start : ""} onChange={(e) => e.target.value && setStart(e.target.value)}>
          {!pages.some((m) => m.page === s.start) && <option value="">Choose a page…</option>}
          {pages.map((m) => <option key={m.page} value={m.page}>{pageName(m.page, clipT(m.title))}</option>)}
        </select>
      ) : (<>
        <p className="pt-sublabel" id="sit-l">Which situation?</p>
        <div className="situations" role="radiogroup" aria-labelledby="sit-l" data-testid="situations">
          {pages.map((m) => (
            <button key={m.page} type="button" role="radio" aria-checked={s.start === m.page} onClick={() => setStart(m.page)}>
              <span>{m.title}</span> <i>({m.page})</i>
            </button>
          ))}
        </div>
      </>))}
      {(chips || pages.length > 1 || only) && (
        <p className="hint">{only
          ? <>Starting at <b>{nameOf(only.page)}</b>.</>
          : s.start === "auto"
            ? `Your answers decide where the recommendation starts. Pick ${chips ? "a moment" : "a situation"} to see only the questions that matter then.`
            : <>Starting at <b>{nameOf(s.start)}</b>. {count} {count === 1 ? "question applies" : "questions apply"} from here.</>}</p>
      )}
    </fieldset>
  );
}

/* ---------------- top bar, the More menu, saved patients ---------------- */

function Summary({ filled, slug, examples, focus }: { filled: number; slug: string; examples: { id: string; label: string; facts: Facts; age?: number }[]; focus: (f: string) => void }) {
  const { s, set, setFacts, bundle } = useApp();
  const schema = bundle.schema;
  const [saved, setSaved] = useState<Saved[]>(() => readSaved(slug));
  const [naming, setNaming] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const f = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); btnRef.current?.focus(); } };
    document.addEventListener("mousedown", f); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", f); document.removeEventListener("keydown", k); };
  }, [menu]);
  const chips = Object.keys(s.facts).filter((k) => s.facts[k] !== undefined && (schema.variables[k] || schema.derived?.[k]));
  const clear1 = (k: string) => { const f = { ...s.facts }; delete f[k]; setFacts(f); set({ pathSel: null }); };
  const save = (name: string) => {
    const list = [{ id: String(Date.now()), name: name.trim() || `Patient ${saved.length + 1}`, facts: s.facts, age: s.age, at: new Date().toISOString() }, ...saved].slice(0, 30);
    setSaved(list); writeSaved(slug, list); setNaming(null);
  };
  const load = (p: { facts: Facts; age?: number | null }) => { setFacts({ ...p.facts }); set({ age: p.age ?? null, pathSel: null, start: "auto", stale: [] }); setMenu(false); };
  const startOver = () => { setFacts({}); set({ age: null, pathSel: null, start: "auto", stale: [] }); setMenu(false); };
  return (
    <div className="summary">
      <div className="patient-top">
        <p className="filled"><b>{filled}</b> answered</p>
        <div className="pt-actions">
        <button type="button" className="btn ghost pt-paste-btn" data-testid="paste-open" title="Fill in answers from a clinic note"
          onClick={() => window.dispatchEvent(new CustomEvent("oc-open-paste"))}><ClipboardPaste size={15} aria-hidden /> Paste a note</button>
        <span className="pt-more" ref={menuRef}>
          <button type="button" ref={btnRef} className="btn ghost pt-more-btn" aria-expanded={menu} aria-haspopup="dialog" data-testid="patient-more" onClick={() => setMenu((o) => !o)}>
            More <ChevronDown size={15} aria-hidden />
          </button>
          {menu && (
            <div className="pt-menu" role="dialog" aria-label="More patient options">
              <button type="button" className="pt-menu-item" disabled={!filled} onClick={() => { setNaming(""); setMenu(false); }}><Save size={15} aria-hidden /> Save in this browser</button>
              {saved.length > 0 && (<>
                <span className="pt-menu-label">Saved patients</span>
                <ul className="pt-saved">{saved.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="pt-menu-item" onClick={() => load(x)} title="Load this patient"><span className="pt-saved-name">{x.name}</span><time>{new Date(x.at).toLocaleDateString()}</time></button>
                    <button type="button" className="ib" aria-label={`Delete ${x.name}`} onClick={() => { const l = saved.filter((y) => y.id !== x.id); setSaved(l); writeSaved(slug, l); }}><Trash2 size={14} /></button>
                  </li>
                ))}</ul>
              </>)}
              {examples.length > 0 && (<>
                <label className="pt-menu-label" htmlFor="pt-example">Load an example</label>
                <select id="pt-example" className="sel small" aria-label="Load an example" value=""
                  onChange={(e) => { const ex = examples.find((x) => x.id === e.target.value); if (ex) load(ex); }}>
                  <option value="">Choose an example…</option>
                  {examples.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </>)}
              <hr className="pt-menu-sep" />
              <button type="button" className="pt-menu-item danger" disabled={!filled && s.age === null} onClick={startOver}><RotateCcw size={15} aria-hidden /> Start over</button>
            </div>
          )}
        </span>
        </div>
      </div>
      {naming !== null && (
        <form className="save-row" onSubmit={(e) => { e.preventDefault(); save(naming); }}>
          <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Label, e.g. Example A (don't use the patient's name)" aria-label="Label for this patient" />
          <button type="submit" className="btn small">Save</button>
          <button type="button" className="btn ghost small" onClick={() => setNaming(null)}>Cancel</button>
        </form>
      )}
      {(chips.length > 0 || s.age !== null) && (<>
        <p className="chips-label" aria-hidden>Entered so far</p>
        <ul className="chips-strip" aria-label="Entered so far">
          {s.age !== null && <li><span>Age {s.age}</span></li>}
          {chips.map((k) => (
            <li key={k} className={s.stale.includes(k) ? "held" : undefined}>
              <button type="button" onClick={() => focus(k)} title={s.stale.includes(k) ? "Carried over from diagnosis: confirm or update" : "Change this answer"}>{(meta(k).short ?? label(k))}: <b>{factValue(k, s.facts[k], schema)}</b></button>
              <button type="button" className="chip-x" aria-label={`Clear ${label(k)}`} onClick={() => clear1(k)}><X size={12} /></button>
            </li>
          ))}
        </ul>
      </>)}
    </div>
  );
}

/* ---------------- paste from the note ---------------- */

function PasteRecord({ schema }: { schema: Schema }) {
  const { s, set, setFacts } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [pick, setPick] = useState<Set<number>>(new Set());
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // "Paste a note" in the top bar: open the box, bring it into view and put the cursor in it
    const f = () => {
      setOpen(true);
      window.setTimeout(() => {
        const el = box.current; if (!el) return;
        const sc = el.closest<HTMLElement>(".rp-body");
        if (sc) sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 72, behavior: "smooth" });
        el.querySelector("textarea")?.focus({ preventScroll: true });
      }, 60);
    };
    window.addEventListener("oc-open-paste", f);
    return () => window.removeEventListener("oc-open-paste", f);
  }, []);
  const read = () => { const f = extractFacts(text, schema); setFound(f); setPick(new Set(f.map((_, i) => i))); };
  const apply = () => {
    if (!found) return;
    const chosen = found.filter((_, i) => pick.has(i));
    const { facts, age } = applyFound(s.facts, chosen);
    setFacts(facts);
    const fresh = new Set(chosen.map((f) => f.fact));
    set({ pathSel: null, stale: s.stale.filter((k) => !fresh.has(k) && JSON.stringify(facts[k]) === JSON.stringify(s.facts[k])), ...(age !== null ? { age } : {}) });
    setFound(null); setText(""); setOpen(false);
  };
  const shown = (f: Found) => (f.fact === "__age" ? `${f.value} years` : factValue(f.fact, f.value, schema));
  return (
    <details className="paste" ref={box} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><ClipboardPaste size={15} aria-hidden /> Paste from the note <span className="paste-sub">· fill in answers automatically</span></summary>
      <p className="note">Paste a clinic note or report. Answers are read with simple rules for you to check. Nothing leaves this browser.</p>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setFound(null); }} rows={5} aria-label="Note text"
        placeholder="e.g. 64-year-old man, cT1c, Gleason 3+3, PSA 5 ng/mL, life expectancy about 18 years…" />
      <div className="paste-actions">
        <button type="button" className="btn small" disabled={!text.trim()} onClick={read}>Read the note</button>
        {found && <span className="note">{found.length ? `Found ${found.length} ${found.length === 1 ? "answer" : "answers"}. Untick anything wrong.` : "Nothing recognised: answer the questions instead."}</span>}
      </div>
      {found && found.length > 0 && (<>
        <ul className="found">
          {found.map((f, i) => {
            const before = f.fact !== "__age" ? s.facts[f.fact] : s.age;
            return (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={pick.has(i)} onChange={(e) => { const p = new Set(pick); if (e.target.checked) p.add(i); else p.delete(i); setPick(p); }} />
                  <span className="fd-k">{f.fact === "__age" ? "Age" : label(f.fact)}</span>
                  <b>{shown(f)}</b>
                  {before !== undefined && before !== null && JSON.stringify(before) !== JSON.stringify(f.value) && <em className="fd-was">replaces {f.fact === "__age" ? String(before) : factValue(f.fact, before, schema)}</em>}
                </label>
                <q>{f.evidence}</q>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn primary small" disabled={!pick.size} onClick={apply} data-testid="apply-found">Apply {pick.size} {pick.size === 1 ? "answer" : "answers"}</button>
      </>)}
    </details>
  );
}

/* ---------------- one question at a time ---------------- */

function Interview({ deciders, previews, subtype, answer, onPage, routes, toPaths }: {
  deciders: Decider[]; previews: Map<string, Preview[]>; subtype?: string; answer: (f: string, v: unknown) => void;
  onPage: (p: string) => void; routes: number; toPaths: () => void;
}) {
  const { bundle } = useApp();
  const vars = bundle.schema.variables;
  const [skipped, setSkipped] = useState<string[]>([]);
  const [asked, setAsked] = useState<string[]>([]);
  const queue = deciders.map((d) => d.fact).filter((f) => !skipped.includes(f));
  const cur = queue[0];
  if (!cur) {
    return (
      <div className="interview done">
        <p className="iv-q">That's every question that changes the recommendation.</p>
        <p className="note">{routes ? countRecs(routes) + "." : "No recommendation fits these answers."}{skipped.length > 0 && <> You skipped {skipped.length}: <button type="button" className="linkish" onClick={() => setSkipped([])}>ask them again</button>.</>}</p>
        {routes > 0 && <button type="button" className="btn primary" onClick={toPaths}>See the recommendation <ArrowRight size={14} aria-hidden /></button>}
      </div>
    );
  }
  const d = deciders.find((x) => x.fact === cur) ?? null;
  const spec = vars[cur];
  const m = meta(cur);
  const values = spec.type === "bool" ? [true, false] : (spec.values ?? []);
  const pv = previews.get(cur) ?? [];
  // answers that all lead to the same place say nothing: leave them out, as the form does
  const sameLead = pv.every((p) => p.decides?.node === pv[0].decides?.node && p.routes === pv[0].routes);
  const go = (v: unknown) => { setAsked([...asked, cur]); answer(cur, v); };
  return (
    <div className="interview" aria-live="polite">
      <p className="iv-n">Question {asked.length + 1}{queue.length > 1 ? " · a few more may follow" : ""}</p>
      <p className="iv-q" id="iv-q">{m.label}{spec.time === "at_diagnosis" ? " (at diagnosis)" : spec.time === "history" ? " (history)" : ""}</p>
      {d?.node && <Decides why={d} onPage={onPage} />}
      {m.hint && <p className="hint">{m.hint}</p>}
      {spec.type === "number" ? (
        <IvNumber key={cur} unit={spec.unit} onDone={go} />
      ) : values.length > 9 ? (
        <IvSearch key={cur} values={values} pv={sameLead ? [] : pv} subtype={subtype} onPick={go} />
      ) : (<>
        <div className="iv-options" role="group" aria-labelledby="iv-q">
          {values.map((v, i) => {
            const p = pv.find((x) => x.value === v);
            return (
              <button key={String(v)} type="button" onClick={() => go(v)}>
                <span className="iv-k" aria-hidden>{i + 1}</span>
                <b>{valueLabel(v)}</b>
                {p && !sameLead && <span className="iv-to"><Leads p={p} /></span>}
              </button>
            );
          })}
        </div>
        {values.length > 0 && values.length <= 9 && <p className="iv-tip">Tip: press the number key to answer.</p>}
      </>)}
      <div className="iv-actions">
        {asked.length > 0 && <button type="button" className="btn ghost" onClick={() => { const last = asked[asked.length - 1]; setAsked(asked.slice(0, -1)); answer(last, undefined); }}>Back</button>}
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={() => setSkipped([...skipped, cur])}>Don't know — skip</button>
      </div>
      <IvKeys count={spec.type === "number" ? 0 : values.length} pick={(i) => go(values[i])} />
    </div>
  );
}

/** More than nine choices: type to narrow the list (number keys only reach 1 to 9). */
const GENERIC = new Set(["lymphoma", "lymphomas", "cell", "large", "disorders", "related", "other", "type", "with", "cancer", "disease"]);
const words = (x: unknown) => String(x).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w));
function IvSearch({ values, pv, subtype, onPick }: { values: unknown[]; pv: Preview[]; subtype?: string; onPick: (v: unknown) => void }) {
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase();
  // answers that share a word with the chosen subtype come first
  const sub = useMemo(() => new Set(subtype ? words(subtype) : []), [subtype]);
  const ranked = useMemo(() => (sub.size ? values.map((v, i) => ({ v, i, n: words(v).filter((w) => sub.has(w)).length })).sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.v) : values), [values, sub]);
  const shown = ranked.filter((v) => !t || valueLabel(v).toLowerCase().includes(t));
  return (
    <div className="iv-search">
      <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Find an answer among ${values.length}`} placeholder={`Type to find one of ${values.length} answers`}
        onKeyDown={(e) => { if (e.key === "Enter" && shown.length) { e.preventDefault(); onPick(shown[0]); } }} />
      <ul className="iv-list" aria-label="Answers">
        {shown.map((v) => {
          const p = pv.find((x) => x.value === v);
          return (
            <li key={String(v)}>
              <button type="button" onClick={() => onPick(v)}><b>{valueLabel(v)}</b>{p && <span className="iv-to"><Leads p={p} /></span>}</button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="iv-none">No answer matches “{q}”.</li>}
      </ul>
      {shown.length > 0 && t && <p className="iv-tip">Press Enter to choose the first match.</p>}
    </div>
  );
}

function IvNumber({ unit, onDone }: { unit?: string; onDone: (v: unknown) => void }) {
  const [t, setT] = useState("");
  const v = parseNumber(t);
  return (
    <form className="iv-num" onSubmit={(e) => { e.preventDefault(); if (v !== null && v !== undefined) onDone(v); }}>
      <div className="num"><input autoFocus inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)} placeholder="—" aria-label="Value" />{unitLabel(unit) && <span className="unit">{unitLabel(unit)}</span>}</div>
      <button type="submit" className="btn primary" disabled={v === null || v === undefined}>Next <ArrowRight size={14} aria-hidden /></button>
    </form>
  );
}

/** Number keys answer the question (when no text field has focus). */
function IvKeys({ count, pick }: { count: number; pick: (i: number) => void }) {
  useEffect(() => {
    if (!count) return;
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= Math.min(9, count)) { e.preventDefault(); pick(n - 1); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [count, pick]);
  return null;
}
