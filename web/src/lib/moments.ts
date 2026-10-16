/**
 * Clinical moments: where in the course of the disease the patient is now. Each guideline's
 * algorithm starts at pages for a new diagnosis (pages nothing else leads to) and has pages for
 * later moments (surveillance, recurrence, advanced disease, later lines), named in their titles.
 * Picking a moment starts the algorithm there and limits the form to the details its branches use.
 */
import type { Facts, Pred } from "../types";
import { sectionStartPages, stateOfEntries, stateOfTitle, type Graph } from "./graph";
import { missingFacts } from "./pathways";
import { stripMarks } from "./adapt";
import { label as factLabel, valueLabel } from "./factMeta";

export type Phase = "diagnosis" | "followup" | "recurrence" | "advanced" | "later";
export const PHASES: { id: Phase; label: string; hint: string }[] = [
  { id: "diagnosis", label: "Workup & first treatment", hint: "New diagnosis: workup and first treatment" },
  { id: "followup", label: "Follow-up", hint: "Surveillance after treatment" },
  { id: "recurrence", label: "Recurrence or relapse", hint: "Recurrent, relapsed, refractory or progressing disease" },
  { id: "advanced", label: "Metastatic or advanced", hint: "Stage IV, metastatic or castration-resistant disease" },
  { id: "later", label: "Later-line therapy", hint: "Subsequent cycles or lines of therapy" },
];

export interface Moment { page: string; title: string; phase: Phase }

/** The phase a later-state page belongs to, from its title; null for an ordinary page. */
export const phaseOf = (title: string): Phase | null => stateOfTitle(title);

const order = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** The phase a page belongs to by what its entry boxes say, when its title does not: a page
 * titled "Radical Prostatectomy PSA" opens on "PSA persistence/recurrence". */
export const entryPhase = (g: Graph, page: string): Phase | null => stateOfEntries(g, page);

/** The moments a guideline's algorithm starts from: its start pages (new diagnosis, unless the
 * title says otherwise) and the later-state pages that have entry boxes. */
export function moments(g: Graph): Moment[] {
  const b = g.bundle;
  const linked = new Set<string>();
  for (const [id, ks] of Object.entries(b.children)) ks.forEach((k) => { if (k.split(":")[0] !== id.split(":")[0]) linked.add(k.split(":")[0]); });
  b.links.forEach(([q, p]) => { if (q !== p) linked.add(p); });
  const roots = g.flowPages.filter((p) => (b.roots[p] ?? []).length);
  const out: Moment[] = [];
  const fromEntry = new Set<string>();   // pages whose phase comes from their entry boxes, not their title
  for (const p of roots) {
    const title = b.pages[p].title || p;
    const ph = phaseOf(title);
    if (!linked.has(p)) {
      const e = ph ? null : entryClass(g, p);
      if (e && e !== "diagnosis") fromEntry.add(p);
      out.push({ page: p, title, phase: ph ?? e ?? "diagnosis" });
    } else if (ph ?? entryPhase(g, p)) out.push({ page: p, title, phase: (ph ?? entryPhase(g, p))! });
  }
  // a guideline whose only start pages are about advanced disease (by their entry boxes) still starts at a diagnosis
  if (!out.some((m) => m.phase === "diagnosis")) for (const m of out) if (fromEntry.has(m.page)) m.phase = "diagnosis";
  // every start page is linked from elsewhere (a loop back from later pages): the first ordinary one starts a diagnosis
  if (!out.some((m) => m.phase === "diagnosis")) {
    const first = [...roots].sort(order).find((p) => !phaseOf(b.pages[p].title || ""));
    if (first) out.push({ page: first, title: b.pages[first].title || first, phase: "diagnosis" });
  }
  return out.sort((x, y) => order(x.page, y.page));
}

/** Screening, prevention and supportive-care guidelines follow a programme, not a disease course. */
export const followsDisease = (title: string) =>
  !/screening|detection|risk reduction|cessation|prevention|survivorship|fatigue|pain|distress|emesis|nausea|anemia|neutropenia|infection|palliative|older adult|adolescent|thrombo|supportive|genetic|familial|hereditary|cachexia|smoking/i.test(title);

