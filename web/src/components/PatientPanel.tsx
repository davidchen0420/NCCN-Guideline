import { useEffect, useMemo, useState } from "react";
import { useApp } from "../store";
import type { Facts, VarSpec } from "../types";
import { derive } from "../lib/predicates";
import { GROUPS, fieldCount, filledCount, formatNumber, groupOf, label, meta, numberText, parseNumber, unitLabel, valueLabel } from "../lib/factMeta";
import { resolveRef } from "../lib/graph";
import { SrcChip } from "../source";

/** Enum options that fit on one row as buttons; longer lists use a menu. */
const asButtons = (values: string[]) => values.length <= 6 && values.map(valueLabel).join("").length <= 44;

function Segmented({ id, name, values, value, onChange }: { id: string; name: string; values: (string | boolean)[]; value: unknown; onChange: (v: unknown) => void }) {
  return (
    <div className="seg-row" role="radiogroup" aria-labelledby={`${id}-l`} id={id}
      onKeyDown={(e) => {
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
            title={on ? "Click again to clear" : undefined} onClick={() => onChange(on ? undefined : v)}>
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

function Field({ name, spec, value, onChange, needed, used }: { name: string; spec: VarSpec; value: unknown; onChange: (v: unknown) => void; needed: boolean; used: boolean }) {
  const id = `fact-${name}`;
  const m = meta(name);
  const values = spec.type === "bool" ? [true, false] : spec.values ?? [];
  return (
    <div className={`pf${needed ? " needed" : ""}${value !== undefined ? " set" : ""}`}>
      <label id={`${id}-l`} htmlFor={id} className="flabel">
        <span>{m.label}</span>
        {needed && <span className="need-tag">helps rank pathways</span>}
        {!needed && used && value === undefined && <span className="sr">used by the pathways shown</span>}
      </label>
      {spec.type === "number" ? <NumberInput id={id} value={value} unit={spec.unit} onChange={onChange} />
        : asButtons(values.map(String)) || spec.type === "bool"
          ? <Segmented id={id} name={m.label} values={values} value={value} onChange={onChange} />
          : (
            <select id={id} className="sel" value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value || undefined)}>
              <option value="">Not known</option>
              {values.map((v) => <option key={String(v)} value={String(v)}>{valueLabel(v)}</option>)}
            </select>
          )}
      {m.hint && <span className="hint">{m.hint}</span>}
    </div>
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

export function PatientPanel() {
  const { s, g, bundle, set, setFacts, ranking } = useApp();
  const schema = bundle.schema;
  const vars = schema.variables;
  const derived = useMemo(() => derive(s.facts, schema), [s.facts, schema]);

  const top = ranking.paths.slice(0, 3);
  const needed = useMemo(() => new Set(top.flatMap((p) => p.missing)), [top]);
  const used = useMemo(() => new Set(ranking.paths.flatMap((p) => p.steps.flatMap((st) => st.missing))), [ranking]);

  const set1 = (name: string, v: unknown) => {
    const f: Facts = { ...s.facts };
    if (v === undefined || v === "" || v === null) delete f[name]; else f[name] = v;
    setFacts(f);
    set({ pathSel: null });
  };

  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    Object.keys(vars).forEach((n) => { const k = groupOf(n); m.set(k, [...(m.get(k) ?? []), n]); });
    return GROUPS.filter((gr) => m.has(gr.key)).map((gr) => ({ ...gr, names: m.get(gr.key)! }));
  }, [vars]);

  // Derived enums a record may state outright ("low-risk"); computed values otherwise.
  const statedOk = Object.entries(schema.derived ?? {}).filter(([, d]) => d.type === "enum" && !d.rules.some((r) => JSON.stringify(r.if).includes("_stated")));
  const computed = Object.entries(derived).filter(([k, v]) => schema.derived?.[k] && !(k in s.facts) && v !== undefined && v !== null);
  const filled = filledCount(s.facts, schema), total = fieldCount(schema);
  const examples = bundle.examples ?? [];

  if (!Object.keys(vars).length) return <p className="note">This guideline has no fact schema, so patient details cannot decide branches.</p>;
  return (
    <div className="patient">
      <div className="patient-top">
        <div>
          <p className="filled"><b>{filled}</b> of {total} details entered</p>
          <span className="meter" aria-hidden><i style={{ width: `${(filled / total) * 100}%` }} /></span>
        </div>
        <div className="patient-tools">
          {examples.length > 0 && (
            <select className="sel small" aria-label="Load an example patient" value=""
              onChange={(e) => { const ex = examples.find((x) => x.id === e.target.value); if (ex) { setFacts({ ...ex.facts }); set({ age: ex.age ?? null, pathSel: null, start: "auto" }); } }}>
              <option value="">Examples…</option>
              {examples.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          )}
          <button type="button" className="btn ghost small" disabled={!filled && s.age === null} onClick={() => { setFacts({}); set({ age: null, pathSel: null }); }}>Clear</button>
        </div>
      </div>
      <p className="note">Enter what the record says and leave the rest blank. Pathways update as you type.</p>

      {groups.map((gr) => (
        gr.key === "stated" ? null : (
          <fieldset key={gr.key} className="fgroup">
            <legend>{gr.title}<em>{gr.names.filter((n) => s.facts[n] !== undefined).length}/{gr.names.length}</em></legend>
            {gr.key === "patient" && !vars.age && (
              <div className="pf">
                <label htmlFor="patient-age" className="flabel"><span>Age</span></label>
                <NumberInput id="patient-age" value={s.age ?? undefined} unit="years" onChange={(v) => set({ age: typeof v === "number" ? v : null })} />
                <span className="hint">Not a branch in the algorithm; used to estimate life expectancy.</span>
              </div>
            )}
            {gr.names.map((n) => (
              <div key={n}>
                <Field name={n} spec={vars[n]} value={s.facts[n]} onChange={(v) => set1(n, v)} needed={needed.has(n) && s.facts[n] === undefined} used={used.has(n)} />
                {n === "life_expectancy_years" && <LifeExpectancyHelper age={s.age} onApply={(y) => set1(n, y)} />}
              </div>
            ))}
          </fieldset>
        )
      ))}

      <details className="fgroup more">
        <summary>Classifications stated in the record</summary>
        <p className="note">Use these when the record states a classification (for example “low-risk”) without the details behind it. A stated value replaces the computed one.</p>
        {groups.find((gr) => gr.key === "stated")?.names.map((n) => (
          <Field key={n} name={n} spec={vars[n]} value={s.facts[n]} onChange={(v) => set1(n, v)} needed={false} used={used.has(n)} />
        ))}
        {statedOk.map(([n, d]) => {
          const values = [...new Set([...d.rules.map((r) => String(r.then)), ...(d.else !== undefined && d.else !== null ? [String(d.else)] : [])])];
          return <Field key={n} name={n} spec={{ type: "enum", values }} value={s.facts[n]} onChange={(v) => set1(n, v)} needed={false} used={used.has(n)} />;
        })}
      </details>

      {computed.length > 0 && (
        <section className="computed" aria-label="Worked out from your entries">
          <h4>Worked out from your entries</h4>
          <dl>
            {computed.filter(([k]) => !k.startsWith("gt5y") && !k.includes("_or_")).map(([k, v]) => (
              <div key={k}><dt>{label(k)}</dt><dd>{schema.variables[k]?.type === "number" ? formatNumber(v) : valueLabel(v)}</dd></div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
