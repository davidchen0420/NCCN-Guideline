/**
 * Clinical moments: where in the course of the disease the patient is now. Each guideline's
 * algorithm starts at pages for a new diagnosis (pages nothing else leads to) and has pages for
 * later moments (surveillance, recurrence, advanced disease, later lines), named in their titles.
 * Picking a moment starts the algorithm there and limits the form to the details its branches use.
 */
import type { Facts, Pred } from "../types";
import { entryHeadsByGroup, isPostSurgicalTitle, pageLeads, stateOfEntries, stateOfTitle, statesOfTitle, withoutRisk, type Graph } from "./graph";
import { missingFacts, rankPathways, type Ranking } from "./pathways";
import { decidingFacts, type Decider } from "./formAssist";
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

export interface Moment {
  page: string; title: string; phase: Phase;
  /** a page after surgery (pathologic stage, adjuvant treatment): a setting of its own beside the clinical one */
  post?: boolean;
}

/** The phase a later-state page belongs to, from its title; null for an ordinary page. */
export const phaseOf = (title: string): Phase | null => stateOfTitle(title);

const order = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** The phase a page belongs to by what its entry boxes say, when its title does not: a page
 * titled "Radical Prostatectomy PSA" opens on "PSA persistence/recurrence". */
export const entryPhase = (g: Graph, page: string): Phase | null => stateOfEntries(g, page);

/** What a page's title and its entry boxes each say about the need it serves. A title can name two
 * ("Stage IV (M1) or Recurrent Disease"): the page then serves both. */
const needsCache = new WeakMap<Graph, Map<string, { title: Phase[]; entry: Phase[] }>>();
function needsOf(g: Graph, page: string): { title: Phase[]; entry: Phase[] } {
  let m = needsCache.get(g);
  if (!m) needsCache.set(g, (m = new Map()));
  let r = m.get(page);
  if (!r) m.set(page, (r = { title: statesOfTitle(g.bundle.pages[page]?.title || ""), entry: entryClasses(g, page) }));
  return r;
}
/** The needs a page serves: its title's when the title names one, else its entry boxes'. */
export const pageNeeds = (g: Graph, page: string): Phase[] => {
  const n = needsOf(g, page);
  return n.title.length ? n.title : n.entry.length ? n.entry : ["diagnosis"];
};

/** Does a page open after surgery: a title that says so, or entry boxes that are pathologic stages (pT3, N0)? */
export function isPostSurgical(g: Graph, page: string): boolean {
  if (isPostSurgicalTitle(g.bundle.pages[page]?.title || "")) return true;
  const roots = g.bundle.roots[page] ?? [];
  return roots.length > 0 && roots.every((r) => /\b(?:yp|p)T(?:is|[0-4X])/.test(cleanText(g, r)));
}

/** A box that gives a schedule for repeating tests ("H&P every 3–6 mo for 2 y", "annual CEA"). */
const SCHEDULE_RE = /\bevery\s+\d+(?:\s*[–-]\s*\d+)?\s*(?:mo|months?|wk|weeks?|y|years?)\b|\bannual(?:ly)?\b/i;
/** The page where treatment ends and watching begins. Its title may only name the stage
 * ("Pathologic Stage"), so the structure says it: many pages lead here, it leads on to a
 * recurrence page, and its boxes speak of follow-up schedules. */
function isConvergence(g: Graph, page: string): boolean {
  const leads = pageLeads(g);
  let inbound = 0;
  for (const [q, to] of leads) if (q !== page && to.has(page)) inbound++;
  if (inbound < 3) return false;
  const next = [...(leads.get(page) ?? [])];
  if (!next.some((n) => needsOf(g, n).title.includes("recurrence") || needsOf(g, n).entry.includes("recurrence"))) return false;
  return g.bundle.pages[page].nodes.filter((n) => n.kind !== "header" && SCHEDULE_RE.test(stripMarks(n.text))).length >= 2;
}