/** Moments for the patient's disease, in multi-disease guidelines (the section variable). */
export function momentsFor(g: Graph, all: Moment[], facts: Facts): Moment[] {
  const sec = g.bundle.sections;
  if (!sec) return all;
  const v = facts[sec.variable];
  const secOf = (p: string) => sec.pages?.[p] ?? null;
  if (v === undefined || v === null || v === "") {
    // No disease chosen yet: a page that belongs to one disease (a mantle cell follow-up page) is
    // not a moment of the patient's course; only what all diseases share is offered.
    const shared = all.filter((m) => secOf(m.page) === null);
    if (shared.length) return shared;
    const dx = all.filter((m) => m.phase === "diagnosis");
    return dx.length ? dx : all;
  }
  const mine = all.filter((m) => !secOf(m.page) || secOf(m.page) === v);
  // The disease's own pages begin its new-diagnosis moment; the shared diagnostic-testing page
  // that lists every disease does not.
  const starts = typeof v === "string" ? sectionStartPages(g, v) : [];
  const own = starts.filter((p) => !mine.some((m) => m.page === p));
  if (own.length && !mine.some((m) => m.phase === "diagnosis" && secOf(m.page) === v)) {
    const dx = own.map((p): Moment => ({ page: p, title: g.bundle.pages[p].title || p, phase: phaseOf(g.bundle.pages[p].title || "") ?? "diagnosis" }));
    return [...mine.filter((m) => !(m.phase === "diagnosis" && secOf(m.page) === null)), ...dx].sort((x, y) => order(x.page, y.page));
  }
  return mine.length ? mine : all;
}

/** Raw details that decide any branch reachable from these pages, following the arrows and the
 * boxes that hand the reader over to another algorithm page ("continue on REC-3"): the staging
 * details that a start page's routes only reach through such a hand-over still count. */
export function reachableFacts(g: Graph, pages: string[]): Set<string> {
  const seen = new Set<string>();
  const facts = new Set<string>();
  const stack = pages.flatMap((p) => g.bundle.roots[p] ?? []);
  const add = (p: Pred | null | undefined) => { if (p) for (const f of missingFacts(g, p, {})) facts.add(f); };
  const seenPages = new Set(pages);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = g.node(id);
    add(g.preds[id]); add(n?.linkCond); add(n?.received);
    for (const k of g.kids(id)) if (!seen.has(k)) stack.push(k);
    for (const l of [...(n?.links ?? []), ...(g.parsed.get(id)?.refs ?? [])]) {
      if (!g.bundle.pages[l] || seenPages.has(l)) continue;
      seenPages.add(l);
      stack.push(...(g.bundle.roots[l] ?? []));
    }
    if (seen.size > 20000) break;
  }
  const sv = g.bundle.sections?.variable;
  if (sv) facts.add(sv);
  return facts;
}

/** Details that stay true over time (germline findings, tumour biomarkers, histology): carried
 * over as they are when the patient moves on to a later moment. Everything else that describes
 * the current state is carried over for confirmation. */
export const isStable = (name: string) => /brca|hrr|germline|mutation|msi|mmr|tmb|hla|histolog|gene|fusion|rearrang|amplif|her2|egfr|alk|ros1|braf|kras|ntrk|ret_|met_|pd_?l1|receptor|subtype|cell_type|hereditary|lynch|sex|gender/.test(name);

export const phaseLabel = (p: Phase) => PHASES.find((x) => x.id === p)!.label;

/** The phase of a start setting ("auto" and ordinary pages: none). */
export function startPhase(g: Graph, start: string): Phase | null {
  const n = needOf(g, start);
  // metastatic disease at presentation is still the first workup: nothing is "carried over" to it
  return n === "advanced" && atPresentation(g, start) ? "diagnosis" : n;
}

/** Does the page start metastatic disease at presentation (synchronous, M1 at diagnosis)? */
function atPresentation(g: Graph, page: string): boolean {
  const root = primaryRoot(g, page);
  return !!root && plainSetting(cleanText(g, root), "advanced").startsWith("Metastatic (M1) at presentation");
}

const isLater = (p: Phase | null) => p !== null && p !== "diagnosis";

