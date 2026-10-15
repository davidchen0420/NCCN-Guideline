import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import type { Facts, Schema, VarSpec } from "../types";
import { derive } from "../lib/predicates";
import { GROUPS, factValue, fieldCount, filledCount, formatNumber, groupOf, label, meta, numberText, parseNumber, unitLabel, valueLabel } from "../lib/factMeta";
import { contradictions, decidingFacts, plausibility, previewAnswer, previewValues, type Decider, type Preview } from "../lib/formAssist";
import { applyFound, extractFacts, type Found } from "../lib/extract";
import type { Graph } from "../lib/graph";
import type { Ranking } from "../lib/pathways";
import { resolveRef } from "../lib/graph";
import { SrcChip } from "../source";
import { ArrowRight, ClipboardPaste, MessageCircleQuestion, Save, Search as SearchIcon, Trash2, X } from "lucide-react";

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
}

function Field({ name, spec, value, onChange, needed, used, why, previews, quiet, onPage }: FieldProps) {
  const id = `fact-${name}`;
  const m = meta(name);
  const values = spec.type === "bool" ? [true, false] : spec.values ?? [];
  const check = value !== undefined ? plausibility(name, spec, value) : null;
  return (
    <div className={`pf${needed ? " needed" : ""}${value !== undefined ? " set" : ""}${quiet ? " quiet" : ""}${why ? " decider" : ""}`}>
      <label id={`${id}-l`} htmlFor={id} className="flabel">
        <span>{m.label}{spec.time && spec.time !== "current" && <em className="time-tag">{spec.time === "at_diagnosis" ? "at diagnosis" : "history"}</em>}{spec.judgment && <em className="time-tag">judgment</em>}</span>
        {needed && !why && <span className="need-tag">helps rank pathways</span>}
        {!needed && used && value === undefined && <span className="sr">used by the pathways shown</span>}
      </label>
      {why && why.node && (
        <p className="decides">
          Decides <button type="button" className="decides-page" onClick={() => onPage?.(why.page)} title="Show this page">{why.page}</button> {why.text && <q>{why.text}</q>}
          {why.share < 1 && why.share > 0 && <span className="decides-share"> · open on {Math.round(why.share * 100)}% of the fit</span>}
        </p>
      )}
      {spec.type === "number" ? <NumberInput id={id} value={value} unit={spec.unit} onChange={onChange} />
        : asButtons(values.map(String)) || spec.type === "bool"
          ? <Segmented id={id} name={m.label} values={values} value={value} onChange={onChange} />
          : (
            <select id={id} className="sel" value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value || undefined)}>
              <option value="">Not known</option>
              {values.map((v) => <option key={String(v)} value={String(v)}>{valueLabel(v)}</option>)}
            </select>
          )}
      {check && <span className={`check ${check.level}`} role={check.level === "error" ? "alert" : "status"}>{check.message}</span>}
      {m.hint && <span className="hint">{m.hint}</span>}
      {previews && previews.length > 0 && value === undefined && <Previews previews={previews} onPick={onChange} />}
    </div>
  );
}

