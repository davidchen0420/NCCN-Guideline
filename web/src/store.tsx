import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { Bundle, Facts, LibraryEntry } from "./types";
import { buildGraph, resolveRef, type Graph } from "./lib/graph";
import { choose as walkChoose, startWalk, autoStep, type Walk } from "./lib/walk";
import type { Kind } from "./lib/search";
import { rankPathways, type Pathway, type Ranking } from "./lib/pathways";
import { patientKey, readPatient } from "./lib/patient";

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
  isPhone: boolean;
  ranking: Ranking;
  selected: Pathway | null;
  showPath: (id: string | null) => void;
  focusFact: (name: string) => void;
  library: LibraryNav | null;
  slug: string | null;
}

const AppCtx = createContext<Ctx | null>(null);
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
    let saved: string | null = null;
    try { saved = localStorage.getItem("nav-help"); } catch { /* storage may be blocked */ }
    const patient = slug ? readPatient(slug) : null;   // carried over from the atlas, or entered earlier this session
    const loc = fromHash ?? ({ kind: "flow", page: g.flowPages.find((p) => (bundle.roots[p] ?? []).length) ?? g.flowPages[0] } as Loc);
    return {
      loc, hist: [loc], hpos: 0, answers: [], showNon: false, conf: false,
      left: window.innerWidth > 1180 ? "toc" : null, sheet: false,
      query: "", kinds: [], tags: [], searchNon: false,
      dock: null, fn: null, fnIdx: 0, walk: null, facts: patient?.facts ?? {}, help: false, welcome: !saved && !(patient && Object.keys(patient.facts).length),
      rightTab: "patient", age: patient?.age ?? null, start: "auto", pathSel: null,
    };
  }, [g]);
  const [s, dispatch] = useReducer(reducer, init);

  useEffect(() => { try { history.replaceState(null, "", locToHash(s.loc, prefix)); } catch { /* file:// may refuse */ } }, [s.loc, prefix]);
  useEffect(() => {
    if (!slug) return;
    try { sessionStorage.setItem(patientKey(slug), JSON.stringify({ facts: s.facts, age: s.age })); } catch { /* storage blocked */ }
  }, [slug, s.facts, s.age]);
  useEffect(() => {
    const f = () => { const l = hashToLoc(location.hash, g, prefix); if (l) dispatch({ type: "go", loc: l }); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, [g, prefix]);

  const set = useCallback((patch: Partial<State>) => dispatch({ type: "set", patch }), []);
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
    dispatch({ type: "set", patch: { facts, walk: s.walk ? autoStep(g, { path: s.walk.path.slice(0, 1), at: s.walk.path[0].node }, facts) : null } });
  }, [g, s.walk]);

  const ranking = useMemo(() => rankPathways(g, s.facts, s.start), [g, s.facts, s.start]);
  const selected = useMemo(() => {
    if (!ranking.paths.length) return null;
    return ranking.paths.find((p) => p.id === s.pathSel) ?? ranking.paths[0];
  }, [ranking, s.pathSel]);
  const showPath = useCallback((id: string | null) => dispatch({ type: "set", patch: { pathSel: id } }), []);
  const focusFact = useCallback((name: string) => {
    dispatch({ type: "set", patch: { rightTab: "patient", sheet: true } });
    window.setTimeout(() => {
      const el = document.getElementById(`fact-${name}`);
      const row = el?.closest(".pf");
      el?.closest("details")?.setAttribute("open", "");
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.classList.remove("flash"); void (row as HTMLElement | undefined)?.offsetWidth; row?.classList.add("flash");
      (el as HTMLElement | null)?.focus({ preventScroll: true });
    }, 60);
  }, []);

  const value: Ctx = { s, g, bundle, dispatch, go, goRef, set, openFootnote, startWalkAt, chooseStep, setFacts, isPhone, ranking, selected, showPath, focusFact, library, slug };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