/** The details to hold for confirmation after moving from `from` to `to`: moving on from a
 * diagnosis to a later moment holds the details that describe the patient's state then (not
 * stable findings, history or details recorded at diagnosis); moving back to a diagnosis releases
 * them all; otherwise (unsure, or a page that is not a moment) the held set stays. */
export function carryOver(g: Graph, from: string, to: string, facts: Facts, held: string[]): string[] {
  const a = startPhase(g, from), b = startPhase(g, to);
  if (b === "diagnosis") return [];
  if (!isLater(b) || isLater(a)) return held.filter((k) => facts[k] !== undefined);
  const vars = g.bundle.schema?.variables ?? {};
  const sv = g.bundle.sections?.variable;
  return Object.keys(facts).filter((k) => vars[k] && k !== sv && facts[k] !== undefined
    && (vars[k].time ?? "current") === "current" && !isStable(k));
}

/* ---------------- what the clinician needs, and in which setting ---------------- */

const cleanText = (g: Graph, id: string) => stripMarks(g.node(id)?.text ?? "").replace(/\s+/g, " ").trim();
const clipText = (t: string, n: number) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);
const upperFirst = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
/** "Metastatic (M1) disease" -> "metastatic (M1) disease"; "HER2-positive" and "M1" stay as they are. */
const lowerFirst = (t: string) => (/^[A-Z][A-Z0-9]/.test(t) ? t : t ? t[0].toLowerCase() + t.slice(1) : t);

const MET_RE = /\bM1[abc]?\b|metasta|stage\s+IV\b/i;
const NOT_MET_RE = /\b(without|no|absence of|non-?|not)\b[^.;()]{0,60}(metasta|\bM1\b)|\bM0\b|\b(localized|locoregional|non-?metastatic)\b/i;
const REC_RE = /recurren|relaps|refractor|progress|persist/i;
const FU_RE = /surveillance|follow-?up|post-?treatment|survivorship/i;

/** What a condition says about metastatic disease: "adv" (requires it), "not" (rules it out), or nothing. */
function metSignal(p: Pred | null | undefined): "adv" | "not" | null {
  if (!p) return null;
  if ("all" in p) { const xs = p.all.map(metSignal); return xs.includes("adv") ? "adv" : xs.includes("not") ? "not" : null; }
  if (!("fact" in p)) return null;
  if (!/metast|(^|_)m_(category|stage)$|stage_iv/.test(p.fact)) return null;
  const v = p.value;
  if (p.op === "==") return v === true || (typeof v === "string" && /^M1/.test(v)) ? "adv" : v === false || (typeof v === "string" && /^M0/.test(v)) ? "not" : null;
  if (p.op === "!=") return v === true ? "not" : v === false ? "adv" : null;
  return null;
}

/** The need an entry box belongs to, from what it says and what it requires. */
function rootClass(g: Graph, id: string): Phase {
  const t = cleanText(g, id);
  const sig = metSignal(g.preds[id]);
  if (t.length <= 90 && REC_RE.test(t)) return "recurrence";
  if (t.length <= 90 && FU_RE.test(t)) return "followup";
  if (sig) return sig === "adv" ? "advanced" : "diagnosis";
  if (t.length <= 120 && MET_RE.test(t) && !NOT_MET_RE.test(t)) return "advanced";
  return "diagnosis";
}

const NEED_ORDER: Phase[] = ["diagnosis", "followup", "recurrence", "advanced", "later"];
/** The need a page's entry boxes serve. A page with entries of different kinds (REC-2: no distant
 * metastases / distant metastases) is a presentation page: it serves the first kind in order. */
export function entryClass(g: Graph, page: string): Phase | null {
  const roots = g.bundle.roots[page] ?? [];
  if (!roots.length) return null;
  const cls = new Set(roots.map((r) => rootClass(g, r)));
  return NEED_ORDER.find((c) => cls.has(c)) ?? "diagnosis";
}

/** The entry box that stands for a page in the list of settings. */
function primaryRoot(g: Graph, page: string): string | null {
  const roots = g.bundle.roots[page] ?? [];
  const c = entryClass(g, page);
  return roots.find((r) => rootClass(g, r) === c) ?? roots[0] ?? null;
}

