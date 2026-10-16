/**
 * AI decisions: scoring the outgoing edges of a decision node with a language model.
 *
 * The browser never talks to the model provider. It POSTs structured questions to the local
 * server (`python -m nccn_nav.serve`, endpoint /api/decide), which holds the API key. What is
 * sent is only (a) the patient's structured answers, written as "<label>: <value label>" lines
 * from the guideline's fact schema, never free text, and (b) the guideline's own text for the
 * page of the decision.
 *
 * - A branch whose children are condition arms becomes ONE `choice` question (`n:<nodeId>`):
 *   the arms plus "none".
 * - A branch whose children are treatment options becomes one `predicate` question per option
 *   (`o:<childId>`): "this option is appropriate for this patient".
 *
 * Everything except `aiStatus` and `scoreBranches` is pure, and both take an injectable fetch.
 */
import type { Facts, Pred, Schema } from "../types";
import type { Graph } from "./graph";
import { stripMarks } from "./adapt";
import { derive } from "./predicates";
import { factValue, formatNumber, label, valueLabel } from "./factMeta";

/** The API documents no limit: batch conservatively. The server enforces the same bound. */
export const MAX_QUESTIONS = 16;
/** Page text sent per page, in characters. */
export const PAGE_CHARS = 6000;
const FOOTNOTE_CHARS = 1500;
const MAX_CHOICES = 60;
const TEXT_CHARS = 300;
/** Conservative share of the server's 200 KB request limit that one batch may use. */
const MAX_REQUEST_BYTES = 150_000;
export const NONE = "none";
const NONE_TEXT = "None of these applies, or not enough information";

export interface Choice { value: string; description: string }
export interface ChoiceQuestion { type: "choice"; name: string; instructions: string; choices: Choice[] }
export interface PredicateQuestion { type: "predicate"; name: string; instructions: string }
export type Question = ChoiceQuestion | PredicateQuestion;
/** Where a question's answer goes: the decision node(s) it scores, and for an option the child. */
export interface QuestionMeta { kind: "choice" | "predicate"; page: string; nodes: string[]; child?: string }
export interface DecideRequest { input: string; questions: Question[]; meta: Record<string, QuestionMeta> }

export type Answer =
  | { type: "predicate"; name: string; probability: number }
  | { type: "choice"; name: string; choice?: string; probabilities: { value: string; probability: number }[]; confidence?: number }
  | { type: "score"; name: string; score?: number; probabilities?: { value: unknown; label?: string; probability: number }[]; confidence?: number }
  | { type: "refusal"; name: string };

// ---------------------------------------------------------------- text helpers

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
/**
 * A box's text as the question shows it: footnote marks dropped, one line, bounded. stripMarks
 * reads trailing lower-case letters after a capital as marks ("INDUCTIONe,f"), which would turn the
 * words "Low" and "High" into "L" and "H" and "cT1c" into "cT1": the last word is left alone unless
 * it is printed in capitals.
 */
export function boxText(raw: string): string {
  const t = squash(raw);
  const caps = ((t.match(/\S+$/)?.[0] ?? "").match(/[A-Z]/g) ?? []).length;
  // A trailing " ." keeps stripMarks from reading the last word's ending as marks (its other rule, glued marks inside capitals, still applies).
  const clean = caps >= 2 ? stripMarks(t) : stripMarks(`${t} .`).replace(/\s*\.$/, "");
  return clip(squash(clean), TEXT_CHARS);
}

const OP_WORDS: Record<string, string> = {
  "==": "is", "!=": "is not", ">": "is greater than", ">=": "is at least", "<": "is less than", "<=": "is at most",
  in: "is one of", not_in: "is none of",
};

