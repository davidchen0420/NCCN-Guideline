import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { Bundle, Facts, LibraryEntry } from "./types";
import { buildGraph, resolveRef, type Graph } from "./lib/graph";
import { choose as walkChoose, startWalk, autoStep, type Walk } from "./lib/walk";
import type { Kind } from "./lib/search";
import { rankPathways, type Pathway, type Ranking } from "./lib/pathways";
import { patientKey, readPatient } from "./lib/patient";
import { carryOver } from "./lib/moments";
import { ADVANCED_EVENT, ADVANCED_KEY, readAiEnabled, readAiThreshold, readFlag, readPref, setAdvancedPref, writeAiEnabled, writeAiThreshold, clampThreshold } from "./lib/prefs";
import { aiStatus, type AiStatus } from "./lib/decide";
import { useAiTrail, type AiTrail } from "./lib/useAiTrail";
import { staleOverrides } from "./lib/trailView";

export type Loc =
  | { kind: "flow"; page: string; node?: string }
  | { kind: "doc"; code: string; sub?: number }
  | { kind: "map" };
export type LeftView = "toc" | "search" | "hist" | null;
export type RightTab = "patient" | "paths" | "details" | "walk";
export type DockTab = "fn" | "E" | "P" | null;

export interface State {
  loc: Loc; hist: Loc[]; hpos: number;
  answers: string[]; showNon: boolean; conf: boolean;
  left: LeftView; rightTab: RightTab; sheet: boolean;
  query: string; kinds: Kind[]; tags: string[]; searchNon: boolean;
  dock: DockTab; fn: string | null; fnIdx: number;
  walk: Walk | null; facts: Facts; help: boolean; welcome: boolean;
  age: number | null; start: string; pathSel: string | null;
  /** details carried over from an earlier moment, left out of the ranking until confirmed */
  stale: string[];
  /** Advanced tools: reviewer views (extraction, encoding, walk, scores); off for clinicians */
  advanced: boolean;
  /** the clinician's choices at branches of the algorithm (box id -> child), kept with the patient */
  overrides: Record<string, string>;
}

type Action =
  | { type: "go"; loc: Loc; push?: boolean }
  | { type: "hist"; delta: number }
  | { type: "set"; patch: Partial<State> }
  | { type: "toggleAnswer"; id: string }
  | { type: "clear" };

const sameLoc = (a: Loc, b: Loc) => JSON.stringify(a) === JSON.stringify(b);

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "go": {
      const push = a.push ?? true;
      const same = sameLoc(a.loc, s.loc);
      let hist = s.hist, hpos = s.hpos;
      if (push && !same) { hist = [...s.hist.slice(0, s.hpos + 1), a.loc]; hpos = hist.length - 1; }
      const pageChanged = a.loc.kind !== s.loc.kind || (a.loc.kind === "flow" && s.loc.kind === "flow" && a.loc.page !== s.loc.page);
      return { ...s, loc: a.loc, hist, hpos, fn: pageChanged ? null : s.fn, fnIdx: pageChanged ? 0 : s.fnIdx };
    }
    case "hist": {
      const hpos = s.hpos + a.delta;
      if (hpos < 0 || hpos >= s.hist.length) return s;
      return { ...s, hpos, loc: s.hist[hpos] };
    }
    case "set": return { ...s, ...a.patch };
    case "toggleAnswer":
      return { ...s, answers: s.answers.includes(a.id) ? s.answers.filter((x) => x !== a.id) : [...s.answers, a.id] };
    case "clear": return { ...s, answers: [], fn: null };
  }
}

/** AI decision support as the reader sees it. */
export interface AiCtx extends AiTrail {
  /** the local server offers it (it has a key); false on file:// and on the hosted copy: then nothing about AI is shown */
  available: boolean;
  /** available and switched on */
  on: boolean;
  /** the model's name as the server reports it, for display */
  model: string | null;
  threshold: number;
  setOn: (on: boolean) => void;
  setThreshold: (t: number) => void;
}

