/**
 * Paste the record: find the guideline's patient details in free text (a clinic note, a
 * pathology report) with plain rules, for the user to review before anything is applied.
 *
 * Works from the guideline's own schema, so it covers every guideline without per-guideline
 * code: numbers after the detail's name ("PSA 5 ng/mL"), staging codes ("cT2b", "N0", "M1c"),
 * choices named in the text ("radical prostatectomy"), yes/no details by their key words with
 * negation ("no adverse features"), plus a few universal patterns (age, ECOG, Gleason score).
 */
import type { Facts, Schema, VarSpec } from "../types";
import { label, meta, valueLabel } from "./factMeta";

export interface Found {
  /** schema variable, or "__age" for the patient's age */
  fact: string;
  value: unknown;
  /** the words in the text it was read from */
  evidence: string;
  /** where in the text (for highlighting) */
  at: number;
}

const STOP = new Set(["a", "an", "the", "of", "or", "and", "to", "in", "on", "for", "with", "by", "at", "than", "other", "present", "status",
  "stated", "record", "states", "clinician", "judges", "judgment", "received", "result", "category", "value", "level", "count", "type", "any", "is", "are"]);
const NEG = /\b(no|not|never|without|negative|neg|denies|denied|absent|none|free of|ruled out|unremarkable)\b[^.;,:]{0,24}$/i;
const NEG_WORD = /\b(no|not|never|without|negative|denies|absent|none)\b/i;
/** Another measure of the same thing ("PSA nadir", "PSA doubling time") is not the value itself. */
const OTHER_MEASURE = /^\s*(nadir|doubling|velocity|density|kinetics|half-life)\b/i;
const NOW = /\b(now|current(?:ly)?|latest|most recent|today|recent)\b/i;
const UNIT_WORDS: Record<string, string> = { "ng/ml": "ng/?mL", "ng_ml": "ng/?mL", "ng/dl": "ng/?dL", years: "(?:years?|y|yrs?)", months: "(?:months?|mo)", percent: "%|percent" };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stem = (w: string) => w.toLowerCase().replace(/(ies|es|s)$/, "").slice(0, 6);

/** Names a detail goes by in text: its label, short form, and the words of its variable name. */
function aliases(name: string, spec: VarSpec): string[] {
  const m = meta(name);
  const base = name.replace(/_(ng_ml|ng_dl|mg_dl|years?|months?|percent|pct|count|cm|mm)$/i, "").replace(/_/g, " ");
  const out = new Set([label(name), m.short ?? "", base].map((x) => x.toLowerCase().replace(/[^a-z0-9/+ -]/g, " ").replace(/\s+/g, " ").trim()).filter((x) => x.length >= 2));
  if (/psa doubling/.test(base)) out.add("psadt").add("doubling time");
  if (/grade group/.test(base)) out.add("gg").add("isup grade").add("grade group");
  if (/ecog/.test(base)) out.add("ecog ps").add("performance status").add("ecog");
  if (/life expectancy/.test(base)) out.add("life expectancy");
  if (/testosterone/.test(base)) out.add("testosterone");
  void spec;
  return [...out];
}