/** A condition in words, from the fact labels and value labels: "Risk Group is Low and PSA is less than 10 ng/mL". */
export function predicateInWords(pred: Pred, schema: Schema | undefined | null): string {
  const text = words(pred, schema ?? { variables: {}, derived: {} }, true);
  return clip(text, 500);
}
function words(p: Pred, schema: Schema, top: boolean): string {
  if ("all" in p || "any" in p) {
    const isAll = "all" in p;
    const parts = (isAll ? p.all : (p as { any: Pred[] }).any).map((x) => words(x, schema, false));
    if (!parts.length) return "";
    const joined = parts.length === 1 ? parts[0] : parts.join(isAll ? " and " : " or ");
    return top || parts.length === 1 ? joined : `(${joined})`;
  }
  if ("not" in p) return `not (${words(p.not, schema, true)})`;
  const spec = schema.variables?.[p.fact];
  const one = (v: unknown) => (spec?.type === "number" && (typeof v === "number" || (v && typeof v === "object")) ? formatNumber(v, spec.unit).trim() : valueLabel(v));
  const op = OP_WORDS[p.op] ?? p.op;
  const value = Array.isArray(p.value) ? p.value.map(one).join(p.op === "not_in" ? " or " : ", ") : one(p.value);
  return `${label(p.fact)} ${op} ${value}`;
}

// ---------------------------------------------------------------- the patient, as text

const SAFE_DERIVED = /^[A-Za-z0-9_ .<>=+\-–≥≤/%]{1,60}$/;
const isInterval = (v: unknown): v is { min?: number | null; max?: number | null } =>
  !!v && typeof v === "object" && !Array.isArray(v) && ["min", "max"].every((k) => { const x = (v as Record<string, unknown>)[k]; return x == null || (typeof x === "number" && Number.isFinite(x)); });

/**
 * The entered facts as "<label>: <value label>" lines, in schema order, then the values derived
 * from them. Only schema variables and derived values appear, and only values of the right kind
 * (an enum value must be one the schema lists, a number a number or range): nothing a person typed
 * as free text can reach the model through here.
 */
export function factLines(g: Graph, facts: Facts): string[] {
  const schema = g.bundle.schema;
  const lines: string[] = [];
  for (const [name, spec] of Object.entries(schema?.variables ?? {})) {
    const v = facts[name];
    if (v === undefined || v === null || v === "" || v === "unknown") continue;
    const ok = spec.type === "bool" ? typeof v === "boolean"
      : spec.type === "number" ? (typeof v === "number" && Number.isFinite(v)) || isInterval(v)
      : typeof v === "string" && (spec.values ?? []).includes(v);
    if (ok) lines.push(`${label(name)}: ${factValue(name, v, schema)}`);
  }
  const full = derive(facts, schema);
  for (const name of Object.keys(schema?.derived ?? {})) {
    if (name.endsWith("_stated")) continue;
    const v = full[name];
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && SAFE_DERIVED.test(v)))
      lines.push(`${label(name)}: ${valueLabel(v)}`);
  }
  return lines;
}

/** The text of an algorithm page in reading order (boxes by position), then its footnotes; bounded. */
export function pageText(g: Graph, page: string, cap = PAGE_CHARS): string {
  const fp = g.bundle.pages[page];
  if (!fp) return "";
  const boxes = [...fp.nodes].sort((a, b) => Math.round(a.bbox[1] / 8) - Math.round(b.bbox[1] / 8) || a.bbox[0] - b.bbox[0]);
  const body = boxes.map((n) => squash(n.text)).filter(Boolean).join("\n");
  const seen = new Set<string>(), notes: string[] = [];
  for (const n of boxes) for (const [letter, text] of n.footnotes) {
    const line = `${letter}: ${squash(text)}`;
    if (!seen.has(line)) { seen.add(line); notes.push(line); }
  }
  const foot = notes.length ? clip("Footnotes:\n" + notes.join("\n"), Math.min(FOOTNOTE_CHARS, Math.floor(cap / 4))) : "";
  const room = Math.max(0, cap - foot.length - 1);
  return clip(body, room) + (foot ? "\n" + foot : "");
}