export interface Ctx {
  s: State; g: Graph; bundle: Bundle;
  dispatch: React.Dispatch<Action>;
  go: (loc: Loc) => void;
  goRef: (code: string, idx?: number) => void;
  set: (patch: Partial<State>) => void;
  openFootnote: (letter: string, node?: string) => void;
  startWalkAt: (page: string, node: string | null) => void;
  chooseStep: (child: string) => void;
  setFacts: (f: Facts) => void;
  /** choose a child at a branch of the algorithm (null takes the choice back); the recommendation and the trail follow */
  setOverride: (node: string, child: string | null) => void;
  ai: AiCtx;
  /** start the algorithm at a moment (a page, or "auto"); details that may have changed since are carried over for confirmation */
  setStart: (page: string) => void;
  isPhone: boolean;
  ranking: Ranking;
  selected: Pathway | null;
  showPath: (id: string | null) => void;
  focusFact: (name: string) => void;
  library: LibraryNav | null;
  slug: string | null;
}

const AppCtx = createContext<Ctx | null>(null);
/** Whether Advanced tools are on (reviewer views); safe outside a guideline (atlas, library). */
export const useAdvanced = (): boolean => {
  const c = useContext(AppCtx);
  const [v, setV] = useState(() => readFlag(ADVANCED_KEY));
  useEffect(() => {
    const f = (e: Event) => setV(!!(e as CustomEvent).detail);
    window.addEventListener(ADVANCED_EVENT, f);
    return () => window.removeEventListener(ADVANCED_EVENT, f);
  }, []);
  return c ? c.s.advanced : v;
};
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error("no store"); return c; };
/** The store when inside one (the reader), else null (the atlas). */
export const useAppMaybe = () => useContext(AppCtx);