/** The needs a page in the middle of the algorithm can be a setting for: what its title or entry
 * boxes clearly state. An ordinary treatment page is none. */
function settingNeeds(g: Graph, page: string): Phase[] {
  const { title, entry } = needsOf(g, page);
  if (title.length) return title;
  const later = entry.filter((e) => e !== "diagnosis");
  if (later.length && !entry.includes("diagnosis")) return later;
  if (isConvergence(g, page)) return ["followup"];
  return [];
}

/** The moments a guideline's algorithm starts from: the first page of the algorithm and of each
 * disease (a new diagnosis, unless the title or entry says otherwise), the pages after surgery,
 * and the later-state pages that state a setting. A page can serve two needs and is then listed twice. */
export function moments(g: Graph): Moment[] {
  const b = g.bundle;
  const sec = b.sections;
  const secOf = (p: string) => (sec?.pages?.[p] ?? null) as string | null;
  const rooted = g.flowPages.filter((p) => (b.roots[p] ?? []).length);
  const out = new Map<string, Moment>();
  const add = (p: string, phase: Phase, post = false) => {
    const k = `${p}|${phase}`;
    if (!out.has(k)) out.set(k, { page: p, title: b.pages[p].title || p, phase, ...(post ? { post: true } : {}) });
  };
  // the groups of pages that have a first page of their own: the shared pages, each disease's pages
  // (the shared pages start where nothing at all leads to them; a disease starts where nothing of its own does)
  const scopes: string[][] = entryHeadsByGroup(g);
  const heads = new Set<string>();
  for (const hs of scopes) {
    hs.forEach((h) => heads.add(h));
    const info = hs.map((h) => ({ h, needs: pageNeeds(g, h), byTitle: needsOf(g, h).title.length > 0 }));
    info.forEach((x) => x.needs.forEach((ph) => add(x.h, ph)));
    // no first workup among them (their title or entry boxes speak of a later need): the first
    // page that is not about a recurrence is where the workup begins
    if (info.length && !info.some((x) => x.needs.includes("diagnosis"))) {
      const pick = info.find((x) => !x.byTitle) ?? [...info].sort((x, y) => order(x.h, y.h)).find((x) => !x.needs.includes("recurrence")) ?? info[0];
      add(pick.h, "diagnosis");
    }
  }
  for (const p of rooted) {
    if (heads.has(p)) continue;
    const needs = settingNeeds(g, p);
    if (isPostSurgical(g, p) && !needs.includes("followup")) add(p, "diagnosis", true);
    needs.forEach((ph) => add(p, ph));
  }
  return [...out.values()].sort((x, y) => order(x.page, y.page) || NEED_ORDER.indexOf(x.phase) - NEED_ORDER.indexOf(y.phase));
}

/** Screening, prevention and supportive-care guidelines follow a programme, not a disease course. */
export const followsDisease = (title: string) =>
  !/screening|detection|risk reduction|cessation|prevention|survivorship|fatigue|pain|distress|emesis|nausea|anemia|neutropenia|infection|palliative|older adult|adolescent|thrombo|supportive|genetic|familial|hereditary|cachexia|smoking/i.test(title);

/** Do a shared page's entry boxes state a setting of the patient (distant metastases or not)
 * rather than list workup steps? Every entry box has a condition on a detail other than the disease. */
function statesSetting(g: Graph, page: string): boolean {
  const roots = g.bundle.roots[page] ?? [];
  const sv = g.bundle.sections?.variable;
  return roots.length > 0 && roots.every((r) => g.preds[r] && missingFacts(g, g.preds[r], {}).some((f) => f !== sv));
}

/** Does any route start at this shared page for a patient of this disease (the entry conditions
 * do not rule out the disease)? Worked out once per page and disease. */