/** The `input` of a request: the patient lines, then the text of each involved page. */
export function buildInput(g: Graph, facts: Facts, pages: string[]): string {
  const lines = factLines(g, facts);
  const head = `Patient (structured answers):\n${lines.length ? lines.join("\n") : "(none entered)"}`;
  const body = [...new Set(pages)].map((p) => `[${p}] ${g.bundle.pages[p]?.title ?? ""}\n${pageText(g, p)}`).join("\n\n");
  return `${head}\n\nGuideline page text:\n${body}`;
}

// ---------------------------------------------------------------- questions

/** The children of a decision node by kind: condition arms (to choose between) and options (each judged). */
export function branchChildren(g: Graph, nodeId: string): { conds: string[]; opts: string[] } {
  const kids = [...new Set(g.kids(nodeId))].filter((k) => g.node(k));
  const opts = kids.filter((k) => g.node(k)!.decision === "option");
  const conds = kids.filter((k) => !opts.includes(k) && (g.node(k)!.decision === "condition" || !!g.preds[k]));
  return { conds: conds.length >= 2 ? conds : [], opts: opts.length >= 2 ? opts : [] };
}
/** Does the node have something to score? */
export const isScorable = (g: Graph, nodeId: string) => { const b = branchChildren(g, nodeId); return b.conds.length > 0 || b.opts.length > 0; };
/** Every decision node of a page (or of the whole guideline) that has something to score. */
export function scorableNodes(g: Graph, page?: string): string[] {
  return [...g.nodes.keys()].filter((id) => (page === undefined || g.nodes.get(id)!.page === page) && g.nodes.get(id)!.kind === "box" && isScorable(g, id));
}

interface Planned { q: Question; meta: QuestionMeta }

function plan(g: Graph, nodeId: string): Planned[] {
  const parent = g.node(nodeId);
  if (!parent) return [];
  const { conds, opts } = branchChildren(g, nodeId);
  const page = parent.page;
  const title = g.bundle.pages[page]?.title || page;
  const step = boxText(parent.text);
  const out: Planned[] = [];
  if (conds.length) {
    const choices: Choice[] = conds.slice(0, MAX_CHOICES).map((k) => {
      const text = boxText(g.node(k)!.text) || k;
      const pred = g.preds[k];
      return { value: k, description: pred ? `${text} — ${predicateInWords(pred, g.bundle.schema)}` : text };
    });
    choices.push({ value: NONE, description: NONE_TEXT });
    out.push({
      q: {
        type: "choice", name: `n:${nodeId}`, choices,
        instructions: `Guideline step: ${step}. Page: ${title} (${page}). Choose the branch whose condition the patient's facts satisfy.`,
      },
      meta: { kind: "choice", page, nodes: [nodeId] },
    });
  }
  for (const k of opts) {
    out.push({
      q: {
        type: "predicate", name: `o:${k}`,
        instructions: `This option is appropriate for this patient: ${boxText(g.node(k)!.text).replace(/[.;:]+$/, "") || k}. Guideline step: ${step}. Page: ${title} (${page}).`,
      },
      meta: { kind: "predicate", page, nodes: [nodeId], child: k },
    });
  }
  return out;
}

/** Plans for several nodes with questions of the same name (an option shared by two branches) merged. */
function planAll(g: Graph, nodeIds: string[]): Planned[] {
  const byName = new Map<string, Planned>();
  for (const id of nodeIds) for (const p of plan(g, id)) {
    const have = byName.get(p.q.name);
    if (have) { if (!have.meta.nodes.includes(id)) have.meta.nodes.push(id); } else byName.set(p.q.name, p);
  }
  return [...byName.values()];
}

/**
 * One request for the given decision nodes: a `choice` question per condition branch, a
 * `predicate` question per option. Not split into batches (see scoreBranches); question names are
 * unique. `meta` says which node (and child) each question scores.
 */
export function buildQuestions(g: Graph, facts: Facts, nodeIds: string[]): DecideRequest {
  const planned = planAll(g, nodeIds);
  return {
    input: buildInput(g, facts, planned.map((p) => p.meta.page)),
    questions: planned.map((p) => p.q),
    meta: Object.fromEntries(planned.map((p) => [p.q.name, p.meta])),
  };
}