/** In the library the hash starts with the guideline slug: "#prostate/flow/PROS-3". */
export const locToHash = (l: Loc, prefix = "") => "#" + prefix + (l.kind === "flow" ? `flow/${encodeURIComponent(l.page)}${l.node ? "/" + l.node.split(":")[1] : ""}` : l.kind === "doc" ? `doc/${encodeURIComponent(l.code)}${l.sub ? "/" + l.sub : ""}` : "map");
export function hashToLoc(h: string, g: Graph, prefix = ""): Loc | null {
  let raw = h.replace(/^#/, "");
  if (prefix) { if (!raw.startsWith(prefix)) return null; raw = raw.slice(prefix.length); }
  const p = raw.split("/").map((x) => decodeURIComponent(x));
  if (p[0] === "map") return { kind: "map" };
  if (p[0] === "flow" && g.bundle.pages[p[1]]) return { kind: "flow", page: p[1], node: p[2] ? `${p[1]}:${p[2]}` : undefined };
  if (p[0] === "doc" && g.bundle.docs[p[1]]) return { kind: "doc", code: p[1], sub: p[2] ? Number(p[2]) : undefined };
  if (p[0] === "ref" && p[1]) {   // a page code from another guideline's link: resolve it here
    const t = resolveRef(g, p[1]);
    if (t.type === "flow") return { kind: "flow", page: t.page };
    if (t.type === "doc") return { kind: "doc", code: t.code, sub: p[2] ? Number(p[2]) : undefined };
  }
  return null;
}

/** What the library offers to an open guideline. */
export interface LibraryNav {
  entries: LibraryEntry[];
  open: (slug: string, code?: string | null) => void;
  /** back to the atlas (at this guideline and page when given) */
  home: (page?: string | null) => void;
}

const usePhone = () => {
  const q = "(max-width: 820px)";
  const get = () => typeof matchMedia !== "undefined" && matchMedia(q).matches;
  const [v, setV] = useReducer((_: boolean, x: boolean) => x, get());
  useEffect(() => { const m = matchMedia(q); const f = () => setV(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return v;
};

export function Provider({ bundle, children, slug = null, library = null }: { bundle: Bundle; children: ReactNode; slug?: string | null; library?: LibraryNav | null }) {
  const prefix = slug ? `${slug}/` : "";
  const g = useMemo(() => buildGraph(bundle), [bundle]);
  const isPhone = usePhone();
  const init = useMemo<State>(() => {
    const fromHash = hashToLoc(location.hash, g, prefix);
    const saved = readPref("nav-help");
    const patient = slug ? readPatient(slug) : null;   // carried over from the atlas, or entered earlier this session
    // "Enter a patient" / "Read the guideline" in the atlas: no welcome screen ("patient" also opens the form)
    let intent: string | null = null;
    try { intent = sessionStorage.getItem("oc-intent"); sessionStorage.removeItem("oc-intent"); } catch { /* blocked */ }
    const loc = fromHash ?? ({ kind: "flow", page: g.flowPages.find((p) => (bundle.roots[p] ?? []).length) ?? g.flowPages[0] } as Loc);
    return {
      loc, hist: [loc], hpos: 0, answers: [], showNon: false, conf: false,
      left: window.innerWidth > 1180 ? "toc" : null, sheet: intent === "patient",
      query: "", kinds: [], tags: [], searchNon: false,
      dock: null, fn: null, fnIdx: 0, walk: null, facts: patient?.facts ?? {}, help: false, welcome: !saved && !(patient && Object.keys(patient.facts).length) && intent !== "patient" && intent !== "read",
      rightTab: "patient", age: patient?.age ?? null, start: patient?.start && g.bundle.pages[patient.start] ? patient.start : "auto", pathSel: null,
      stale: patient?.stale ?? [], advanced: readFlag(ADVANCED_KEY), overrides: patient?.overrides ?? {},
    };
  }, [g]);
  const [s, dispatch] = useReducer(reducer, init);

  useEffect(() => { try { history.replaceState(null, "", locToHash(s.loc, prefix)); } catch { /* file:// may refuse */ } }, [s.loc, prefix]);
  useEffect(() => {
    if (!slug) return;
    try { sessionStorage.setItem(patientKey(slug), JSON.stringify({ facts: s.facts, age: s.age, start: s.start, stale: s.stale, overrides: s.overrides })); } catch { /* storage blocked */ }
  }, [slug, s.facts, s.age, s.start, s.stale, s.overrides]);
  useEffect(() => {
    const f = () => { const l = hashToLoc(location.hash, g, prefix); if (l) dispatch({ type: "go", loc: l }); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, [g, prefix]);

  const set = useCallback((patch: Partial<State>) => {
    if (patch.advanced !== undefined) {
      setAdvancedPref(patch.advanced);
      // the reviewer views close with Advanced tools
      if (!patch.advanced) patch = { conf: false, showNon: false, ...patch };
    }
    dispatch({ type: "set", patch });
  }, []);
  const go = useCallback((loc: Loc) => {
    dispatch({ type: "go", loc });
    if (window.innerWidth <= 820) dispatch({ type: "set", patch: { left: null } });
  }, []);
  const goRef = useCallback((code: string, idx?: number) => {
    const t = resolveRef(g, code);
    if (t.type === "flow") go({ kind: "flow", page: t.page });
    else if (t.type === "doc") go({ kind: "doc", code: t.code, sub: idx });
    else if (t.type === "external") library?.open(t.slug, idx ? `${t.code}/${idx}` : t.code);
  }, [g, go, library]);
  const openFootnote = useCallback((letter: string, node?: string) => {
    const page = s.loc.kind === "flow" ? s.loc.page : null;
    let idx = 0;
    if (page && node) {
      const inst = [...g.nodes.values()].filter((n) => n.page === page && n.footnotes.some(([l]) => l === letter)).map((n) => n.full);
      idx = Math.max(0, inst.indexOf(node));
    }
    dispatch({ type: "set", patch: { dock: "fn", fn: letter, fnIdx: idx, sheet: false } });
  }, [g, s.loc]);
  const startWalkAt = useCallback((page: string, node: string | null) => {
    const w = startWalk(g, page, node, s.facts);
    if (!w) return;
    const at = w.at.endsWith(":START") ? undefined : w.at;
    dispatch({ type: "set", patch: { walk: w, rightTab: "walk", sheet: true } });
    dispatch({ type: "go", loc: { kind: "flow", page: w.at.split(":")[0], node: at } });
  }, [g, s.facts]);
  const chooseStep = useCallback((child: string) => {
    if (!s.walk) return;
    const w = walkChoose(g, s.walk, child, s.facts);
    dispatch({ type: "set", patch: { walk: w } });
    dispatch({ type: "go", loc: { kind: "flow", page: w.at.split(":")[0], node: w.at.endsWith(":START") ? undefined : w.at } });
  }, [g, s.walk, s.facts]);
  const setFacts = useCallback((facts: Facts) => {
    // a carried-over detail that is changed or cleared no longer needs confirming
    const stale = s.stale.filter((k) => facts[k] !== undefined && JSON.stringify(facts[k]) === JSON.stringify(s.facts[k]));
    dispatch({ type: "set", patch: { facts, stale, walk: s.walk ? autoStep(g, { path: s.walk.path.slice(0, 1), at: s.walk.path[0].node }, facts) : null } });
  }, [g, s.walk, s.stale, s.facts]);

  const setStart = useCallback((start: string) => {
    dispatch({ type: "set", patch: { start, pathSel: null, stale: carryOver(g, s.start, start, s.facts, s.stale) } });
  }, [g, s.start, s.facts, s.stale]);

  // details awaiting confirmation (carried over from an earlier moment) do not steer the routes
  const live = useMemo(() => {
    if (!s.stale.length) return s.facts;
    const f = { ...s.facts };
    for (const k of s.stale) delete f[k];
    return f;
  }, [s.facts, s.stale]);

  // AI decision support: only where the local server offers it, and only while it is switched on
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [aiPref, setAiPref] = useState(readAiEnabled);
  const [threshold, setThresholdState] = useState(readAiThreshold);
  useEffect(() => {
    let off = false;
    aiStatus().then((st) => { if (!off) setStatus(st); }, () => { /* no server: no AI */ });
    return () => { off = true; };
  }, []);
  const available = !!status?.enabled;
  const aiOn = available && aiPref;
  const aiTrail = useAiTrail(g, live, s.start, s.overrides, { enabled: aiOn, threshold });
  // a choice that no longer applies (the route changed) is dropped once the walk has settled
  useEffect(() => {
    if (!aiTrail.settled || !Object.keys(s.overrides).length) return;
    const gone = staleOverrides(aiOn && aiTrail.ai ? aiTrail.ai : aiTrail.rules, s.overrides);
    if (gone.length) dispatch({ type: "set", patch: { overrides: Object.fromEntries(Object.entries(s.overrides).filter(([k]) => !gone.includes(k))) } });
  }, [aiTrail.settled, aiTrail.ai, aiTrail.rules, aiOn, s.overrides]);
  const setOverride = useCallback((node: string, child: string | null) => {
    const next = { ...s.overrides };
    if (child === null) delete next[node]; else next[node] = child;
    dispatch({ type: "set", patch: { overrides: next, pathSel: null } });
  }, [s.overrides]);
  const ai: AiCtx = useMemo(() => ({
    ...aiTrail, available, on: aiOn, model: status?.model ?? null, threshold,
    setOn: (on: boolean) => { writeAiEnabled(on); setAiPref(on); },
    setThreshold: (t: number) => { const c = clampThreshold(t); writeAiThreshold(c); setThresholdState(c); },
  }), [aiTrail, available, aiOn, status, threshold]);

  const ranking = useMemo(() => rankPathways(g, live, s.start, { edgeProb: aiOn ? aiTrail.edgeProb : undefined, overrides: s.overrides }), [g, live, s.start, aiOn, aiTrail.edgeProb, s.overrides]);
  const selected = useMemo(() => {
    if (!ranking.paths.length) return null;
    return ranking.paths.find((p) => p.id === s.pathSel) ?? ranking.paths[0];
  }, [ranking, s.pathSel]);
  const showPath = useCallback((id: string | null) => dispatch({ type: "set", patch: { pathSel: id } }), []);
  const focusFact = useCallback((name: string) => {
    dispatch({ type: "set", patch: { rightTab: "patient", sheet: true } });
    window.dispatchEvent(new CustomEvent("oc-focus-fact", { detail: name }));   // the form switches to its full view
    window.setTimeout(() => {
      const el = document.getElementById(`fact-${name}`);
      const row = el?.closest(".pf");
      el?.closest("details")?.setAttribute("open", "");
      // scroll the panel only (scrollIntoView would also shift the page, which must not move)
      const sc = row?.closest<HTMLElement>(".rp-body");
      if (row && sc) sc.scrollTo({ top: sc.scrollTop + row.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight / 3, behavior: "smooth" });
      row?.classList.remove("flash"); void (row as HTMLElement | undefined)?.offsetWidth; row?.classList.add("flash");
      // a choice group is not focusable itself: focus its chosen (or first) option
      const target = el?.matches("input, select, button, textarea") ? el : el?.querySelector<HTMLElement>("[aria-checked=true], [aria-pressed=true], button, input, select");
      (target as HTMLElement | null | undefined)?.focus({ preventScroll: true });
    }, 60);
  }, []);

  const value: Ctx = { s, g, bundle, dispatch, go, goRef, set, openFootnote, startWalkAt, chooseStep, setFacts, setOverride, ai, setStart, isPhone, ranking, selected, showPath, focusFact, library, slug };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