const viableCache = new WeakMap<Graph, Map<string, boolean>>();
function viableFor(g: Graph, page: string, section: string): boolean {
  let m = viableCache.get(g);
  if (!m) viableCache.set(g, (m = new Map()));
  const key = `${page}|${section}`;
  let v = m.get(key);
  if (v === undefined) {
    const sv = g.bundle.sections!.variable;
    v = rankPathways(g, { [sv]: section, ...impliedBySection(g, section) }, page).paths.length > 0;
    m.set(key, v);
  }
  return v;
}

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
  // The disease's own first page begins its new-diagnosis moment; the shared diagnostic-testing
  // page that lists every disease (workup steps, no patient setting) does not.
  const ownFirst = mine.some((m) => m.phase === "diagnosis" && !m.post && secOf(m.page) === v);
  const ownPages = g.flowPages.filter((p) => secOf(p) === v);
  // (a shared first page stays when it states a setting of the patient and leads into the disease's own pages:
  // "no distant metastases" at REC-2 does; a list of workup steps, or the page of another gene, does not)
  const leadsIn = (p: string) => ownPages.some((q) => reaches(g, p, q));
  const kept = mine.filter((m) => !(ownFirst && m.phase === "diagnosis" && secOf(m.page) === null && !(statesSetting(g, m.page) && leadsIn(m.page)))
    // (a shared page whose entry conditions are about other diseases leads nowhere for this one)
    && (secOf(m.page) !== null || viableFor(g, m.page, v as string)));
  return kept.length ? kept : all;
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
const upperFirst = (t: string) => (t && !/^[a-z]{1,2}[A-Z0-9]/.test(t) ? t[0].toUpperCase() + t.slice(1) : t);   // (pT3 and ypN0 keep their small first letter)
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

/** The needs an entry box belongs to, from what it says and what it requires. "Stage IV (M1) or
 * Recurrent" is both a metastatic and a recurrence setting. */
function rootClasses(g: Graph, id: string): Phase[] {
  const t = cleanText(g, id);
  const sig: "adv" | "not" | null = null;   // (the condition drafted for a box is not evidence of what its text says)
  const out: Phase[] = [];
  if (t.length <= 90 && REC_RE.test(withoutRisk(t))) out.push("recurrence");
  if (t.length <= 90 && FU_RE.test(t)) out.push("followup");
  if (sig === "adv" || (!sig && t.length <= 120 && MET_RE.test(t) && !NOT_MET_RE.test(t))) out.push("advanced");
  return out.length ? out : ["diagnosis"];
}
/** The first need an entry box serves (the one its setting text is written for). */
const rootClass = (g: Graph, id: string): Phase => rootClasses(g, id)[0];

const NEED_ORDER: Phase[] = ["diagnosis", "followup", "recurrence", "advanced", "later"];
const needRank = (p: Phase) => NEED_ORDER.indexOf(p);
/** The needs a page's entry boxes serve. A page with entries of different kinds (REC-2: no distant
 * metastases / distant metastases) is a presentation page: it serves the first kind in order. */
export function entryClasses(g: Graph, page: string): Phase[] {
  const roots = g.bundle.roots[page] ?? [];
  if (!roots.length) return [];
  const per = roots.map((r) => rootClasses(g, r));
  const first = Math.min(...per.map((cs) => Math.min(...cs.map(needRank))));
  return NEED_ORDER.filter((c) => per.some((cs) => Math.min(...cs.map(needRank)) === first && cs.includes(c)));
}
/** The first need a page's entry boxes serve. */
export function entryClass(g: Graph, page: string): Phase | null {
  return entryClasses(g, page)[0] ?? null;
}

