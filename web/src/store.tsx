import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { Bundle, Facts } from "./types";
import { buildGraph, resolveRef, type Graph } from "./lib/graph";
import { choose as walkChoose, startWalk, autoStep, type Walk } from "./lib/walk";
import type { Kind } from "./lib/search";

export type Loc =
  | { kind: "flow"; page: string; node?: string }
  | { kind: "doc"; code: string; sub?: number }
  | { kind: "map" };
export type LeftView = "toc" | "search" | "hist" | null;
export type RightTab = "details" | "walk" | "facts";
export type DockTab = "fn" | "E" | "P" | null;

export interface State {
  loc: Loc; hist: Loc[]; hpos: number;
  answers: string[]; showNon: boolean; conf: boolean;
  left: LeftView; rightTab: RightTab; sheet: boolean;
  query: string; kinds: Kind[]; tags: string[]; searchNon: boolean;
  dock: DockTab; fn: string | null; fnIdx: number;
  walk: Walk | null; facts: Facts; help: boolean;
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
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error("no store"); return c; };

export const locToHash = (l: Loc) => l.kind === "flow" ? `#flow/${l.page}${l.node ? "/" + l.node.split(":")[1] : ""}` : l.kind === "doc" ? `#doc/${l.code}${l.sub ? "/" + l.sub : ""}` : "#map";
export function hashToLoc(h: string, g: Graph): Loc | null {
  const p = decodeURIComponent(h.replace(/^#/, "")).split("/");
  if (p[0] === "map") return { kind: "map" };
  if (p[0] === "flow" && g.bundle.pages[p[1]]) return { kind: "flow", page: p[1], node: p[2] ? `${p[1]}:${p[2]}` : undefined };
  if (p[0] === "doc" && g.bundle.docs[p[1]]) return { kind: "doc", code: p[1], sub: p[2] ? Number(p[2]) : undefined };
  return null;
}

const usePhone = () => {
  const q = "(max-width: 820px)";
  const get = () => typeof matchMedia !== "undefined" && matchMedia(q).matches;
  const [v, setV] = useReducer((_: boolean, x: boolean) => x, get());
  useEffect(() => { const m = matchMedia(q); const f = () => setV(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return v;
};

export function Provider({ bundle, children }: { bundle: Bundle; children: ReactNode }) {
  const g = useMemo(() => buildGraph(bundle), [bundle]);
  const isPhone = usePhone();
  const init = useMemo<State>(() => {
    const fromHash = hashToLoc(location.hash, g);
    let saved: string | null = null;
    try { saved = localStorage.getItem("nav-help"); } catch { /* storage may be blocked */ }
    const loc = fromHash ?? ({ kind: "flow", page: g.flowPages[0] } as Loc);
    return {
      loc, hist: [loc], hpos: 0, answers: [], showNon: false, conf: false,
      left: window.innerWidth > 820 ? "toc" : null, rightTab: "details", sheet: false,
      query: "", kinds: [], tags: [], searchNon: false,
      dock: null, fn: null, fnIdx: 0, walk: null, facts: {}, help: !saved,
    };
  }, [g]);
  const [s, dispatch] = useReducer(reducer, init);

  useEffect(() => { try { history.replaceState(null, "", locToHash(s.loc)); } catch { /* file:// may refuse */ } }, [s.loc]);
  useEffect(() => {
    const f = () => { const l = hashToLoc(location.hash, g); if (l) dispatch({ type: "go", loc: l }); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, [g]);

  const set = useCallback((patch: Partial<State>) => dispatch({ type: "set", patch }), []);
  const go = useCallback((loc: Loc) => {
    dispatch({ type: "go", loc });
    if (window.innerWidth <= 820) dispatch({ type: "set", patch: { left: null } });
  }, []);
  const goRef = useCallback((code: string, idx?: number) => {
    const t = resolveRef(g, code);
    if (t.type === "flow") go({ kind: "flow", page: t.page });
    else if (t.type === "doc") go({ kind: "doc", code: t.code, sub: idx });
  }, [g, go]);
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

  const value: Ctx = { s, g, bundle, dispatch, go, goRef, set, openFootnote, startWalkAt, chooseStep, setFacts, isPhone };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