/** An entry text in plain clinical words. */
export function plainSetting(text: string, need: Phase): string {
  let t = text.replace(/\s*\([A-Z]+-[A-Z0-9]+\)\s*$/, "").trim();
  if (t.length > 3 && t === t.toUpperCase()) t = t.toLowerCase();   // a heading in capitals
  if (/polyp/i.test(t) && /invasive|cancer|carcinoma/i.test(t)) return "Malignant polyp (invasive cancer in a polyp)";
  const without = /^(.+?)\s+(?:without|with no)\s+(?:suspected or proven\s+)?(?:distant\s+)?metasta/i.exec(t);
  if (need === "diagnosis" && without) return `${upperFirst(without[1])}, no distant metastases (localized or locally advanced)`;
  if (need === "advanced" && /synchronous|at (initial )?(diagnosis|presentation)|\bT any\b/i.test(t)) return "Metastatic (M1) at presentation";
  return clipText(upperFirst(t), 80);
}

export interface Setting extends Moment {
  /** the setting in plain clinical words */
  label: string;
  /** what the entry box says, or the page it starts at */
  sub: string;
  /** details the setting itself states (the entry box requires them) */
  implied: Facts;
  /** true: the label is the page title, so the page code follows it */
  byTitle: boolean;
}

/** Details an entry box states outright (`fact == value`, a bool `!= true`), except the disease. */
function impliedFacts(g: Graph, root: string): Facts {
  const vars = g.bundle.schema?.variables ?? {};
  const sv = g.bundle.sections?.variable;
  const out: Facts = {};
  const walk = (p: Pred | null | undefined) => {
    if (!p) return;
    if ("all" in p) { p.all.forEach(walk); return; }
    if (!("fact" in p) || p.fact === sv) return;
    const spec = vars[p.fact];
    if (!spec) return;
    if (p.op === "==" && (typeof p.value === "boolean" || typeof p.value === "string")) {
      if (spec.type === "bool" ? typeof p.value === "boolean" : spec.type === "enum" && (spec.values ?? []).includes(p.value as string)) out[p.fact] = p.value;
    } else if (p.op === "!=" && spec.type === "bool" && typeof p.value === "boolean") out[p.fact] = !p.value;
  };
  walk(g.preds[root]);
  return out;
}

/** Does a page's entry box say it is the page's own heading ("CLINICAL STAGE (REC-6)")? Such a
 * page continues a route from another page; it is not a place to start. */
function isContinuation(g: Graph, page: string): boolean {
  const roots = g.bundle.roots[page] ?? [];
  return roots.length > 0 && roots.every((r) => cleanText(g, r).includes(`(${page})`));
}

/** The pages each page hands over to: arrows to other pages, links, and references in boxes. */
const reachCache = new WeakMap<Graph, Map<string, Set<string>>>();
function pageHandovers(g: Graph): Map<string, Set<string>> {
  let m = reachCache.get(g);
  if (m) return m;
  const out = new Map<string, Set<string>>();
  const link = (q: string, p: string) => { if (p !== q && g.bundle.pages[p]) (out.get(q) ?? out.set(q, new Set()).get(q)!).add(p); };
  for (const [id, ks] of Object.entries(g.bundle.children)) ks.forEach((k) => link(id.split(":")[0], k.split(":")[0]));
  g.bundle.links.forEach(([q, p]) => link(q, p));
  for (const [code, hits] of g.refIndex) hits.forEach((h) => { if (h.via === "box") link(h.page, code); });
  m = out;
  reachCache.set(g, m);
  return m;
}
export function reaches(g: Graph, from: string, to: string): boolean {
  const out = pageHandovers(g);
  const seen = new Set([from]), st = [from];
  while (st.length) for (const n of out.get(st.pop()!) ?? []) { if (n === to) return true; if (!seen.has(n)) { seen.add(n); st.push(n); } }
  return false;
}

/** Text that is only page codes ("CRIT-3 (CRIT-3)", "AMYL-1 2 of 2"): it names no setting. */
export const onlyCodes = (t: string) => !t.replace(/\b[A-Z]{1,8}-\d+[A-Z]?\b(\s+\d+ of \d+)?/gi, "").replace(/[^a-z]/gi, "");