/** The entry box that stands for a page in the list of settings (for the need asked, when given). */
function primaryRoot(g: Graph, page: string, need?: Phase): string | null {
  const roots = g.bundle.roots[page] ?? [];
  const c = need ?? entryClass(g, page);
  return roots.find((r) => rootClasses(g, r).includes(c as Phase)) ?? roots.find((r) => rootClass(g, r) === entryClass(g, page)) ?? roots[0] ?? null;
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

/** A title with its cut-off tail removed ("Adjuvant Treatment (Up to 6 Mo Perioperative") and its page code. */
export function tidyTitle(title: string): string {
  let t = title.replace(/\s+/g, " ").trim();
  if (t.split("(").length > t.split(")").length) t = t.replace(/\s*\([^)]*$/, "");   // an unclosed bracket: the title was cut
  t = t.replace(/\s*\((?:[A-Z]+-[A-Z0-9]+|SEE [A-Z]+-\d+[^)]*)\)\s*$/i, "").trim();
  t = t.replace(/\b(Stage|Grade|Type|Class|Group)\s+(Iv|Iii|Ii|Vi{1,3}|Ix)\b/g, (_, w: string, r: string) => `${w} ${r.toUpperCase()}`);
  if (t.length > 3 && t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  return t;
}
/** Text for comparing two descriptions: letters and digits only, page codes and case dropped. */
const sameKey = (t: string) => t.replace(/\(?\b[A-Z]{1,8}-\d+[A-Z]?\b\)?/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const BULLET = /[•◦▪]/;
/** An entry box as one line of plain words: bullet lists become items separated by semicolons. */
export function oneLine(text: string, n = 90): string {
  const items = text.split(BULLET).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  return clipText(items.join("; "), n);
}

/** Is a page also entered from somewhere that neither the other page nor what follows it leads to
 * (NSCL-15 from the stage pages, as well as from the recurrence page NSCL-18)? Then it is not just
 * a continuation of the other page: a patient can be at it without having been there. */
export function hasOwnEntry(g: Graph, page: string, other: string): boolean {
  const leads = pageLeads(g);
  for (const [q, to] of leads) {
    if (q === page || q === other || !to.has(page)) continue;
    if (!reaches(g, other, q) && !reaches(g, page, q)) return true;
  }
  return false;
}

/** Describe a moment as a setting the clinician can recognise. */
export function describeSetting(g: Graph, m: Moment): Setting {
  const roots = g.bundle.roots[m.page] ?? [];
  const classes = new Set(roots.map((r) => rootClass(g, r)));
  const root = primaryRoot(g, m.page, m.phase);
  const text = root ? cleanText(g, root) : "";
  const title = tidyTitle(m.title) || m.title;
  // (a page that opens after surgery is named by its title: "Pathologic Stage" is the setting)
  // several entry boxes of one kind (three kinds of recurrence): the page title says it best
  // (a title that names the need — "Recurrence" — also says it best when entries differ by pattern;
  // a bulleted list of workup steps is not a description of the patient)
  const byTitle = !root || !!m.post || needsOf(g, m.page).title.length > 0 || (roots.length > 1 && classes.size === 1) || BULLET.test(text) || text.length > 110 || text.replace(/[^a-z]/gi, "").length < 8 || onlyCodes(text);   // ("CR or PR" says little)
  // (a page whose title is only its code says nothing: its entry text, without bullets, does)
  const useText = byTitle && onlyCodes(m.title) && !!text && !onlyCodes(text);
  let label = useText ? plainSetting(oneLine(text, 200).replace(/;\s*/g, ", "), m.phase) : byTitle ? title : plainSetting(text, m.phase);
  if (m.post && !/^after|post/i.test(label)) label = `After surgery: ${label}`;
  // (a page found to be the follow-up by its place in the algorithm, not by its title, is named for what it is)
  const viaPlace = m.phase === "followup" && !statesOfTitle(m.title).includes("followup");
  if (viaPlace) label = "Surveillance after treatment";
  const entries = roots.slice(0, 2).map((r) => oneLine(cleanText(g, r), 60)).filter(Boolean).join(" · ");
  // (the entry text restating the title, or the page code, says nothing more)
  let sub = viaPlace ? `${title} (${m.page})` : byTitle ? (sameKey(entries) === sameKey(label) || sameKey(entries) === sameKey(m.title) || onlyCodes(entries) ? "" : clipText(entries, 90)) : `${title} (${m.page})`;
  if (!byTitle && sameKey(title) === sameKey(label)) sub = "";
  // (a setting that states several details at once is too much to answer for the clinician)
  const said = byTitle || !root ? {} : impliedFacts(g, root);
  return { ...m, label, sub, byTitle: byTitle && !viaPlace, implied: Object.keys(said).length <= 2 ? said : {} };
}

/** The settings to offer for one need: its start pages, less those that another start page of
 * the same need leads to (REC-6 is reached through the workup page) and pages that only continue
 * a route from elsewhere. A page after surgery is a setting beside the clinical ones even though
 * the clinical pages lead to it. */
export function settingsFor(g: Graph, list: Moment[], need: Phase): Setting[] {
  const mine = list.filter((m) => m.phase === need);
  const real = mine.filter((m) => !isContinuation(g, m.page));
  const base = real.length ? real : mine;
  const shown = base.filter((m) => !base.some((o) => o.page !== m.page && (!m.post || o.post) && reaches(g, o.page, m.page)
    && !(reaches(g, m.page, o.page) && order(m.page, o.page) < 0) && !hasOwnEntry(g, m.page, o.page)));
  const out = (shown.length ? shown : base).map((m) => describeSetting(g, m));
  // two settings with the same name ("Initial Treatment", "Initial Treatment") are told apart by what their entry boxes say
  const seen = new Map<string, Setting[]>();
  out.forEach((s) => seen.set(sameKey(s.label), [...(seen.get(sameKey(s.label)) ?? []), s]));
  for (const dup of seen.values()) if (dup.length > 1) for (const s of dup) {
    // (the first entry box that reads as a short sentence, not a list of steps)
    const root = (g.bundle.roots[s.page] ?? []).find((r) => { const x = cleanText(g, r); return !BULLET.test(x) && x.length >= 8 && x.length <= 90 && !onlyCodes(x); });
    const t = root ? plainSetting(cleanText(g, root), s.phase) : "";
    if (t && !onlyCodes(t) && sameKey(t) !== sameKey(s.label) && !dup.some((o) => o !== s && sameKey(o.label) === sameKey(t))) {
      s.sub = s.label; s.label = s.post && !/^after|post/i.test(t) ? `After surgery: ${t}` : t; s.byTitle = false;
    }
  }
  return out;
}

/** Moments, worked out once per guideline. */
const momentCache = new WeakMap<Graph, Moment[]>();
export function momentsOf(g: Graph): Moment[] {
  let m = momentCache.get(g);
  if (!m) momentCache.set(g, (m = moments(g)));
  return m;
}

/** The need a start setting belongs to ("auto" and pages that are not moments: none). */
export function needOf(g: Graph, start: string): Phase | null {
  if (start === "auto" || !g.bundle.pages[start]) return null;
  // (a disease's own start page is not a moment of the whole guideline: its entry boxes say what it is for)
  return momentsOf(g).find((m) => m.page === start)?.phase ?? phaseOf(g.bundle.pages[start].title || "") ?? entryClass(g, start);
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

/* ---------------- what the chosen disease already says ---------------- */

const normName = (x: unknown) => String(x).toLowerCase().replace(/[^a-z0-9]/g, "");
const GENERIC_VALUE = new Set(["positive", "negative", "unknown", "other", "none", "present", "absent", "localized", "regional", "advanced", "metastatic", "recurrent", "progressive", "intermediate", "not_tested", "nottested"]);
const sectionImpliedCache = new WeakMap<Graph, Map<string, Facts>>();

/**
 * Details the chosen disease or subtype already states: a question whose answer is a subtype of
 * the section ("pMMR/MSS Colon Cancer" answers "Mismatch repair status: pMMR_MSS") is not asked.
 * Read from the data without per-guideline rules: the one value of a detail whose name is part of
 * the section's name (a value naming the subtype, not a generic one such as "positive").
 */
export function impliedBySection(g: Graph, section: string): Facts {
  const sec = g.bundle.sections;
  if (!sec) return {};
  let byGraph = sectionImpliedCache.get(g);
  if (!byGraph) sectionImpliedCache.set(g, (byGraph = new Map()));
  const hit = byGraph.get(section);
  if (hit) return hit;
  const vars = g.bundle.schema?.variables ?? {};
  const out: Facts = {};
  const words = (x: string) => x.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  /** the words of a value occur in a row among the words of a section name */
  const within = (value: string, sectionName: string) => {
    const v = words(value), sw = words(sectionName);
    return v.length > 0 && sw.some((_, i) => v.every((w, j) => sw[i + j] === w));
  };
  for (const [name, spec] of Object.entries(vars)) {
    if (name === sec.variable || spec.type !== "enum") continue;
    const hits = (spec.values ?? []).filter((v) => {
      const n = normName(v);
      if (GENERIC_VALUE.has(n) || n.length < 4 || !within(v, section)) return false;
      // (a word that most sections of the guideline share — "lymphoma" — names no subtype)
      if (sec.values.filter((o) => within(v, o)).length > Math.max(1, Math.floor(sec.values.length / 3))) return false;
      // a value that names the subtype: several words, a long word, or the section's first word ("Adult Antiemesis")
      return words(v).length >= 2 || n.length >= 8 || words(section)[0] === words(v)[0];
    });
    if (hits.length === 1) out[name] = hits[0];
  }
  byGraph.set(section, out);
  return out;
}

/* ---------------- the questions to ask ---------------- */

const EVENT_BOX = /\b(recurrence|recurrent|relapse|relapsed|progression|progressive|persistence|persistent|refractory)\b/i;
const clipBox = (t: string, n = 90) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);

/** Is a page a stage later than the one the start setting is for (follow-up, recurrence, a later
 * line, or what comes after surgery for a patient who is before it)? Its questions are not needed
 * for the first recommendation. "auto" (no setting chosen) knows no stage. */
export function isLaterStage(g: Graph, start: string, page: string): boolean {
  if (start === "auto" || !g.bundle.pages[start] || page === start) return false;
  const mine = new Set(momentsOf(g).filter((m) => m.page === start).map((m) => m.phase));
  if (!mine.size) pageNeeds(g, start).forEach((n) => mine.add(n));
  const theirs = momentsOf(g).filter((m) => m.page === page);
  const later = (ph: Phase) => ph === "followup" || ph === "recurrence" || ph === "later";
  if (theirs.some((m) => later(m.phase)) && ![...mine].some(later)) return true;
  // after surgery: pathologic details are not known before it
  return isPostSurgical(g, page) && !isPostSurgical(g, start) && ![...mine].some(later) && !reaches(g, page, start);
}

/** Details the data itself defines as found only later in the course: on restaging, on re-evaluation,
 * after neoadjuvant treatment, in the resected specimen. */
const LATER_DETAIL = /\brestag\w*|\bre-?evaluat\w*|\bresponse (?:to|on|after)\b|\bresected (?:tumor|lesion|specimen|polyp)|\bof the resected\b|\bspecimen\b|\bafter (?:surgery|resection|neoadjuvant|induction|chemoradi\w*|completion|treatment)\b|\bpost-?(?:operative|surgical|treatment)\b|\bsurgical pathology\b/i;
export function isLaterDetail(g: Graph, fact: string): boolean {
  const spec = g.bundle.schema?.variables?.[fact];
  return !!spec && LATER_DETAIL.test(`${fact.replace(/_/g, " ")} ${spec.definition ?? ""} ${spec.criteria ?? ""}`);
}

/**
 * The details to ask next. The ones that decide the open routes (formAssist); when none does and
 * the start is a page that only lists steps (a workup, a table), the details that decide where it
 * leads on, found by walking forward from the routes' ends to the nearest conditions on facts
 * still unknown, so the interview never has nothing to ask while the way on is undecided. What
 * only matters after a later stage (follow-up pages, the pathologic details after surgery) is
 * left out for a patient who is not there yet.
 */
export function askableQuestions(g: Graph, ranking: Ranking, facts: Facts, start: string, keep: (fact: string) => boolean = () => true, limit = 8): Decider[] {
  const vars = g.bundle.schema?.variables ?? {};
  const known = (f: string) => facts[f] !== undefined && facts[f] !== null && facts[f] !== "";
  // at a first workup (not after surgery), what the data itself defines as found on restaging, on
  // re-evaluation or in the resected specimen cannot be known yet
  const first = start !== "auto" && !!g.bundle.pages[start] && !isPostSurgical(g, start) && pageNeeds(g, start).every((n) => n === "diagnosis" || n === "advanced");
  const ok = (d: Decider) => !!vars[d.fact] && !known(d.fact) && keep(d.fact) && !isLaterStage(g, start, d.page) && !(first && isLaterDetail(g, d.fact));
  const base = decidingFacts(g, ranking, facts, 24).filter(ok);
  if (base.length || !ranking.paths.length) return base.slice(0, limit);
  return questionsAhead(g, ranking, facts).filter(ok).slice(0, limit);
}

/** Walk forward from where the open routes stop, level by level, to the first conditions that still
 * have unknown details; skip boxes that only name a later event (recurrence, progression). */
export function questionsAhead(g: Graph, ranking: Ranking, facts: Facts, depth = 8): Decider[] {
  const paths = ranking.paths.slice(0, 6);
  let level: string[] = [];
  const jump = (id: string) => (g.node(id)?.links ?? []).filter((l) => l !== id.split(":")[0] && g.bundle.pages[l]).flatMap((l) => g.bundle.roots[l] ?? []);
  for (const p of paths) {
    level.push(...p.next);
    if (p.continuesTo && g.bundle.pages[p.continuesTo]) level.push(...(g.bundle.roots[p.continuesTo] ?? []));
    const last = p.steps[p.steps.length - 1]?.node;
    if (last && !p.next.length) level.push(...jump(last));
  }
  const seen = new Set<string>();
  for (let d = 0; d < depth && level.length; d++) {
    const found = new Map<string, Decider>();
    const next: string[] = [];
    for (const id of level) {
      if (seen.has(id)) continue;
      seen.add(id);
      const text = stripMarks(g.node(id)?.text ?? "").replace(/\s+/g, " ").trim();
      if (!g.preds[id] && text.split(/\s+/).length <= 6 && EVENT_BOX.test(text)) continue;
      for (const f of missingFacts(g, g.preds[id] ?? g.node(id)?.linkCond, facts)) {
        if (!found.has(f)) found.set(f, { fact: f, share: 1 / (d + 1), node: id, page: id.split(":")[0], text: clipBox(text) });
      }
      const kids = g.kids(id);
      next.push(...(kids.length ? kids : jump(id)));
    }
    if (found.size) return [...found.values()];
    level = next;
  }
  return [];
}

/** The page the open route leads to next, for showing in the diagram when nothing can be asked. */
export function nextPageOf(g: Graph, ranking: Ranking): string | null {
  const p = ranking.paths[0];
  if (!p) return null;
  if (p.continuesTo && g.bundle.pages[p.continuesTo]) return p.continuesTo;
  const last = p.steps[p.steps.length - 1]?.node;
  const own = last?.split(":")[0] ?? null;
  const out = (last && (g.node(last)?.links ?? []).find((l) => l !== own && g.bundle.pages[l])) || null;
  return out ?? (p.next[0] ? p.next[0].split(":")[0] : own);
}