const boolKeys = (name: string) => [...new Set(label(name).toLowerCase().replace(/[^a-z0-9/ ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
const freqCache = new WeakMap<Schema, Map<string, number>>();
/** How many yes/no details use each key word (a word used by one detail identifies it). */
function keyFreq(schema: Schema) {
  let m = freqCache.get(schema);
  if (!m) {
    m = new Map();
    for (const [n, v] of Object.entries(schema.variables ?? {})) if (v.type === "bool") for (const k of boolKeys(n)) m.set(k, (m.get(k) ?? 0) + 1);
    freqCache.set(schema, m);
  }
  return m;
}

/** Staging-like codes: "T1c", "N0", "M1b", "IIIA" (matched case-sensitively, with c/p/y prefixes). */
const isCode = (v: string) => /^(?:[TNM](?:[0-4X]|is)[a-d]?\d?|[cpy]?[TNM][0-4X][a-d]?|(?:I|II|III|IV)[A-C]?\d?)$/.test(v);

export function extractFacts(text: string, schema: Schema): Found[] {
  const found = new Map<string, Found>();
  const put = (f: Found) => { if (!found.has(f.fact)) found.set(f.fact, f); };
  const vars = schema.variables ?? {};
  const lower = text.toLowerCase();
  const sentences = [...text.matchAll(/[^.;\n]+[.;\n]?/g)].map((m) => ({ s: m[0], at: m.index ?? 0 }));

  // age: "64-year-old", "64 yo", "age 64", "aged 64"
  const age = text.match(/\b(\d{1,3})[- ]?(?:year[- ]old|y\/?o\b|yo\b|-yo\b)|\bage[ds]?\s*:?\s*(\d{1,3})\b/i);
  if (age) {
    const v = Number(age[1] ?? age[2]);
    if (v > 0 && v < 120) {
      if (vars.age) put({ fact: "age", value: v, evidence: age[0], at: age.index ?? 0 });
      else put({ fact: "__age", value: v, evidence: age[0], at: age.index ?? 0 });
    }
  }

  // Gleason score -> Grade Group (ISUP), when the guideline asks for a grade group
  const gg = Object.keys(vars).find((n) => /grade_group/.test(n));
  const gl = text.match(/gleason(?:\s+score)?\s*:?\s*(\d)\s*\+\s*(\d)(?:\s*=\s*\d+)?/i);
  if (gg && gl) {
    const a = +gl[1], b = +gl[2], s = a + b;
    const group = s <= 6 ? 1 : s === 7 ? (a === 3 ? 2 : 3) : s === 8 ? 4 : 5;
    const v = (vars[gg].values ?? []).includes(String(group)) ? String(group) : group;
    put({ fact: gg, value: v, evidence: gl[0], at: gl.index ?? 0 });
  }

  for (const [name, spec] of Object.entries(vars)) {
    if (found.has(name)) continue;
    const names = aliases(name, spec);

    if (spec.type === "number" || (spec.type === "enum" && (spec.values ?? []).every((v) => /^\d+$/.test(String(v)) || v === "other"))) {
      // "<name> [of|was|is|=|:] <number> [unit]" (and "<number> <name>" for counts), skipping
      // numbers that are times ("PSA 8 weeks after surgery") and other measures ("PSA nadir");
      // a value marked as current ("now 3.1") wins over an earlier one
      const unit = UNIT_WORDS[(spec.unit ?? "").toLowerCase()] ?? "";
      const timeUnit = /week|day|hour|month|year/.test(spec.unit ?? "");
      const cands: { v: unknown; ev: string; at: number; now: boolean }[] = [];
      for (const al of names) {
        const re = new RegExp(`\\b${esc(al)}\\b`, "gi");
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 48);
          if (OTHER_MEASURE.test(tail) && !OTHER_MEASURE.test(al)) continue;
          const nre = /(<|>|≤|≥)?\s*(\d+(?:\.\d+)?)/g;
          let n: RegExpExecArray | null;
          while ((n = nre.exec(tail))) {
            const before = tail.slice(0, n.index);
            if (/[.;\n]/.test(before)) break;          // stay in the clause
            const after = tail.slice(n.index + n[0].length, n.index + n[0].length + 12).toLowerCase();
            if (!timeUnit && /^\s*(weeks?|wk|days?|hours?|months?|mo|years?|y)\b/.test(after)) continue;
            if (/^\s*\/\s*\d/.test(after) || /^\s*\+/.test(after)) continue;   // "0/12", "3+4"
            let v: unknown = Number(n[2]);
            if (n[1]) v = n[1] === "<" || n[1] === "≤" ? { lt: Number(n[2]) } : { gt: Number(n[2]) };
            if (spec.type === "enum") { if (!(spec.values ?? []).includes(String(n[2]))) continue; v = String(n[2]); }
            if (unit && !new RegExp(`^\\s*(${unit})`, "i").test(after) && /^\s*[a-z]/i.test(after) && !/^\s*(and|or|on|in|at|with|is|was|,)/i.test(after)) {
              // a different unit follows: not this detail
              if (/^\s*(mg|g\/|mmol|cm|mm|%)/i.test(after)) continue;
            }
            cands.push({ v, ev: (m[0] + tail.slice(0, n.index + n[0].length + (after.match(/^\s*[a-z/%]+/i)?.[0].length ?? 0))).trim(), at: m.index, now: NOW.test(before) });
            break;
          }
        }
        if (/count/.test(name) || spec.unit === "count") {
          // "9 bone metastases"
          const rev = new RegExp(`\\b(\\d+)\\s+(?:[a-z]+\\s+)?${esc(al)}\\b`, "gi");
          const r = rev.exec(text);
          if (r) cands.push({ v: Number(r[1]), ev: r[0], at: r.index, now: false });
        }
      }
      if (cands.length) {
        const pick = cands.find((c) => c.now) ?? cands.sort((a, b) => a.at - b.at)[0];
        put({ fact: name, value: pick.v, evidence: pick.ev, at: pick.at });
      }
      continue;
    }

    if (spec.type === "enum") {
      const values = (spec.values ?? []).map(String).filter((v) => v !== "other");
      // staging codes: the most specific code written in the text ("cT2b" over "T2")
      const codes = values.filter(isCode).sort((a, b) => b.length - a.length);
      let done = false;
      for (const v of codes) {
        // a sub-stage the choices do not list counts as its stage ("M1b" is M1)
        const sub = /[a-d]$/.test(v) ? "" : "(?:[a-d](?![a-z]))?";
        const m = new RegExp(`(?<![A-Za-z0-9])[cpyr]?${esc(v)}${sub}(?![0-9a-z])`).exec(text);
        if (m) { put({ fact: name, value: v, evidence: m[0], at: m.index }); done = true; break; }
      }
      if (done || codes.length) continue;
      // choices named in words: "radical prostatectomy", "undetectable"; a short or generic word
      // only counts in a sentence that also names the detail
      // the latest mention wins ("PSA had been undetectable … now rising (PSA recurrence)")
      const hits: Found[] = [];
      for (const v of values) {
        const words = valueLabel(v).toLowerCase().replace(/[^a-z0-9+ ]/g, " ").trim();
        if (words.length < 4 || v === "none") continue;
        const re = new RegExp(`\\b${esc(words).replace(/\\ /g, "[\\s-]+")}\\b`, "gi");
        const strong = words.includes(" ") || words.length >= 9;
        for (const { s, at } of sentences) {
          const named = names.some((al) => s.toLowerCase().includes(al.split(" ")[0]));
          if (!strong && !named) continue;
          let m: RegExpExecArray | null;
          while ((m = re.exec(s))) {
            const pre = s.slice(0, m.index);
            if (NEG.test(pre) || /\b(had been|previously|initially|was once)\b[^,;]{0,20}$/i.test(pre)) continue;
            hits.push({ fact: name, value: v, evidence: s.slice(Math.max(0, m.index - 30), m.index + m[0].length + 20).trim(), at: at + m.index });
          }
        }
      }
      if (hits.length) put(hits.sort((a, b) => b.at - a.at)[0]);
      continue;
    }

    if (spec.type === "bool") {
      // key words of the detail close together in one sentence; negated -> false
      const keys = boolKeys(name);
      if (!keys.length) continue;
      // words that tell this detail apart from the others must all be there
      // (a word only this detail uses, or every word when none is unique to it)
      const distinct = keys.filter((k) => (keyFreq(schema).get(k) ?? 0) <= 1);
      const need = distinct.length ? Math.max(Math.min(2, keys.length), Math.ceil(keys.length * 0.6)) : keys.length;
      for (const { s, at } of sentences) {
        const toks = [...s.matchAll(/[A-Za-z0-9/]+/g)].map((m) => ({ w: m[0], at: m.index ?? 0 }));
        let best: { n: number; i0: number; i1: number } | null = null;
        for (let i = 0; i < toks.length; i++) {
          const span = toks.slice(i, i + keys.length + 3);
          const hits = keys.filter((k) => span.some((t) => stem(t.w) === stem(k) || (k.length > 6 && t.w.toLowerCase().startsWith(k.slice(0, 6)))));
          if (distinct.length && !distinct.some((k) => hits.includes(k))) continue;
          if (hits.length >= need && (!best || hits.length > best.n)) {
            const idx = span.map((t, j) => (keys.some((k) => stem(t.w) === stem(k) || (k.length > 6 && t.w.toLowerCase().startsWith(k.slice(0, 6)))) ? j : -1)).filter((j) => j >= 0);
            best = { n: hits.length, i0: i + idx[0], i1: i + idx[idx.length - 1] };
          }
        }
        if (!best) continue;
        const start = toks[best.i0].at, end = toks[best.i1].at + toks[best.i1].w.length;
        const before = s.slice(Math.max(0, start - 30), start);
        const after = s.slice(end, end + 18);
        const neg = NEG.test(before) || NEG_WORD.test(s.slice(start, end)) || /^\s*(?:negative|absent|not (?:seen|present|detected))\b/i.test(after);
        put({ fact: name, value: !neg, evidence: s.slice(Math.max(0, start - (neg ? before.length : 0)), end).trim(), at: at + start });
        break;
      }
    }
  }
  void lower;
  // a stated risk classification ("low-risk prostate cancer"), for derived risk groups the
  // record may state outright
  for (const [name, d] of Object.entries(schema.derived ?? {})) {
    if (d.type !== "enum" || !/risk/.test(name) || found.has(name)) continue;
    const values = [...new Set([...d.rules.map((r) => String(r.then)), ...(d.else != null ? [String(d.else)] : [])])];
    const m = /\b((?:very|favou?rable|unfavou?rable)[ -])?(high|low|intermediate)[ -]risk\b/i.exec(text);
    if (!m) continue;
    const v = `${m[1] ? m[1].trim().toLowerCase().replace("favour", "favor") + "_" : ""}${m[2].toLowerCase()}${m[1] && /favo/i.test(m[1]) ? "" : ""}`;
    const pick = values.find((x) => x === v) ?? values.find((x) => x === `${m[1] ? m[1].trim().toLowerCase().replace("favour", "favor") + "_" : ""}intermediate`);
    if (pick) put({ fact: name, value: pick, evidence: m[0], at: m.index });
  }
  return [...found.values()].sort((a, b) => a.at - b.at);
}

/** Apply found details to the facts (age goes to the age field, not a branch variable). */
export function applyFound(facts: Facts, found: Found[]): { facts: Facts; age: number | null } {
  const next = { ...facts };
  let age: number | null = null;
  for (const f of found) {
    if (f.fact === "__age") age = f.value as number;
    else next[f.fact] = f.value;
  }
  return { facts: next, age };
}