/** Describe a moment as a setting the clinician can recognise. */
export function describeSetting(g: Graph, m: Moment): Setting {
  const roots = g.bundle.roots[m.page] ?? [];
  const classes = new Set(roots.map((r) => rootClass(g, r)));
  const root = primaryRoot(g, m.page);
  // several entry boxes of one kind (three kinds of recurrence): the page title says it best
  const text = root ? cleanText(g, root) : "";
  // (a title that names the need — "Recurrence" — also says it best when entries differ by pattern;
  // a bulleted list of workup steps is not a description of the patient)
  const byTitle = !root || phaseOf(m.title) !== null || (roots.length > 1 && classes.size === 1) || /[•◦▪]/.test(text) || text.length > 110 || text.replace(/[^a-z]/gi, "").length < 8 || onlyCodes(text);   // ("CR or PR" says little)
  // (a page whose title is only its code says nothing: its entry text, without bullets, does)
  const useText = byTitle && onlyCodes(m.title) && !!text && !onlyCodes(text);
  const label = useText ? plainSetting(text.replace(/[•◦▪]\s*/g, "").trim(), m.phase) : byTitle ? m.title : plainSetting(text, m.phase);
  const entries = roots.slice(0, 2).map((r) => cleanText(g, r)).filter(Boolean).join(" · ");
  const sub = byTitle ? clipText(entries, 90) : `${m.title} (${m.page})`;
  // (a setting that states several details at once is too much to answer for the clinician)
  const said = byTitle || !root ? {} : impliedFacts(g, root);
  return { ...m, label, sub, byTitle, implied: Object.keys(said).length <= 2 ? said : {} };
}

/** The settings to offer for one need: its start pages, less those that another start page of
 * the same need leads to (REC-6 is reached through the workup page) and pages that only continue
 * a route from elsewhere. */
export function settingsFor(g: Graph, list: Moment[], need: Phase): Setting[] {
  const mine = list.filter((m) => m.phase === need);
  const real = mine.filter((m) => !isContinuation(g, m.page));
  const base = real.length ? real : mine;
  const shown = base.filter((m) => !base.some((o) => o.page !== m.page && reaches(g, o.page, m.page)
    && !(reaches(g, m.page, o.page) && order(m.page, o.page) < 0)));
  return (shown.length ? shown : base).map((m) => describeSetting(g, m));
}

/** The need a start setting belongs to ("auto" and pages that are not moments: none). */
export function needOf(g: Graph, start: string): Phase | null {
  if (start === "auto" || !g.bundle.pages[start]) return null;
  return phaseOf(g.bundle.pages[start].title || "") ?? moments(g).find((m) => m.page === start)?.phase ?? null;
}

/* ---------------- no recommendation fits: which gate says so ---------------- */

export interface Gate { node: string; page: string; text: string; facts: string[] }

/** One sentence naming the gate (from the engine's `whyNothingFits`) and the answers that closed it. */
export function gateSentence(g: Graph, gate: Gate, facts: Facts): string {
  // only the disease or subtype was chosen: no answer contradicts anything, the data simply has no route for it
  const sv = g.bundle.sections?.variable;
  if (sv && gate.facts.length > 0 && gate.facts.every((f) => f === sv)) return "No route is encoded for this disease or subtype yet: open its pages in the diagram, or choose another.";
  const title = g.bundle.pages[gate.page]?.title;
  const name = title && title !== gate.page ? `${title} (${gate.page})` : gate.page;
  const need = (g.bundle.roots[gate.page] ?? []).includes(gate.node) ? rootClass(g, gate.node) : "diagnosis";
  const plain = plainSetting(gate.text, need);
  const what = /^Metastatic \(M1\)/.test(plain) ? "metastatic (M1) disease" : lowerFirst(plain);
  const said = gate.facts.filter((f) => facts[f] !== undefined).slice(0, 2)
    .map((f) => `${valueLabel(facts[f])} to ${factLabel(f).toLowerCase()}`);
  return `‘${name}’ is for ${what}${said.length ? `; you answered ${said.join(" and ")}.` : "."}`;
}