/** Where each answer leads: the branch it settles on the most likely route. */
function Previews({ previews, onPick }: { previews: Preview[]; onPick: (v: unknown) => void }) {
  const same = previews.every((p) => p.decides?.node === previews[0].decides?.node && p.routes === previews[0].routes);
  if (same) return null;
  return (
    <ul className="previews" aria-label="Where each answer leads">
      {previews.map((p) => (
        <li key={String(p.value)}>
          <button type="button" onClick={() => onPick(p.value)} title="Choose this answer">
            <b>{valueLabel(p.value)}</b><ArrowRight size={11} aria-hidden />
            {p.routes === 0 ? <span className="pv-none">no route fits</span>
              : p.decides ? <span className="pv-to"><code>{p.decides.page}</code> {p.decides.text}</span>
              : <span className="pv-open">settles nothing yet · {p.routes} {p.routes === 1 ? "route" : "routes"} open</span>}
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
          <p className="src-line">Adjustment rule from <SrcChip t={{ page: principles.pages[0].pdf!, label: "PROS-A", excerpt: principles.pages[0].text.slice(0, 900) }} text="PROS-A · Principles of life expectancy estimation" /></p>
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
function readSaved(slug: string): Saved[] { try { return JSON.parse(localStorage.getItem(savedKey(slug)) ?? "[]"); } catch { return []; } }
function writeSaved(slug: string, list: Saved[]) { try { localStorage.setItem(savedKey(slug), JSON.stringify(list)); } catch { /* blocked */ } }

/* ---------------- the form ---------------- */

export function PatientPanel() {
  const { s, g, bundle, set, setFacts, ranking, go, focusFact, slug } = useApp();
  const schema = bundle.schema;
  const vars = schema.variables;
  const derived = useMemo(() => derive(s.facts, schema), [s.facts, schema]);
  const [mode, setMode] = useState<"form" | "interview">(() => { try { return localStorage.getItem("oc-form-mode") === "interview" ? "interview" : "form"; } catch { return "form"; } });
  const setModeKeep = (m: "form" | "interview") => { setMode(m); try { localStorage.setItem("oc-form-mode", m); } catch { /* blocked */ } };
  useEffect(() => {
    // a jump to a field ("add PSA") needs the full form
    const f = () => { setMode("form"); try { localStorage.setItem("oc-form-mode", "form"); } catch { /* blocked */ } };
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
  const deciders = useMemo(() => decidingFacts(g, ranking, s.facts).filter((d) => d.fact !== sectionVar && vars[d.fact]), [g, ranking, s.facts, sectionVar, vars]);
  const previews = usePreviews(g, s.facts, deciders, ranking);
  const conflicts = useMemo(() => contradictions(s.facts, schema), [s.facts, schema]);
  const deciderSet = useMemo(() => new Set(deciders.map((d) => d.fact)), [deciders]);
  const onPage = useCallback((page: string) => go({ kind: "flow", page }), [go]);

  const [find, setFind] = useState("");
  const term = find.trim().toLowerCase();
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    Object.keys(vars).filter((n) => n !== sectionVar && !deciderSet.has(n))
      .filter((n) => !term || `${label(n)} ${n} ${vars[n].definition ?? ""}`.toLowerCase().includes(term))
      .forEach((n) => { const k = groupOf(n); m.set(k, [...(m.get(k) ?? []), n]); });
    const other = m.get("other") ?? [];
    if (other.length > 6) {
      m.delete("other");
      const byTime: [string, string, (n: string) => boolean][] = [
        ["now", "Current Findings", (n) => !vars[n].time || vars[n].time === "current"],
        ["dx", "At diagnosis", (n) => vars[n].time === "at_diagnosis"],
        ["hx", "History", (n) => vars[n].time === "history"],
      ];
      const extra = byTime.map(([key, title, f]) => ({ key, title, match: /$^/, names: other.filter(f) })).filter((x) => x.names.length);
      return [...GROUPS.filter((gr) => m.has(gr.key)).map((gr) => ({ ...gr, names: m.get(gr.key)! })), ...extra];
    }
    return GROUPS.filter((gr) => m.has(gr.key)).map((gr) => ({ ...gr, names: m.get(gr.key)! }));
  }, [vars, sectionVar, term, deciderSet]);
  const hasLE = Object.keys(vars).some((n) => n.startsWith("life_expectancy"));

  const statedOk = Object.entries(schema.derived ?? {}).filter(([, d]) => d.type === "enum" && !d.rules.some((r) => JSON.stringify(r.if).includes("_stated")));
  const computed = Object.entries(derived).filter(([k, v]) => schema.derived?.[k] && !(k in s.facts) && v !== undefined && v !== null && !k.startsWith("gt5y") && !k.includes("_or_"));
  const filled = filledCount(s.facts, schema), total = fieldCount(schema);
  const examples = bundle.examples ?? [];
  const anyFacts = filled > 0;
  const moreCount = groups.reduce((n, gr) => n + (gr.key === "stated" ? 0 : gr.names.length), 0);
  const [moreOpen, setMoreOpen] = useState(false);

  if (!Object.keys(vars).length) return <p className="note">This guideline has no fact schema, so patient details cannot decide branches.</p>;
  const field = (n: string, extra: Partial<FieldProps> = {}) => (
    <div key={n}>
      <Field name={n} spec={vars[n]} value={s.facts[n]} onChange={(v) => set1(n, v)} needed={needed.has(n) && s.facts[n] === undefined} used={used.has(n)} onPage={onPage} {...extra} />
      {n === "life_expectancy_years" && <LifeExpectancyHelper age={s.age} onApply={(y) => set1(n, y)} />}
    </div>
  );

  return (
    <div className="patient">
      <Summary filled={filled} total={total} slug={slug ?? bundle.title} examples={examples} focus={focusFact} />
      <PasteRecord schema={schema} />
      {conflicts.length > 0 && (
        <div className="conflicts" role="status">
          {conflicts.map((c, i) => (
            <p key={i}>{c.message} {c.facts.map((f) => <button key={f} type="button" className="linkish" onClick={() => focusFact(f)}>{label(f)}</button>)}</p>
          ))}
        </div>
      )}

      <div className="mode-switch" role="group" aria-label="How to enter details">
        <button type="button" className={mode === "form" ? "on" : ""} aria-pressed={mode === "form"} onClick={() => setModeKeep("form")}>Form</button>
        <button type="button" className={mode === "interview" ? "on" : ""} aria-pressed={mode === "interview"} onClick={() => setModeKeep("interview")} data-testid="mode-interview"><MessageCircleQuestion size={13} aria-hidden /> One question at a time</button>
      </div>

      {mode === "interview" ? (
        <Interview deciders={deciders} previews={previews} sectionVar={s.facts[sectionVar ?? ""] === undefined ? sectionVar : null}
          answer={set1} onPage={onPage} routes={ranking.paths.length} toPaths={() => set({ rightTab: "paths" })} />
      ) : (<>
        {sectionVar && (
          <fieldset className="fgroup section-pick">
            <legend>Disease or subtype</legend>
            <Field name={sectionVar} spec={{ ...vars[sectionVar], definition: undefined }} value={s.facts[sectionVar]} onChange={(v) => set1(sectionVar, v)} needed={needed.has(sectionVar) && s.facts[sectionVar] === undefined} used={used.has(sectionVar)} />
            <p className="hint">This guideline covers {bundle.sections!.values.length} diseases or subtypes; each has its own algorithm pages.</p>
          </fieldset>
        )}

        <fieldset className="fgroup deciders" aria-describedby="dec-note">
          <legend>{anyFacts ? "Decides your routes" : "Start with these"}<em>{deciders.length}</em></legend>
          <p className="note" id="dec-note">{anyFacts
            ? "Still unknown, and each decides a branch on the routes that fit. Under each choice: where it leads."
            : "These decide the first branches of the algorithm. Enter what the record says; leave the rest blank."}</p>
          {deciders.length === 0 && <p className="note">{anyFacts ? "Nothing still open decides a branch: the routes are settled by what you entered." : "No details decide the first branches here; open More details below."}</p>}
          {deciders.map((d) => field(d.fact, { why: d, previews: previews.get(d.fact) ?? null }))}
        </fieldset>

        {computed.length > 0 && (
          <section className="computed" aria-label="Worked out from your entries">
            <h4>Worked out from your entries</h4>
            <dl>
              {computed.map(([k, v]) => (
                <div key={k}>
                  <dt>{label(k)}</dt>
                  <dd>{schema.variables[k]?.type === "number" ? formatNumber(v) : valueLabel(v)}</dd>
                  {statedOk.some(([n]) => n === k) && <button type="button" className="linkish ovr" onClick={() => { setMoreOpen(true); window.setTimeout(() => focusFact(k), 30); }}>override</button>}
                </div>
              ))}
            </dl>
            <p className="hint">Computed with the guideline's own rules. If the record states a different classification, override it under “Stated in the record”.</p>
          </section>
        )}

        <details className="fgroup more-details" open={moreOpen || !!term} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
          <summary>More details<em>{moreCount}</em></summary>
          {Object.keys(vars).length > 20 && (
            <div className="field find-fact">
              <SearchIcon size={14} aria-hidden />
              <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Find one of ${Object.keys(vars).length} details`} aria-label="Find a patient detail" />
            </div>
          )}
          {anyFacts && <p className="note">Dimmed details change none of the routes open now.</p>}
          {groups.map((gr) => (
            gr.key === "stated" ? null : (
              <fieldset key={gr.key} className="fgroup">
                <legend>{gr.title}<em>{gr.names.filter((n) => s.facts[n] !== undefined).length}/{gr.names.length}</em></legend>
                {gr.key === "patient" && !vars.age && hasLE && !term && (
                  <div className="pf">
                    <label htmlFor="patient-age" className="flabel"><span>Age</span></label>
                    <NumberInput id="patient-age" value={s.age ?? undefined} unit="years" onChange={(v) => set({ age: typeof v === "number" ? v : null })} />
                    <span className="hint">Not a branch in the algorithm; used to estimate life expectancy.</span>
                  </div>
                )}
                {gr.names.map((n) => field(n, { quiet: anyFacts && !used.has(n) && s.facts[n] === undefined }))}
              </fieldset>
            )
          ))}
          <details className="fgroup more">
            <summary>Stated in the record</summary>
            <p className="note">Use these when the record states a classification (for example “low-risk”) without the details behind it. A stated value replaces the computed one.</p>
            {groups.find((gr) => gr.key === "stated")?.names.map((n) => field(n))}
            {statedOk.map(([n, d]) => {
              const values = [...new Set([...d.rules.map((r) => String(r.then)), ...(d.else !== undefined && d.else !== null ? [String(d.else)] : [])])];
              return <Field key={n} name={n} spec={{ type: "enum", values }} value={s.facts[n]} onChange={(v) => set1(n, v)} needed={false} used={used.has(n)} />;
            })}
          </details>
        </details>
      </>)}
    </div>
  );
}

/* ---------------- summary strip, examples, saved patients ---------------- */

function Summary({ filled, total, slug, examples, focus }: { filled: number; total: number; slug: string; examples: { id: string; label: string; facts: Facts; age?: number }[]; focus: (f: string) => void }) {
  const { s, set, setFacts, bundle } = useApp();
  const schema = bundle.schema;
  const [saved, setSaved] = useState<Saved[]>(() => readSaved(slug));
  const [naming, setNaming] = useState<string | null>(null);
  const chips = Object.keys(s.facts).filter((k) => s.facts[k] !== undefined && (schema.variables[k] || schema.derived?.[k]));
  const clear1 = (k: string) => { const f = { ...s.facts }; delete f[k]; setFacts(f); set({ pathSel: null }); };
  const save = (name: string) => {
    const list = [{ id: String(Date.now()), name: name.trim() || `Patient ${saved.length + 1}`, facts: s.facts, age: s.age, at: new Date().toISOString() }, ...saved].slice(0, 30);
    setSaved(list); writeSaved(slug, list); setNaming(null);
  };
  const load = (p: { facts: Facts; age?: number | null }) => { setFacts({ ...p.facts }); set({ age: p.age ?? null, pathSel: null, start: "auto" }); };
  return (
    <div className="summary">
      <div className="patient-top">
        <div>
          <p className="filled"><b>{filled}</b> of {total} details entered</p>
          <span className="meter" aria-hidden><i style={{ width: `${(filled / Math.max(1, total)) * 100}%` }} /></span>
        </div>
        <div className="patient-tools">
          {(examples.length > 0 || saved.length > 0) && (
            <select className="sel small" aria-label="Load a patient" value=""
              onChange={(e) => {
                const v = e.target.value;
                const ex = examples.find((x) => `ex:${x.id}` === v); if (ex) load(ex);
                const sp = saved.find((x) => `sv:${x.id}` === v); if (sp) load(sp);
              }}>
              <option value="">Load…</option>
              {saved.length > 0 && <optgroup label="Saved">{saved.map((x) => <option key={x.id} value={`sv:${x.id}`}>{x.name}</option>)}</optgroup>}
              {examples.length > 0 && <optgroup label="Examples">{examples.map((x) => <option key={x.id} value={`ex:${x.id}`}>{x.label}</option>)}</optgroup>}
            </select>
          )}
          <button type="button" className="btn ghost small" disabled={!filled} onClick={() => setNaming("")} title="Save this patient in this browser"><Save size={13} aria-hidden /> Save</button>
          <button type="button" className="btn ghost small" disabled={!filled && s.age === null} onClick={() => { setFacts({}); set({ age: null, pathSel: null }); }}>Clear</button>
        </div>
      </div>
      {naming !== null && (
        <form className="save-row" onSubmit={(e) => { e.preventDefault(); save(naming); }}>
          <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Name, e.g. clinic initials and date" aria-label="Name for this patient" />
          <button type="submit" className="btn small">Save</button>
          <button type="button" className="btn ghost small" onClick={() => setNaming(null)}>Cancel</button>
        </form>
      )}
      {saved.length > 0 && naming === null && (
        <details className="saved-list">
          <summary>{saved.length} saved {saved.length === 1 ? "patient" : "patients"} in this browser</summary>
          <ul>{saved.map((x) => (
            <li key={x.id}>
              <button type="button" className="linkish" onClick={() => load(x)}>{x.name}</button>
              <span>{new Date(x.at).toLocaleDateString()}</span>
              <button type="button" className="ib sm" aria-label={`Delete ${x.name}`} onClick={() => { const l = saved.filter((y) => y.id !== x.id); setSaved(l); writeSaved(slug, l); }}><Trash2 size={12} /></button>
            </li>
          ))}</ul>
        </details>
      )}
      {(chips.length > 0 || s.age !== null) && (
        <ul className="chips-strip" aria-label="Entered so far">
          {s.age !== null && <li><span>Age {s.age}</span></li>}
          {chips.map((k) => (
            <li key={k}>
              <button type="button" onClick={() => focus(k)} title="Go to this detail">{(meta(k).short ?? label(k))}: <b>{factValue(k, s.facts[k], schema)}</b></button>
              <button type="button" className="chip-x" aria-label={`Clear ${label(k)}`} onClick={() => clear1(k)}><X size={11} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- paste the record ---------------- */

function PasteRecord({ schema }: { schema: Schema }) {
  const { s, set, setFacts } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [pick, setPick] = useState<Set<number>>(new Set());
  const read = () => { const f = extractFacts(text, schema); setFound(f); setPick(new Set(f.map((_, i) => i))); };
  const apply = () => {
    if (!found) return;
    const chosen = found.filter((_, i) => pick.has(i));
    const { facts, age } = applyFound(s.facts, chosen);
    setFacts(facts);
    set({ pathSel: null, ...(age !== null ? { age } : {}) });
    setFound(null); setText(""); setOpen(false);
  };
  const shown = (f: Found) => (f.fact === "__age" ? `${f.value} years` : factValue(f.fact, f.value, schema));
  return (
    <details className="paste" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><ClipboardPaste size={14} aria-hidden /> Paste from the record</summary>
      <p className="note">Paste a clinic note or report. Details are read with simple rules and shown for you to check; nothing leaves this browser.</p>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setFound(null); }} rows={5} aria-label="Record text"
        placeholder="e.g. 64-year-old man, cT1c, Gleason 3+3, PSA 5 ng/mL, life expectancy about 18 years…" />
      <div className="paste-actions">
        <button type="button" className="btn small" disabled={!text.trim()} onClick={read}>Find details</button>
        {found && <span className="note">{found.length ? `Found ${found.length}. Untick anything wrong.` : "Nothing recognised: enter the details below."}</span>}
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
        <button type="button" className="btn primary small" disabled={!pick.size} onClick={apply} data-testid="apply-found">Apply {pick.size} {pick.size === 1 ? "detail" : "details"}</button>
      </>)}
    </details>
  );
}

/* ---------------- one question at a time ---------------- */

function Interview({ deciders, previews, sectionVar, answer, onPage, routes, toPaths }: {
  deciders: Decider[]; previews: Map<string, Preview[]>; sectionVar: string | null; answer: (f: string, v: unknown) => void;
  onPage: (p: string) => void; routes: number; toPaths: () => void;
}) {
  const { bundle } = useApp();
  const vars = bundle.schema.variables;
  const [skipped, setSkipped] = useState<string[]>([]);
  const [asked, setAsked] = useState<string[]>([]);
  const queue = [...(sectionVar ? [sectionVar] : []), ...deciders.map((d) => d.fact)].filter((f) => !skipped.includes(f));
  const cur = queue[0];
  if (!cur) {
    return (
      <div className="interview done">
        <p className="iv-q">That's everything that decides the open routes.</p>
        <p className="note">{routes ? `${routes} ${routes === 1 ? "route fits" : "routes fit"}.` : "No route fits yet."}{skipped.length > 0 && <> You skipped {skipped.length}: <button type="button" className="linkish" onClick={() => setSkipped([])}>ask them again</button>.</>}</p>
        {routes > 0 && <button type="button" className="btn primary small" onClick={toPaths}>See the routes <ArrowRight size={13} aria-hidden /></button>}
      </div>
    );
  }
  const d = deciders.find((x) => x.fact === cur) ?? null;
  const spec = vars[cur];
  const m = meta(cur);
  const values = spec.type === "bool" ? [true, false] : (spec.values ?? []);
  const pv = previews.get(cur) ?? [];
  const go = (v: unknown) => { setAsked([...asked, cur]); answer(cur, v); };
  return (
    <div className="interview" aria-live="polite">
      <p className="iv-n">Question {asked.length + 1}{queue.length > 1 ? ` · ${queue.length - 1} more may follow` : ""}</p>
      <p className="iv-q" id="iv-q">{m.label}{spec.time === "at_diagnosis" ? " (at diagnosis)" : spec.time === "history" ? " (history)" : ""}?</p>
      {d?.node && <p className="decides">Decides <button type="button" className="decides-page" onClick={() => onPage(d.page)}>{d.page}</button> <q>{d.text}</q></p>}
      {m.hint && <p className="hint">{m.hint}</p>}
      {spec.type === "number" ? (
        <IvNumber key={cur} unit={spec.unit} onDone={go} />
      ) : (
        <div className="iv-options" role="group" aria-labelledby="iv-q">
          {values.map((v, i) => {
            const p = pv.find((x) => x.value === v);
            return (
              <button key={String(v)} type="button" onClick={() => go(v)}>
                <span className="iv-k" aria-hidden>{i + 1}</span>
                <b>{valueLabel(v)}</b>
                {p && <span className="iv-to">{p.routes === 0 ? "no route fits" : p.decides ? <><code>{p.decides.page}</code> {p.decides.text}</> : `settles nothing yet · ${p.routes} open`}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="iv-actions">
        <button type="button" className="btn ghost small" onClick={() => setSkipped([...skipped, cur])}>Don't know · skip</button>
        {asked.length > 0 && <button type="button" className="btn ghost small" onClick={() => { const last = asked[asked.length - 1]; setAsked(asked.slice(0, -1)); answer(last, undefined); }}>Back</button>}
      </div>
      <IvKeys count={spec.type === "number" ? 0 : values.length} pick={(i) => go(values[i])} />
    </div>
  );
}

function IvNumber({ unit, onDone }: { unit?: string; onDone: (v: unknown) => void }) {
  const [t, setT] = useState("");
  const v = parseNumber(t);
  return (
    <form className="iv-num" onSubmit={(e) => { e.preventDefault(); if (v !== null && v !== undefined) onDone(v); }}>
      <div className="num"><input autoFocus inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)} placeholder="—" aria-label="Value" />{unitLabel(unit) && <span className="unit">{unitLabel(unit)}</span>}</div>
      <button type="submit" className="btn primary small" disabled={v === null || v === undefined}>Next <ArrowRight size={13} aria-hidden /></button>
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

