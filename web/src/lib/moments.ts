/**
 * Clinical moments: where in the course of the disease the patient is now. Each guideline's
 * algorithm starts at pages for a new diagnosis (pages nothing else leads to) and has pages for
 * later moments (surveillance, recurrence, advanced disease, later lines), named in their titles.
 * Picking a moment starts the algorithm there and limits the form to the details its branches use.
 */
import type { Facts, Pred } from "../types";
import type { Graph } from "./graph";
import { missingFacts } from "./pathways";

export type Phase = "diagnosis" | "followup" | "recurrence" | "advanced" | "later";
export const PHASES: { id: Phase; label: string; hint: string }[] = [
  { id: "diagnosis", label: "New diagnosis", hint: "Workup and first treatment" },
  { id: "followup", label: "Follow-up", hint: "Surveillance after treatment" },
  { id: "recurrence", label: "Recurrence or relapse", hint: "Recurrent, relapsed, refractory or progressing disease" },
  { id: "advanced", label: "Advanced or metastatic", hint: "Stage IV, metastatic or castration-resistant disease" },
  { id: "later", label: "Later-line therapy", hint: "Subsequent cycles or lines of therapy" },
];

export interface Moment { page: string; title: string; phase: Phase }

/** The phase a later-state page belongs to, from its title; null for an ordinary page. */
export function phaseOf(title: string): Phase | null {
  const t = title.toLowerCase();
  if (/recurren|relaps|refractor|progress|persist|second biochemical|bcr2|transformation/.test(t)) return "recurrence";
  if (/metasta|stage iv|\badvanced\b|castration|crpc|\bm1\b|unresectable/.test(t)) return "advanced";
  if (/surveillance|follow-?up|post-?treatment|survivorship/.test(t)) return "followup";
  if (/subsequent|second-line|later line/.test(t)) return "later";
  return null;
}

const order = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** The moments a guideline's algorithm starts from: its start pages (new diagnosis, unless the
 * title says otherwise) and the later-state pages that have entry boxes. */
export function moments(g: Graph): Moment[] {
  const b = g.bundle;
  const linked = new Set<string>();
  for (const [id, ks] of Object.entries(b.children)) ks.forEach((k) => { if (k.split(":")[0] !== id.split(":")[0]) linked.add(k.split(":")[0]); });
  b.links.forEach(([q, p]) => { if (q !== p) linked.add(p); });
  const roots = g.flowPages.filter((p) => (b.roots[p] ?? []).length);
  const out: Moment[] = [];
  for (const p of roots) {
    const title = b.pages[p].title || p;
    const ph = phaseOf(title);
    if (!linked.has(p)) out.push({ page: p, title, phase: ph ?? "diagnosis" });
    else if (ph) out.push({ page: p, title, phase: ph });
  }
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
  const v = sec && facts[sec.variable];
  if (!sec || v === undefined) return all;
  const mine = all.filter((m) => !sec.pages[m.page] || sec.pages[m.page] === v);
  return mine.length ? mine : all;
}

/** Raw details that decide any branch reachable from these pages (following links between pages). */
export function reachableFacts(g: Graph, pages: string[]): Set<string> {
  const seen = new Set<string>();
  const facts = new Set<string>();
  const stack = pages.flatMap((p) => g.bundle.roots[p] ?? []);
  const add = (p: Pred | null | undefined) => { if (p) for (const f of missingFacts(g, p, {})) facts.add(f); };
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = g.node(id);
    add(g.preds[id]); add(n?.linkCond); add(n?.received);
    for (const k of g.kids(id)) if (!seen.has(k)) stack.push(k);
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
  if (start === "auto" || !g.bundle.pages[start]) return null;
  return phaseOf(g.bundle.pages[start].title || "") ?? (moments(g).some((m) => m.page === start) ? "diagnosis" : null);
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