// ---------------------------------------------------------------- server calls

export interface AiStatus { enabled: boolean; model: string }
export interface DecideOptions {
  /** injectable for tests and tools; defaults to the global fetch */
  fetch?: typeof fetch;
  /** prefix for the endpoints, e.g. "http://localhost:8000"; default: same origin */
  baseUrl?: string;
  signal?: AbortSignal;
}
export class DecideError extends Error {
  constructor(message: string, readonly status: number = 0) { super(message); this.name = "DecideError"; }
}

let statusMemo: Promise<AiStatus | null> | null = null;
/** Forget the remembered status (tests; or after the server was started). */
export const resetAiStatus = () => { statusMemo = null; };

/**
 * Is AI available here? Asks the local server once and remembers the answer. null on a file://
 * page, on any failure, or when the page is not served by nccn_nav.serve (hosted and offline
 * copies run without AI).
 */
export function aiStatus(opts: DecideOptions = {}): Promise<AiStatus | null> {
  if (statusMemo) return statusMemo;
  const f = opts.fetch ?? (typeof fetch === "function" ? fetch : undefined);
  const onFile = typeof location !== "undefined" && location.protocol === "file:";
  if (!f || (onFile && !opts.baseUrl)) return (statusMemo = Promise.resolve(null));
  const p = (async () => {
    try {
      const r = await f(`${opts.baseUrl ?? ""}/api/decide/status`, { signal: opts.signal, headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      const j = await r.json();
      return j && typeof j.enabled === "boolean" && typeof j.model === "string" ? { enabled: j.enabled, model: j.model } : null;
    } catch {
      statusMemo = null;   // a network failure may be temporary: ask again next time
      return null;
    }
  })();
  return (statusMemo = p);
}

/** The scores of one decision node. */
export interface BranchScores {
  /** child id (or "none") -> probability 0..1: from the choice question's distribution, or one option's own probability */
  scores: Map<string, number>;
  /** the model's most likely choice and its stated confidence, for a choice question */
  choice?: string;
  confidence?: number;
}

const cache = new Map<string, BranchScores>();
export const clearDecideCache = () => cache.clear();

/** Short stable hash (cyrb53) of the patient lines, for the in-memory cache key. */
function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
export const factsHash = (g: Graph, facts: Facts) => hash(factLines(g, facts).join("\n"));

const prob = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null);

/** Fold the answers of one request into per-node scores (refusals and malformed answers add nothing). */
function absorb(batch: Planned[], answers: Answer[], into: Map<string, BranchScores>) {
  const byName = new Map(answers.map((a) => [a?.name, a] as const));
  batch.forEach((p, i) => {
    const a = byName.get(p.q.name) ?? (answers[i]?.name === undefined ? answers[i] : undefined);
    if (!a || a.type === "refusal") return;
    for (const node of p.meta.nodes) {
      const slot = into.get(node)!;
      if (p.meta.kind === "choice" && a.type === "choice" && Array.isArray(a.probabilities)) {
        const allowed = new Set((p.q as ChoiceQuestion).choices.map((c) => c.value));
        const got = new Map<string, number>();
        for (const e of a.probabilities) { const v = prob(e?.probability); if (v !== null && allowed.has(e.value)) got.set(e.value, v); }
        if (!got.size) continue;
        for (const v of allowed) slot.scores.set(v, got.get(v) ?? 0);
        if (typeof a.choice === "string" && allowed.has(a.choice)) slot.choice = a.choice;
        const c = prob(a.confidence);
        if (c !== null) slot.confidence = c;
      } else if (p.meta.kind === "predicate" && a.type === "predicate" && p.meta.child) {
        const v = prob(a.probability);
        if (v !== null) slot.scores.set(p.meta.child, v);
      }
    }
  });
}

/** Split planned questions into requests of at most `max` questions and a bounded size, keeping a page's questions together. */
function batches(g: Graph, facts: Facts, planned: Planned[], max: number): Planned[][] {
  const order: string[] = [];
  planned.forEach((p) => { if (!order.includes(p.meta.page)) order.push(p.meta.page); });
  const sorted = [...planned].sort((a, b) => order.indexOf(a.meta.page) - order.indexOf(b.meta.page));
  const base = JSON.stringify(factLines(g, facts)).length + 100;
  const pageBytes = new Map<string, number>();
  const bytesOf = (page: string) => pageBytes.get(page) ?? pageBytes.set(page, pageText(g, page).length + 100).get(page)!;
  const out: Planned[][] = [];
  let cur: Planned[] = [], size = base, pages = new Set<string>();
  for (const p of sorted) {
    const add = JSON.stringify(p.q).length + (pages.has(p.meta.page) ? 0 : bytesOf(p.meta.page));
    if (cur.length && (cur.length >= max || size + add > MAX_REQUEST_BYTES)) { out.push(cur); cur = []; size = base; pages = new Set(); }
    cur.push(p);
    size += JSON.stringify(p.q).length + (pages.has(p.meta.page) ? 0 : bytesOf(p.meta.page));
    pages.add(p.meta.page);
  }
  if (cur.length) out.push(cur);
  return out;
}

async function post(f: typeof fetch, opts: DecideOptions, input: string, questions: Question[]): Promise<Answer[]> {
  let r: Response;
  try {
    r = await f(`${opts.baseUrl ?? ""}/api/decide`, {
      method: "POST", signal: opts.signal, headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ input, questions }),
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new DecideError("Could not reach the local server.");
  }
  let j: { answers?: unknown; error?: unknown } | null = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new DecideError(typeof j?.error === "string" ? j.error : `The server answered ${r.status}.`, r.status);
  if (!Array.isArray(j?.answers)) throw new DecideError("The server's answer had no answers.", r.status);
  return j!.answers as Answer[];
}

/**
 * Score the branches at the given decision nodes for these facts. Questions are sent in batches
 * of at most 16 (and a bounded size), a few batches at a time. The result has an entry for every
 * node asked about: the probability of each child (and "none") for a condition branch, of each
 * option for an option branch; empty when the node has nothing to score or the model refused.
 * Results are remembered in memory by (guideline, node, hash of the facts). Throws DecideError
 * when the server or the model call fails.
 */
export async function scoreBranchesDetailed(g: Graph, facts: Facts, nodeIds: string[], opts: DecideOptions = {}): Promise<Map<string, BranchScores>> {
  const f = opts.fetch ?? fetch;
  const fh = factsHash(g, facts), scope = `${g.bundle.title}|`;
  const key = (id: string) => `${scope}${id}|${fh}`;
  const result = new Map<string, BranchScores>();
  const todo: string[] = [];
  for (const id of new Set(nodeIds)) {
    const hit = cache.get(key(id));
    if (hit) result.set(id, hit); else { result.set(id, { scores: new Map() }); todo.push(id); }
  }
  const planned = planAll(g, todo);
  const fresh = new Map(todo.map((id) => [id, result.get(id)!] as const));
  const queue = batches(g, facts, planned, MAX_QUESTIONS);
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const batch = queue[next++];
      const answers = await post(f, opts, buildInput(g, facts, batch.map((p) => p.meta.page)), batch.map((p) => p.q));
      absorb(batch, answers, fresh);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  // Remember what came back; a node the model refused is left out, so asking again can try again.
  for (const [id, s] of fresh) if (s.scores.size) cache.set(key(id), s);
  return result;
}

/** Probability of each child (or "none") at each node: see scoreBranchesDetailed. */
export async function scoreBranches(g: Graph, facts: Facts, nodeIds: string[], opts: DecideOptions = {}): Promise<Map<string, Map<string, number>>> {
  const detailed = await scoreBranchesDetailed(g, facts, nodeIds, opts);
  return new Map([...detailed].map(([id, s]) => [id, s.scores] as const));
}
