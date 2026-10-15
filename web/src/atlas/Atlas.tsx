/**
 * The atlas home page: one map of every encoded guideline. Search from the hub at the centre or
 * walk the map: site -> guideline (its algorithm pages) -> page (its boxes) -> the reader.
 * The URL hash records where you are (#atlas, #atlas/@gi, #atlas/prostate, #atlas/prostate/PROS-3)
 * so Back goes up a level and links can point at any place on the map.
 */
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronRight, Compass, ExternalLink, FileText, List, Minus, Plus, Search as SearchIcon, UserRound, X } from "lucide-react";
import type { Bundle, Example, Facts, Library } from "../types";
import { buildGraph, type Graph } from "../lib/graph";
import { rankPathways, confidenceWord, hasFacts, type Pathway } from "../lib/pathways";
import { stripMarks } from "../lib/adapt";
import { buildModel, searchIndex, CATEGORY_LABEL, type AtlasRaw, type GNode, type Model, type SearchHit } from "./model";
import { Engine, type Focus, type Hit, type Route } from "./engine";
import { getGuideline } from "../Library";
import { readPatient, writePatient } from "../lib/patient";
import { renderPage } from "../lib/pdf";
import { PageImage, PdfButton, SourceProvider, useSource, useSrc, type SrcTarget } from "../source";
import { useAdvanced } from "../store";
import { T, matchWord, supportPhrase } from "../lib/terms";
import { readPref, writePref } from "../lib/prefs";
import "./atlas.css";
import "./home.css";

/* ---------------- hash <-> focus ---------------- */

export function parseAtlasHash(hash: string, m: Model): Focus {
  const p = hash.replace(/^#/, "").split("/").map((x) => decodeURIComponent(x));
  if (p[0] !== "atlas") return { level: 0 };
  if (p[1]?.startsWith("@") && m.sites.some((s) => s.id === p[1].slice(1))) return { level: 0, site: p[1].slice(1) };
  const g = p[1] ? m.bySlug.get(p[1]) : undefined;
  if (!g) return { level: 0 };
  if (p[2] && g.pages.some((x) => x.id === p[2])) return { level: 2, slug: g.slug, page: p[2] };
  return { level: 1, slug: g.slug };
}
export function atlasHash(f: Focus) {
  if (f.level === 2) return `#atlas/${f.slug}/${encodeURIComponent(f.page)}`;
  if (f.level === 1) return `#atlas/${f.slug}`;
  return f.site ? `#atlas/@${f.site}` : "#atlas";
}
const sameFocus = (a: Focus, b: Focus) => atlasHash(a) === atlasHash(b) && (a.level !== 1 || b.level !== 1 || (a.section ?? null) === (b.section ?? null));

/* ---------------- small hooks ---------------- */

function useMedia(q: string) {
  const [v, setV] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const f = () => setV(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, [q]);
  return v;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/* ---------------- the morph into the reader ---------------- */

/** A paper sheet grows from the clicked box to the whole window, the reader opens under it, and
 * the sheet fades away. */
function morph(rect: DOMRect | null, then: () => void) {
  if (!rect || matchMedia("(prefers-reduced-motion: reduce)").matches || !document.body.animate) { then(); return; }
  const el = document.createElement("div");
  el.className = "atlas-morph";
  Object.assign(el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.body.appendChild(el);
  const a = el.animate([
    { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: "5px" },
    { left: "0px", top: "0px", width: `${innerWidth}px`, height: `${innerHeight}px`, borderRadius: "0px" },
  ], { duration: 460, easing: "cubic-bezier(.65,0,.25,1)", fill: "forwards" });
  a.onfinish = () => {
    then();
    setTimeout(() => {
      const b = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease-out", fill: "forwards" });
      b.onfinish = () => el.remove();
    }, 180);
  };
}

/* ---------------- source PDF ---------------- */

type SourceApi = ReturnType<typeof useSource>;
/** Lets the atlas (which renders the SourceProvider) reach it from its event handlers. */
function SourceBridge({ to, onReady }: { to: React.MutableRefObject<SourceApi | null>; onReady: (ready: boolean) => void }) {
  const s = useSource();
  to.current = s;
  const ready = s.pdf.status === "ready";
  useEffect(() => onReady(ready), [ready, onReady]);
  return null;
}

/** The original PDF page (and box) behind a page or box of the atlas. */
function sourceTarget(bundle: Bundle | null, page: string, node?: string, action?: SrcTarget["action"]): SrcTarget | null {
  const fp = bundle?.pages[page];
  if (!fp || fp.pdf === undefined) return null;
  const n = node ? fp.nodes.find((x) => `${page}:${x.id}` === node) : undefined;
  return { page: fp.pdf, bbox: n?.bbox, label: page, excerpt: n ? stripMarks(n.text) : undefined, action };
}

/** Renders the open page card's original PDF page and hands it to the engine. */
function CardImage({ engine, slug, page, bundle }: { engine: React.RefObject<Engine | null>; slug: string; page: string; bundle: Bundle | null }) {
  const { pdf } = useSource();
  const fp = bundle?.pages[page];
  useEffect(() => {
    const e = engine.current;
    if (!e || pdf.status !== "ready" || !pdf.doc || !fp || fp.pdf === undefined) return;
    let off = false;
    renderPage(pdf.doc, fp.pdf, Math.min(2400, Math.round(innerWidth * Math.min(2, devicePixelRatio || 1)))).then((r) => {
      const img = new Image();
      img.onload = () => { if (!off) e.setPageImage(slug, page, { img, w: r.w, h: r.h }); };
      img.src = r.url;
    }).catch(() => { /* the extracted boxes stay */ });
    return () => { off = true; };
  }, [engine, pdf, fp, slug, page]);
  useEffect(() => { if (pdf.status !== "ready") engine.current?.setPageImage(slug, page, null); }, [engine, pdf.status, slug, page]);
  return null;
}

/* ---------------- component ---------------- */

interface Props {
  lib: Library;
  raw: AtlasRaw;
  /** open the reader: guideline, optional page and box */
  onOpen: (slug: string, page?: string, node?: string) => void;
  onList: () => void;
}

export function Atlas({ lib, raw, onOpen, onList }: Props) {
  const model = useMemo(() => buildModel(raw), [raw]);
  const find = useMemo(() => searchIndex(model), [model]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [focus, setFocus] = useState<Focus>(() => parseAtlasHash(location.hash, model));
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const [tip, setTip] = useState<{ hit: Hit; x: number; y: number } | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bundles, setBundles] = useState<Record<string, Bundle | string>>({});
  const [patient, setPatient] = useState<{ slug: string; id: string } | null>(null);
  const [panelHidden, setPanelHidden] = useState(false);
  const [legend, setLegend] = useState(true);
  const srcRef = useRef<SourceApi | null>(null);
  const prefetch = useRef(0);
  const [pdfReady, setPdfReady] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);   // the card is the diagram; the PDF page is a preview away
  useEffect(() => { engineRef.current?.setShowOriginal(showOriginal); }, [showOriginal]);
  const advanced = useAdvanced();
  const narrow = useMedia("(max-width: 640px)");
  const phone = useMedia("(max-width: 480px)");
  const wide = useMedia("(min-width: 900px)");
  const docked = narrow || focus.level > 0 || (focus.level === 0 && !!focus.site);
  const [gliding, setGliding] = useState(false);
  const slug = focus.level >= 1 ? (focus as { slug: string }).slug : null;
  const g = slug ? model.bySlug.get(slug)! : null;
  const site = focus.level === 0 && focus.site ? model.sites.find((s) => s.id === focus.site) ?? null : null;
  const panel = !panelHidden && (focus.level > 0 || !!site);

  /* ----- navigation ----- */
  const go = useCallback((f: Focus, push = true) => {
    if (sameFocus(f, focusRef.current)) { engineRef.current?.setFocus(f); return; }
    focusRef.current = f;   // a second key press may come before React renders
    setFocus(f);
    setPanelHidden(false);
    // frame the target with the panel it will have, so the camera flies once
    const e = engineRef.current;
    e?.setSafe(safeArea(f.level > 0 || (f.level === 0 && !!f.site), innerWidth >= 900), false);
    e?.setFocus(f);
    try { if (push) history.pushState(null, "", atlasHash(f)); else history.replaceState(null, "", atlasHash(f)); } catch { /* file:// */ }
  }, []);
  const up = useCallback(() => {
    const f = focusRef.current;
    if (f.level === 2) go({ level: 1, slug: f.slug });
    else if (f.level === 1) go(f.section != null ? { level: 1, slug: f.slug } : { level: 0, site: model.bySlug.get(f.slug)!.site.id });
    else if (f.site) go({ level: 0 });
  }, [go, model]);
  const openReader = useCallback((s: string, page?: string, node?: string, rect: DOMRect | null = null) => {
    // reading, not entering a patient: the reader skips its welcome dialog
    try { if (!sessionStorage.getItem("oc-intent")) sessionStorage.setItem("oc-intent", "read"); } catch { /* blocked */ }
    morph(rect, () => onOpen(s, page, node));
  }, [onOpen]);
  const bundlesRef = useRef<Record<string, Bundle | string>>({});
  /** The original PDF page of a page or box, in the floating viewer (the reader one click on). */
  const openSource = useCallback((s: string, page: string, node?: string, rect: DOMRect | null = null) => {
    const b = bundlesRef.current[s];
    const t = sourceTarget(typeof b === "object" ? b : null, page, node, { label: "Open in the reader", run: () => { try { sessionStorage.setItem("oc-intent", "read"); } catch { /* blocked */ } onOpen(s, page, node); } });
    if (t && srcRef.current) srcRef.current.open(t); else openReader(s, page, node, rect);
  }, [onOpen, openReader]);

  // back / forward
  useEffect(() => {
    const f = () => {
      if (!location.hash.startsWith("#atlas") && location.hash !== "" && location.hash !== "#") return;
      const n = parseAtlasHash(location.hash, model);
      if (!sameFocus(n, focusRef.current)) {
        focusRef.current = n; setFocus(n);
        engineRef.current?.setSafe(safeArea(n.level > 0 || (n.level === 0 && !!n.site), innerWidth >= 900), false);
        engineRef.current?.setFocus(n);
      }
    };
    window.addEventListener("hashchange", f);
    window.addEventListener("popstate", f);
    return () => { window.removeEventListener("hashchange", f); window.removeEventListener("popstate", f); };
  }, [model]);

  /* ----- engine ----- */
  useEffect(() => {
    const c = canvasRef.current!;
    const e = new Engine(c, model, {
      hover: (hit, x, y) => {
        setTip(hit ? { hit, x, y } : null);
        // read a guideline while the pointer rests on it: opening it is then instant
        window.clearTimeout(prefetch.current);
        if (hit?.kind === "guideline" || hit?.kind === "cite") {
          const s = hit.kind === "cite" ? hit.to : hit.slug;
          prefetch.current = window.setTimeout(() => { void getGuideline(lib, s).catch(() => {}); }, 160);
        }
      },
      click: (hit, rect) => {
        if (!hit) return;
        const f = focusRef.current;
        if (hit.kind === "site") go({ level: 0, site: hit.site });
        else if (hit.kind === "guideline") go(f.level === 2 && f.slug === hit.slug ? { level: 1, slug: hit.slug } : { level: 1, slug: hit.slug });
        else if (hit.kind === "page") go({ level: 2, slug: hit.slug, page: hit.page });
        else if (hit.kind === "box") openSource(hit.slug, hit.page, hit.node, rect);
        else if (hit.kind === "jump") go({ level: 2, slug: hit.slug, page: hit.to });
        else if (hit.kind === "cite") go({ level: 1, slug: hit.to });
        else if (hit.kind === "lens" && f.level === 2) go({ level: 1, slug: hit.slug });
        setTip(null);
      },
      background: () => up(),
      zoomedOut: () => up(),
    });
    engineRef.current = e;
    e.hubEl = hubRef.current;
    e.docked = docked;
    e.setSafe(safeArea(panel, wide), false);
    e.setFocus(focusRef.current, { animate: false });
    let seen = false;
    try { seen = sessionStorage.getItem("oc-intro") === "1"; sessionStorage.setItem("oc-intro", "1"); } catch { /* blocked */ }
    if (focusRef.current.level === 0 && !focusRef.current.site && !seen) e.intro();
    return () => { e.destroy(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // site annotations keep clear of the legend and the zoom buttons
  useEffect(() => {
    const f = () => {
      const r = [...document.querySelectorAll(".atlas .legend, .atlas .zoom, .atlas .atlas-hint, .atlas .proto-note")].map((el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom] as [number, number, number, number]; });
      engineRef.current?.setObstacles(r);
    };
    f();
    const t = window.setTimeout(f, 50);
    window.addEventListener("resize", f);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", f); };
  }, [legend, focus, panel]);

  // the camera frames what the panel leaves free
  useEffect(() => {
    const f = () => engineRef.current?.setSafe(safeArea(panel, wide));
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [panel, wide]);

  // the search glides between the hub and the top of the screen
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (e.docked !== docked) {
      setGliding(true);
      const t = setTimeout(() => setGliding(false), 760);
      e.docked = docked;
      if (!docked) {
        const { x, y } = e.hubScreenFor(focus);
        hubRef.current?.style.setProperty("--hx", `${x}px`);
        hubRef.current?.style.setProperty("--hy", `${y}px`);
      }
      e.request();
      return () => clearTimeout(t);
    }
  }, [docked, focus]);

  /* ----- guideline data for pages and patients ----- */
  useEffect(() => {
    if (!slug || bundles[slug]) return;
    let off = false;
    // read (or take the prefetched copy) once the camera has arrived, so the flight never stutters
    (engineRef.current?.settled() ?? Promise.resolve()).then(() => (off ? Promise.reject(new Error("moved on")) : getGuideline(lib, slug))).then((b) => {
      if (off) return;
      engineRef.current?.addBundle(slug, b);
      setBundles((x) => ({ ...x, [slug]: b }));
      // the card's height is known now: frame it again
      const f = focusRef.current;
      if (f.level === 2 && f.slug === slug) engineRef.current?.setFocus(f);
    }).catch((err) => { if (!off) setBundles((x) => ({ ...x, [slug]: String(err?.message ?? err) })); });
    return () => { off = true; };
  }, [slug, lib, bundles]);
  useEffect(() => {
    // bundles loaded before the engine existed (or for another engine) are handed over
    const e = engineRef.current;
    if (!e) return;
    for (const [s, b] of Object.entries(bundles)) if (typeof b !== "string" && !e.hasBundle(s)) e.addBundle(s, b);
  }, [bundles]);
  bundlesRef.current = bundles;
  const bundle = slug && typeof bundles[slug] === "object" ? (bundles[slug] as Bundle) : null;
  const loadError = slug && typeof bundles[slug] === "string" ? (bundles[slug] as string) : null;
  // building the graph is the heavy part: only when a patient's route is asked for
  const wantGraph = !!patient && patient.slug === slug;
  const graph = useMemo<Graph | null>(() => (bundle && wantGraph ? buildGraph(bundle) : null), [bundle, wantGraph]);

  /* ----- patient route ----- */
  const patients = useMemo(() => {
    if (!slug || !bundle) return [] as { id: string; label: string; note?: string; facts: Facts; age: number | null }[];
    const out: { id: string; label: string; note?: string; facts: Facts; age: number | null }[] = [];
    const mine = readPatient(slug);
    if (mine && hasFacts(mine.facts)) out.push({ id: "mine", label: "Your patient", note: "Entered in the reader", facts: mine.facts, age: mine.age });
    for (const x of (bundle.examples ?? []) as Example[]) out.push({ id: x.id, label: x.label, note: x.note, facts: x.facts, age: x.age ?? null });
    return out;
  }, [slug, bundle]);
  const chosen = patient && patient.slug === slug ? patients.find((x) => x.id === patient.id) ?? null : null;
  const best = useMemo<Pathway | null>(() => (graph && chosen ? rankPathways(graph, chosen.facts).paths[0] ?? null : null), [graph, chosen]);
  const route = useMemo<Route | null>(() => {
    if (!best || !slug) return null;
    const pages: string[] = [];
    for (const st of best.steps) { const p = st.node.split(":")[0]; if (pages[pages.length - 1] !== p) pages.push(p); }
    return { slug, pages, nodes: new Set(best.steps.map((s) => s.node)), steps: best.steps.map((s) => s.node) };
  }, [best, slug]);
  useEffect(() => { engineRef.current?.setRoute(route); }, [route]);

  /* ----- search ----- */
  const hits = useMemo(() => find(q), [find, q]);
  useEffect(() => setActive(0), [q]);
  const hitOf = (h: SearchHit): Hit => h.kind === "guideline" || h.kind === "section" ? { kind: "guideline", slug: h.slug } : h.kind === "site" ? { kind: "site", site: h.site } : { kind: "page", slug: h.slug, page: h.page };
  const choose = (h: SearchHit) => {
    setQ(""); setSearchOpen(false);
    engineRef.current?.setPreview(null);
    inputRef.current?.blur();
    if (h.kind === "guideline") go({ level: 1, slug: h.slug });
    else if (h.kind === "site") go({ level: 0, site: h.site });
    else if (h.kind === "section") go({ level: 1, slug: h.slug, section: h.section });
    else go({ level: 2, slug: h.slug, page: h.page });
  };
  useEffect(() => {
    const h = searchOpen ? hits[active] : undefined;
    engineRef.current?.setPreview(h ? hitOf(h) : null);
    if (h && h.kind !== "site") { const t = window.setTimeout(() => { void getGuideline(lib, h.slug).catch(() => {}); }, 200); return () => window.clearTimeout(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, active, searchOpen, lib]);

  /* ----- keyboard ----- */
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "/" && !typing) { e.preventDefault(); inputRef.current?.focus(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { engineRef.current?.skipIntro(); up(); }
      else if (e.key === "+" || e.key === "=") engineRef.current?.zoomBy(1.6);
      else if (e.key === "-" || e.key === "_") engineRef.current?.zoomBy(1 / 1.6);
      else if (e.key === "0") engineRef.current?.setFocus(focusRef.current);
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [up]);

  /* ----- render ----- */
  const crumbs: { label: string; f: Focus | null; root?: boolean }[] = [{ label: "Atlas", f: { level: 0 }, root: true }];
  const crumbSite = site ?? g?.site ?? null;
  if (crumbSite) crumbs.push({ label: crumbSite.label, f: { level: 0, site: crumbSite.id } });
  if (g) crumbs.push({ label: g.short, f: { level: 1, slug: g.slug } });
  if (focus.level === 2) crumbs.push({ label: focus.page, f: null });
  crumbs[crumbs.length - 1].f = null;

  const canvasLabel = focus.level === 2 ? `${g!.title}, page ${focus.page}: its steps as printed` : g ? `${g.title}: ${g.pages.length} pages and how they connect` : site ? `${site.label}: ${site.members.length} guidelines` : `Map of ${model.guidelines.length} NCCN guidelines grouped by cancer site`;

  return (
    <SourceProvider bundle={bundle}>
    <SourceBridge to={srcRef} onReady={setPdfReady} />
    {g && focus.level === 2 && <CardImage engine={engineRef} slug={g.slug} page={focus.page} bundle={bundle} />}
    <div className={`atlas${docked ? " is-docked" : ""}${panel ? " has-panel" : ""}`}>
      <canvas ref={canvasRef} className="atlas-canvas" role="img" aria-label={canvasLabel} />

      <header className="atlas-top">
        <nav className="crumbs" aria-label="Where you are">
          <span className="crumb-mark" aria-hidden><Compass size={16} /></span>
          {(phone && g ? crumbs.filter((_, i) => i !== 1).slice(focus.level === 2 ? -2 : -1) : narrow && crumbs.length > 2 ? crumbs.slice(-2) : crumbs).map((c, i) => (
            <span key={i} className="crumb">
              {i > 0 && <ChevronRight size={13} aria-hidden className="crumb-sep" />}
              {c.f ? <button type="button" onClick={() => go(c.f!)}>{c.root ? <b>OncoCarta</b> : c.label}</button> : <span aria-current="page">{c.root ? <b>OncoCarta</b> : c.label}</span>}
            </span>
          ))}
        </nav>
        <div className="top-right">
        <PdfButton total={model.guidelines.length} />
        <div className="view-switch" role="group" aria-label="View">
          <button type="button" className="on" aria-pressed="true"><Compass size={14} aria-hidden /> Map</button>
          <button type="button" aria-pressed="false" onClick={onList} data-testid="to-list"><List size={14} aria-hidden /> List</button>
        </div>
        </div>
      </header>

      <div ref={hubRef} className={`hub${docked ? " docked" : ""}${gliding ? " gliding" : ""}`} role="search">
        {!docked && <p className="hub-brand" aria-hidden>Onco<span>Carta</span></p>}
        <div className="hub-q">
        <div className={`hub-field${searchOpen && q ? " open" : ""}`}>
          <SearchIcon size={16} aria-hidden />
          <input ref={inputRef} type="search" value={q} placeholder="Which cancer or topic?"
            aria-label="Which cancer or topic? Search guidelines, sections and pages" role="combobox" aria-expanded={searchOpen && hits.length > 0} aria-controls="atlas-results"
            aria-activedescendant={searchOpen && hits[active] ? `res-${active}` : undefined} autoComplete="off" spellCheck={false}
            onFocus={() => setSearchOpen(true)} onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
            onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter" && hits[active]) { e.preventDefault(); choose(hits[active]); }
              else if (e.key === "Escape") { if (q) setQ(""); else inputRef.current?.blur(); }
            }} />
          {q ? <button type="button" className="hub-clear" aria-label="Clear search" onClick={() => { setQ(""); inputRef.current?.focus(); }}><X size={14} /></button> : <kbd aria-hidden>/</kbd>}
        </div>
        {searchOpen && q && (
          <ul id="atlas-results" className="results" role="listbox" aria-label="Results">
            {hits.map((h, i) => (
              <li key={`${h.kind}-${i}`} id={`res-${i}`} role="option" aria-selected={i === active} className={i === active ? "on" : ""}
                onMouseDown={(e) => { e.preventDefault(); choose(h); }} onMouseEnter={() => setActive(i)}>
                <span className={`res-kind k-${h.kind}`}>{h.kind === "guideline" ? "Guideline" : h.kind === "site" ? "Cancer site" : h.kind === "section" ? "Section" : "Page"}</span>
                <span className="res-label">{h.label}</span>
                <span className="res-sub">{h.sub.replace("algorithm pages", "pages")}</span>
              </li>
            ))}
            {!hits.length && <li className="res-none" role="option" aria-selected="false" aria-disabled="true">Nothing matches “{q}”.</li>}
          </ul>
        )}
        </div>
        {!docked && advanced && <p className="hub-meta">{fmt(model.guidelines.length)} guidelines · {fmt(model.totalPages)} pages<br />{fmt(model.links.length)} cross-references</p>}
        {!docked && <p className="hub-hint">or click a cancer site on the map</p>}
      </div>

      {tip && <Tip tip={tip} model={model} bundle={bundle} />}

      {panel && (
        <aside className="atlas-panel" aria-label="Details" key={atlasHash(focus)}>
          <button type="button" className="panel-x" aria-label="Hide details" onClick={() => setPanelHidden(true)}><X size={16} /></button>
          {site && <SitePanel site={site} go={go} preview={(h) => engineRef.current?.setPreview(h)} />}
          {g && focus.level === 1 && (
            <GuidelinePanel g={g} model={model} focus={focus} go={go} bundle={bundle} loadError={loadError}
              patients={patients} chosen={chosen?.id ?? null} best={best} graph={graph}
              verify={best ? sourceTarget(bundle, best.steps[best.steps.length - 1].node.split(":")[0], best.steps[best.steps.length - 1].node) : null}
              choosePatient={(id) => setPatient(id && slug ? { slug, id } : null)}
              open={(page) => openReader(g.slug, page)}
              retry={() => setBundles((x) => { const n = { ...x }; delete n[g.slug]; return n; })}
              enterPatient={() => { try { sessionStorage.setItem("oc-intent", "patient"); } catch { /* blocked */ } openReader(g.slug, g.pages.find((p) => p.start)?.id); }}
              openWithPatient={() => { if (chosen && route) { writePatient(g.slug, chosen.facts, chosen.age); openReader(g.slug, route.pages[0]); } }}
              preview={(h) => engineRef.current?.setPreview(h)} />
          )}
          {g && focus.level === 2 && (
            <PagePanel g={g} page={focus.page} go={go} retry={() => setBundles((x) => { const n = { ...x }; delete n[g.slug]; return n; })} bundle={bundle} loadError={loadError} route={route}
              pdfReady={pdfReady} showOriginal={showOriginal} setShowOriginal={setShowOriginal}
              readBox={(node) => openReader(g.slug, focus.page, node)}
              source={(node) => sourceTarget(bundle, focus.page, node, { label: "Open in the reader", run: () => { try { sessionStorage.setItem("oc-intent", "read"); } catch { /* blocked */ } onOpen(g.slug, focus.page, node); } })}
              open={(node) => openReader(g.slug, focus.page, node, node ? engineRef.current?.boxRect(g.slug, focus.page, node) ?? null : null)}
              hoverBox={(node) => engineRef.current?.setKbd(node ? { kind: "box", slug: g.slug, page: focus.page, node } : null)}
              preview={(h) => engineRef.current?.setPreview(h)} />
          )}
        </aside>
      )}
      {!panel && (focus.level > 0 || site) && (
        <button type="button" className="panel-show btn" onClick={() => setPanelHidden(false)}>Details</button>
      )}

      {focus.level === 0 && !site && legend && <Legend onClose={() => setLegend(false)} />}
      {focus.level === 0 && !site && <p className="proto-note" role="note">{T.prototype}</p>}
      <AtlasHint level={focus.level} />

      <div className="zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => engineRef.current?.zoomBy(1.6)}><Plus size={16} /></button>
        <button type="button" aria-label="Zoom out" title="Zoom out (−)" onClick={() => engineRef.current?.zoomBy(1 / 1.6)}><Minus size={16} /></button>
        <button type="button" aria-label="Fit to screen" title="Fit (0)" onClick={() => engineRef.current?.setFocus(focusRef.current)}><Compass size={16} /></button>
      </div>

      <MapTree ref={treeRef} model={model} focus={focus} go={go} engine={engineRef} openReader={(s, p) => openReader(s, p)}
        setTip={(hit) => { const pt = hit && engineRef.current?.screenOf(hit); setTip(hit && pt ? { hit, x: pt[0], y: pt[1] } : null); }} />
    </div>
    </SourceProvider>
  );
}

function safeArea(panel: boolean, wide: boolean) {
  const w = innerWidth, h = innerHeight;
  const top = 60;
  if (panel && wide) return { x0: 0, y0: top, x1: w - 384, y1: h - 8 };
  if (panel) return { x0: 0, y0: top + 40, x1: w, y1: h - Math.min(h * 0.42, 360) };
  return { x0: 0, y0: w <= 640 ? top + 48 : top - 20, x1: w, y1: h - 40 };   // the last 40 px hold the prototype note
}

/* ---------------- tooltip ---------------- */

function Tip({ tip, model, bundle }: { tip: { hit: Hit; x: number; y: number }; model: Model; bundle: Bundle | null }) {
  const { pdf } = useSource();
  const advanced = useAdvanced();
  const ready = pdf.status === "ready";
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: tip.x + 16, top: tip.y + 16 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = tip.x + 16, top = tip.y + 18;
    if (left + r.width > innerWidth - 12) left = tip.x - r.width - 16;
    if (top + r.height > innerHeight - 12) top = tip.y - r.height - 14;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [tip]);
  const h = tip.hit;
  if (!h || h.kind === "lens") return null;
  let body: React.ReactNode = null;
  if (h.kind === "guideline") {
    const g = model.bySlug.get(h.slug)!;
    body = (<>
      <p className="tip-eyebrow site-ink" style={{ "--c": g.site.color } as React.CSSProperties}>{g.site.label} · {CATEGORY_LABEL[g.category] ?? g.category}</p>
      <p className="tip-title">{g.title}</p>
      <p className="tip-meta">{[g.version ? `Version ${g.version}` : "", g.date, `${g.pages.length} pages`].filter(Boolean).join(" · ")}</p>
      {advanced && <dl className="tip-stats">
        <div><dt>Algorithm pages</dt><dd>{g.pages.length}</dd></div>
        <div><dt>Boxes</dt><dd>{fmt(g.boxes)}</dd></div>
        <div><dt>Encoded conditions</dt><dd>{fmt(g.encoded)}</dd></div>
      </dl>}
      {advanced && (g.cites.length > 0 || g.citedBy.length > 0) && <p className="tip-meta">Cites {g.cites.length} · cited by {g.citedBy.length} guidelines</p>}
    </>);
  } else if (h.kind === "site") {
    const s = model.sites.find((x) => x.id === h.site)!;
    body = (<>
      <p className="tip-eyebrow site-ink" style={{ "--c": s.color } as React.CSSProperties}>Site</p>
      <p className="tip-title">{s.label}</p>
      <p className="tip-meta">{s.members.length} guidelines: {s.members.slice(0, 4).map((x) => x.short).join(", ")}{s.members.length > 4 ? "…" : ""}</p>
    </>);
  } else if (h.kind === "page") {
    const g = model.bySlug.get(h.slug)!;
    const p = g.pages.find((x) => x.id === h.page);
    if (!p) return null;
    const out = g.links.filter(([a]) => a === p.index).length, inn = g.links.filter(([, b]) => b === p.index).length;
    body = (<>
      <p className="tip-eyebrow">{p.start ? "A good place to start" : p.section !== null ? g.sections[p.section] : "Guideline page"}</p>
      <p className="tip-title">{p.title} <code>{p.id}</code></p>
      <p className="tip-meta">{p.boxes} steps{advanced ? ` · ${p.decisions} with an encoded condition · reached from ${inn}, leads to ${out} pages` : ""}</p>
      {ready && bundle?.guideline?.slug === h.slug && bundle.pages[h.page]?.pdf !== undefined && (
        <div className="tip-page"><PageImage t={{ page: bundle.pages[h.page].pdf!, label: h.page }} width={560} /><span>NCCN page {bundle.pages[h.page].pdf! + 1}</span></div>
      )}
    </>);
  } else if (h.kind === "box") {
    const n = bundle?.pages[h.page]?.nodes.find((x) => `${h.page}:${x.id}` === h.node);
    if (!n) return null;
    const text = stripMarks(n.text);
    body = (<>
      <p className="tip-eyebrow">{n.pred ? "A decision" : n.role === "leaf" ? "Recommendation" : "Step"} · <code>{h.page}</code></p>
      {ready && n.bbox && bundle?.pages[h.page]?.pdf !== undefined
        ? <div className="tip-page full"><PageImage t={{ page: bundle.pages[h.page].pdf!, bbox: n.bbox, label: h.page }} width={880} /><span>NCCN page {bundle.pages[h.page].pdf! + 1} · this step is highlighted</span></div>
        : <p className="tip-box">{text.length > 320 ? text.slice(0, 320) + "…" : text}</p>}
    </>);
  } else if (h.kind === "jump") {
    const g = model.bySlug.get(h.slug)!;
    const p = g.pages.find((x) => x.id === h.to);
    body = (<><p className="tip-eyebrow">Go to page</p><p className="tip-title">{p?.title} <code>{h.to}</code></p></>);
  } else if (h.kind === "cite") {
    const g = model.bySlug.get(h.slug)!, t = model.bySlug.get(h.to)!;
    const from = g.cites.find((c) => c.slug === h.to)?.pages.map((i) => g.pages[i]?.id).filter(Boolean) ?? [];
    body = (<><p className="tip-eyebrow site-ink" style={{ "--c": t.site.color } as React.CSSProperties}>Related guideline</p><p className="tip-title">{t.title}</p><p className="tip-meta">Referred to on {from.join(", ")}</p></>);
  }
  const hint = h.kind === "box" ? (ready ? "Click to open the NCCN page in its own window" : "Click to see this step on the page") : h.kind === "page" ? "Click to open this page" : h.kind === "guideline" ? "Click to open this guideline" : h.kind === "site" ? "Click to see its guidelines" : "Click to go there";
  return (
    <div ref={ref} className="tip" style={pos} role="tooltip">
      {body}
      <p className="tip-hint">{hint}</p>
    </div>
  );
}

/* ---------------- panels ---------------- */

function SitePanel({ site, go, preview }: { site: Model["sites"][number]; go: (f: Focus) => void; preview: (h: Hit) => void }) {
  return (
    <div className="panel-body">
      <p className="eyebrow site-ink" style={{ "--c": site.color } as React.CSSProperties}>Site</p>
      <h2 className="panel-title">{site.label}</h2>
      <p className="panel-meta">{site.members.length} guidelines · {fmt(site.members.reduce((n, g) => n + g.pages.length, 0))} pages</p>
      <p className="panel-how">Pick a guideline to find the NCCN recommendation for a patient, or read its pages.</p>
      <ul className="panel-list">
        {site.members.map((g) => (
          <li key={g.slug}>
            <button type="button" onClick={() => go({ level: 1, slug: g.slug })} onMouseEnter={() => preview({ kind: "guideline", slug: g.slug })} onMouseLeave={() => preview(null)} onFocus={() => preview({ kind: "guideline", slug: g.slug })} onBlur={() => preview(null)}>
              <span className={`dot cat-${catClass(g.category)}`} style={{ "--c": site.color } as React.CSSProperties} aria-hidden />
              <span className="pl-title">{g.title}</span>
              <span className="pl-meta">{g.pages.length} pages</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
const catClass = (c: string) => (c === "Treatment" ? "t" : c === "Supportive Care" ? "s" : c === "Specific Populations" ? "p" : "d");

interface GPProps {
  g: GNode; model: Model; focus: Focus; go: (f: Focus) => void; bundle: Bundle | null; loadError: string | null;
  patients: { id: string; label: string; note?: string }[]; chosen: string | null; best: Pathway | null; graph: Graph | null;
  choosePatient: (id: string | null) => void; open: (page?: string) => void; openWithPatient: () => void; preview: (h: Hit) => void;
  enterPatient: () => void; retry: () => void; verify: SrcTarget | null;
}
function GuidelinePanel({ g, model, focus, go, bundle, loadError, patients, chosen, best, graph, choosePatient, open, openWithPatient, preview, enterPatient, retry, verify }: GPProps) {
  const advanced = useAdvanced();
  const src = useSource();
  const verifyHover = useSrc(verify, { click: false });
  const starts = g.pages.filter((p) => p.start);
  const section = focus.level === 1 ? focus.section ?? null : null;
  const last = best && graph ? graph.node(best.steps[best.steps.length - 1]?.node ?? "") : null;
  const chip = (slug: string) => {
    const t = model.bySlug.get(slug)!;
    return (
      <button key={slug} type="button" className="gchip" style={{ "--c": t.site.color } as React.CSSProperties}
        onClick={() => go({ level: 1, slug })} onMouseEnter={() => preview({ kind: "guideline", slug })} onMouseLeave={() => preview(null)}>
        {t.short}
      </button>
    );
  };
  const nPages = best ? new Set(best.steps.map((s) => s.node.split(":")[0])).size : 0;
  // answers the route actually used: the pathway's own list when it has one, else the conditions it met
  const used = best ? ((best as Pathway & { used?: string[] }).used?.length ?? (graph ? best.steps.filter((st) => st.kind === "met" && graph.preds[st.node]).length : 0)) : 0;
  const recText = last ? stripMarks(last.text) : "";
  return (
    <div className="panel-body">
      <p className="eyebrow site-ink" style={{ "--c": g.site.color } as React.CSSProperties}>{g.site.label} · {CATEGORY_LABEL[g.category] ?? g.category}</p>
      <h2 className="panel-title">{g.title}</h2>
      <p className="panel-meta">{g.version ? `Version ${g.version}` : ""}{g.date ? ` · ${g.date}` : ""}</p>
      <div className="pp-actions stack">
        <button type="button" className="btn primary" onClick={() => enterPatient()} data-testid="enter-patient"><UserRound size={15} aria-hidden /> Find a recommendation for a patient</button>
        <button type="button" className="btn" onClick={() => { try { sessionStorage.setItem("oc-intent", "read"); } catch { /* blocked */ } open(starts[0]?.id); }}>Read the guideline <ArrowRight size={15} aria-hidden /></button>
      </div>
      <p className="panel-how">Answer a few questions about the patient to find the NCCN recommendation, or read the guideline pages.</p>

      <section className="psec">
        <h3><UserRound size={14} aria-hidden /> Example patients</h3>
        {loadError ? (
          <div className="note">
            <p>This guideline couldn't open. <button type="button" className="linkish" onClick={retry}>Try again</button></p>
            <details className="more"><summary>Details</summary><span className="le-why">{loadError}</span></details>
          </div>
        ) : !bundle ? <p className="note shimmer">Reading the guideline…</p>
          : patients.length === 0 ? <p className="note">No example patients for this guideline yet. Use “Find a recommendation for a patient” to enter one.</p>
          : (<>
            <div className="pchips" role="group" aria-label="Example patients">
              {patients.map((p) => (
                <button key={p.id} type="button" className={`pchip${chosen === p.id ? " on" : ""}`} aria-pressed={chosen === p.id} title={p.note} onClick={() => choosePatient(chosen === p.id ? null : p.id)}>{p.id === "mine" ? p.label : `Example: ${p.label}`}</button>
              ))}
            </div>
            {chosen && !best && <p className="note">No recommendation fits this patient.</p>}
            {best && (
              <div className="route-card">
                <p className="route-lik"><b>{matchWord(best.likelihood)}</b> · {used > 0 ? supportPhrase(best.open) : "Not yet based on any patient answers"}{advanced && <> · {Math.round(best.likelihood * 100)}% of the weight · {confidenceWord(best.confidence)} confidence ({Math.round(best.confidence)})</>}</p>
                {advanced && <p className="route-meta">{best.met} criteria met · {best.open} still open · through {nPages} pages</p>}
                {last && <p className="route-end">Recommendation: <span>{recText.length > 160 ? `${recText.slice(0, 160).trimEnd()}…` : recText}</span></p>}
                <div className="route-actions">
                  <button type="button" className="btn small" onClick={openWithPatient}>Open in the reader with this patient <ArrowRight size={13} aria-hidden /></button>
                  {verify && <button type="button" className="btn small" {...verifyHover} onClick={() => src.open(verify)}><ExternalLink size={13} aria-hidden /> {T.verify}</button>}
                </div>
                <p className="route-fine">{T.prototype}</p>
              </div>
            )}
          </>)}
      </section>

      {starts.length > 0 && (
        <section className="psec">
          <h3>Where to start</h3>
          <ul className="panel-list compact">
            {starts.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => go({ level: 2, slug: g.slug, page: p.id })} onMouseEnter={() => preview({ kind: "page", slug: g.slug, page: p.id })} onMouseLeave={() => preview(null)}>
                  <span className="pl-title">{p.title}</span><code>{p.id}</code>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {g.sections.length > 1 && (
        <section className="psec">
          <h3>Sections</h3>
          <div className="pchips">
            {g.sections.map((s, i) => (
              <button key={s} type="button" className={`pchip${section === i ? " on" : ""}`} aria-pressed={section === i} onClick={() => go(section === i ? { level: 1, slug: g.slug } : { level: 1, slug: g.slug, section: i })}>{s}</button>
            ))}
          </div>
        </section>
      )}

      <details className="psec about">
        <summary>About this guideline</summary>
        <p className="about-line">{g.pages.length} pages{g.version ? ` · NCCN Guidelines Version ${g.version}` : ""}{g.date ? `, ${g.date}` : ""}.</p>
        <p className="about-line">{T.prototype}</p>
        {advanced && (
          <dl className="stats">
            <div><dt>Algorithm pages</dt><dd>{g.pages.length}</dd></div>
            <div><dt>Boxes</dt><dd>{fmt(g.boxes)}</dd></div>
            <div><dt>Decision boxes encoded</dt><dd>{pct(g.encoded, g.decisions)}%<span className="bar" aria-hidden><i style={{ width: `${pct(g.encoded, g.decisions)}%` }} /></span></dd></div>
          </dl>
        )}
        {g.cites.length > 0 && <><h3>Refers to</h3><div className="gchips">{g.cites.map((c) => chip(c.slug))}</div></>}
        {g.citedBy.length > 0 && <><h3>Referred to by</h3><div className="gchips">{[...new Set(g.citedBy)].map(chip)}</div></>}
        {advanced && <p className="panel-key"><span className="k-start" aria-hidden /> start page <span className="k-wedge" aria-hidden /> share of boxes with a condition <span className="k-dash" aria-hidden /> extra link</p>}
      </details>
    </div>
  );
}

interface PPProps {
  g: GNode; page: string; go: (f: Focus) => void; bundle: Bundle | null; loadError: string | null; route: Route | null;
  open: (node?: string) => void; hoverBox: (node: string | null) => void; preview: (h: Hit) => void;
  pdfReady: boolean; showOriginal: boolean; setShowOriginal: (v: boolean) => void;
  readBox: (node: string) => void; source: (node?: string) => SrcTarget | null; retry: () => void;
}
function PagePanel({ g, page, go, bundle, loadError, route, open, hoverBox, preview, pdfReady, showOriginal, setShowOriginal, readBox, source, retry }: PPProps) {
  const src = useSource();
  const advanced = useAdvanced();
  const pageSrc = source();
  const p = g.pages.find((x) => x.id === page)!;
  const fp = bundle?.pages[page];
  const from = g.links.filter(([, b]) => b === p.index).map(([a]) => g.pages[a]);
  const to = g.links.filter(([a]) => a === p.index).map(([, b]) => g.pages[b]);
  const boxes = (fp?.nodes ?? []).filter((n) => n.kind !== "header");
  const pageLink = (x: typeof p) => (
    <li key={x.id}>
      <button type="button" onClick={() => go({ level: 2, slug: g.slug, page: x.id })} onMouseEnter={() => preview({ kind: "page", slug: g.slug, page: x.id })} onMouseLeave={() => preview(null)}>
        <span className="pl-title">{x.title}</span><code>{x.id}</code>
      </button>
    </li>
  );
  return (
    <div className="panel-body">
      <p className="eyebrow"><button type="button" className="linkish site-ink" onClick={() => go({ level: 1, slug: g.slug })} style={{ "--c": g.site.color } as React.CSSProperties}>{g.short}</button>{p.section !== null ? ` · ${g.sections[p.section]}` : ""}</p>
      <h2 className="panel-title">{p.title} <code className="ptid">{p.id}</code></h2>
      <p className="panel-meta">{advanced ? `${p.boxes} boxes · ${p.decisions} with an encoded condition` : `${p.boxes} ${p.boxes === 1 ? T.step : T.steps}`}{p.start ? " · a good place to start" : ""}</p>
      <div className="pp-actions">
        <button type="button" className="btn primary" onClick={() => { try { sessionStorage.setItem("oc-intent", "read"); } catch { /* blocked */ } open(); }}>Read this page <ArrowRight size={15} aria-hidden /></button>
        <button type="button" className="btn" disabled={!pageSrc} onClick={() => pageSrc && src.open(pageSrc)} data-testid="open-pdf-page"><FileText size={15} aria-hidden /> {T.openPage}</button>
      </div>
      {pdfReady ? (
        <div className="seg" role="group" aria-label="The card shows">
          <button type="button" className={!showOriginal ? "on" : ""} aria-pressed={!showOriginal} onClick={() => setShowOriginal(false)}>Diagram</button>
          <button type="button" className={showOriginal ? "on" : ""} aria-pressed={showOriginal} onClick={() => setShowOriginal(true)}>NCCN page</button>
        </div>
      ) : bundle && <p className="note">The NCCN page isn't available here, so the diagram is rebuilt from the guideline text. <button type="button" className="linkish" onClick={src.pick}>Connect the NCCN PDF</button>{advanced && <> or <button type="button" className="linkish" onClick={src.pickFolder}>a folder of NCCN PDFs</button></>} to see the original page.</p>}
      {route && route.pages.includes(page) && <p className="note route-note">The example patient's path passes through this page (highlighted).</p>}
      <section className="psec">
        <h3>Steps on this page</h3>
        {loadError ? <p className="note">This guideline couldn't open. <button type="button" className="linkish" onClick={retry}>Try again</button></p> : !bundle ? <p className="note shimmer">Reading the page…</p> : !boxes.length ? <p className="note no-boxes">No steps could be read from this page. Open the NCCN page to see it.</p> : (
          <ol className="box-list">
            {boxes.map((n) => { const full = `${page}:${n.id}`; return (
              <BoxRow key={n.id} text={stripMarks(n.text)} cond={!!n.pred} onRoute={!!route?.nodes.has(full)} t={source(full)}
                hover={(on) => hoverBox(on ? full : null)} read={() => readBox(full)} />
            ); })}
          </ol>
        )}
      </section>
      {(from.length > 0 || to.length > 0) && (
        <details className="psec about related">
          <summary>Pages before and after this one</summary>
          {from.length > 0 && <><h3>Comes from</h3><ul className="panel-list compact">{from.map(pageLink)}</ul></>}
          {to.length > 0 && <><h3>Leads to</h3><ul className="panel-list compact">{to.map(pageLink)}</ul></>}
        </details>
      )}
    </div>
  );
}

/** A step in the page panel: hover previews the original NCCN page around it, click opens that page,
 * the arrow opens the step in the reader. */
function BoxRow({ text, cond, onRoute, t, hover, read }: { text: string; cond: boolean; onRoute: boolean; t: SrcTarget | null; hover: (on: boolean) => void; read: () => void }) {
  const src = useSource();
  return (
    <li className={onRoute ? "on-route" : ""}>
      <button type="button" className="bl-main"
        onClick={() => { src.unpeek(); if (t) src.open(t); else read(); }}
        onMouseEnter={(e) => { hover(true); if (t && matchMedia("(hover: hover)").matches) src.peek(t, e.currentTarget); }}
        onMouseLeave={() => { hover(false); src.unpeek(); }}
        onFocus={(e) => { hover(true); if (t) src.peek(t, e.currentTarget); }} onBlur={() => { hover(false); src.unpeek(); }}>
        {cond && <span className="bl-cond" title="Can be checked against the patient's answers" />}
        <span>{text.slice(0, 140)}</span>
      </button>
      <button type="button" className="bl-read" aria-label="Open this step in the reader" title="Open in the reader" onClick={read}><ArrowRight size={13} /></button>
    </li>
  );
}

/* ---------------- first visit ---------------- */

/** How to move around the map, once, until dismissed or a guideline is opened. */
function AtlasHint({ level }: { level: number }) {
  const [show, setShow] = useState(() => readPref("oc-atlas-hint") !== "1");
  const close = useCallback(() => { setShow(false); writePref("oc-atlas-hint", "1"); }, []);
  useEffect(() => { if (level > 0 && show) close(); }, [level, show, close]);
  if (!show || level > 0) return null;
  return (
    <div className="atlas-hint" role="note">
      <span><b>Click</b> a cancer site or guideline to open it</span>
      <span><b>Scroll</b> to zoom</span>
      <span><kbd>Esc</kbd> to go back</span>
      <span><kbd>/</kbd> to search</span>
      <button type="button" aria-label="Dismiss" onClick={close}><X size={13} /></button>
    </div>
  );
}

/* ---------------- legend ---------------- */

function Legend({ onClose }: { onClose: () => void }) {
  const advanced = useAdvanced();
  return (
    <aside className="legend" aria-label="Legend">
      <button type="button" className="panel-x" aria-label="Hide legend" onClick={onClose}><X size={14} /></button>
      <p className="eyebrow">How to read the map</p>
      <ul>
        <li><svg viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="7" className="lg-ring" /><circle cx="10" cy="10" r="4" className="lg-fill" /></svg>Treatment</li>
        <li><svg viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="7" className="lg-ring" /><circle cx="10" cy="10" r="4" className="lg-ring thin" /></svg>Supportive care</li>
        <li><svg viewBox="0 0 20 20" aria-hidden><path d="M10 2 18 10 10 18 2 10Z" className="lg-ring" /><circle cx="10" cy="10" r="2" className="lg-fill" /></svg>Detection, prevention &amp; risk</li>
        <li><svg viewBox="0 0 20 20" aria-hidden><rect x="3" y="3" width="14" height="14" rx="4" className="lg-ring" /><circle cx="10" cy="10" r="2" className="lg-fill" /></svg>Specific populations</li>
      </ul>
      <p className="lg-note">Each colour is a cancer site; the shape is the kind of guideline. Bigger means more pages.{advanced && " Outer arc: share of decision boxes with an encoded condition. Curves: one guideline citing another; point at a guideline to trace them."}</p>
    </aside>
  );
}

/* ---------------- keyboard tree ---------------- */


interface TreeItem { id: string; level: number; label: string; hit: Hit; focus: Focus; parent: string | null; expandable: boolean; open?: () => void }

/** The map as a tree for keyboard and screen-reader use: sites > guidelines > pages. Moving
 * through it lights the matching mark on the map; Enter goes there. */
const MapTree = forwardRef<HTMLDivElement, {
  model: Model; focus: Focus; go: (f: Focus) => void; engine: React.RefObject<Engine | null>;
  openReader: (slug: string, page?: string) => void; setTip: (h: Hit) => void;
}>(function MapTree({ model, focus, go, engine, openReader, setTip }, ref) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cur, setCur] = useState(0);
  const [has, setHas] = useState(false);
  // keep the open branch in step with where the map is
  useEffect(() => {
    const s = new Set(expanded);
    if (focus.level === 0 && focus.site) s.add(`s:${focus.site}`);
    if (focus.level >= 1) { const g = model.bySlug.get((focus as { slug: string }).slug)!; s.add(`s:${g.site.id}`); s.add(`g:${g.slug}`); }
    setExpanded(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, model]);
  const items = useMemo(() => {
    const out: TreeItem[] = [];
    for (const s of model.sites) {
      const sid = `s:${s.id}`;
      out.push({ id: sid, level: 1, label: `${s.label}, ${s.members.length} guidelines`, hit: { kind: "site", site: s.id }, focus: { level: 0, site: s.id }, parent: null, expandable: true });
      if (!expanded.has(sid)) continue;
      for (const g of s.members) {
        const gid = `g:${g.slug}`;
        out.push({ id: gid, level: 2, label: `${g.title}, ${g.pages.length} algorithm pages`, hit: { kind: "guideline", slug: g.slug }, focus: { level: 1, slug: g.slug }, parent: sid, expandable: true });
        if (!expanded.has(gid)) continue;
        for (const p of g.pages) out.push({ id: `p:${g.slug}:${p.id}`, level: 3, label: `${p.id} ${p.title}${p.start ? ", start page" : ""}`, hit: { kind: "page", slug: g.slug, page: p.id }, focus: { level: 2, slug: g.slug, page: p.id }, parent: gid, expandable: false, open: () => openReader(g.slug, p.id) });
      }
    }
    return out;
  }, [model, expanded, openReader]);
  const i = Math.min(cur, items.length - 1);
  const it = items[i];
  useEffect(() => {
    if (!has || !it) return;
    engine.current?.setKbd(it.hit);
    setTip(it.hit);
  }, [has, it, engine, setTip]);
  const toggle = (id: string, on?: boolean) => setExpanded((x) => { const s = new Set(x); if (on ?? !s.has(id)) s.add(id); else s.delete(id); return s; });
  const onKey = (e: React.KeyboardEvent) => {
    if (!it) return;
    const k = e.key;
    if (k === "ArrowDown") setCur(Math.min(items.length - 1, i + 1));
    else if (k === "ArrowUp") setCur(Math.max(0, i - 1));
    else if (k === "Home") setCur(0);
    else if (k === "End") setCur(items.length - 1);
    else if (k === "ArrowRight") { if (it.expandable && !expanded.has(it.id)) toggle(it.id, true); else if (it.expandable) setCur(i + 1); }
    else if (k === "ArrowLeft") { if (it.expandable && expanded.has(it.id)) toggle(it.id, false); else if (it.parent) setCur(items.findIndex((x) => x.id === it.parent)); }
    else if (k === "Enter" || k === " ") {
      const f = focus;
      if (it.focus.level === 2 && f.level === 2 && f.page === (it.focus as { page: string }).page && it.open) it.open();
      else { go(it.focus); if (it.expandable) toggle(it.id, true); }
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div ref={ref} className={`map-tree${has ? " has-focus" : ""}`} role="tree" tabIndex={0} aria-label="Map of guidelines (arrow keys to move, Enter to open)"
      aria-activedescendant={it ? `t-${it.id}` : undefined} onKeyDown={onKey}
      onFocus={() => setHas(true)} onBlur={() => { setHas(false); engine.current?.setKbd(null); setTip(null); }}>
      <ul className="sr">
        {items.map((x, j) => (
          <li key={x.id} id={`t-${x.id}`} role="treeitem" aria-level={x.level} aria-selected={j === i}
            aria-expanded={x.expandable ? expanded.has(x.id) : undefined}>{x.label}</li>
        ))}
      </ul>
      {has && it && <p className="tree-hint" aria-hidden><b>{it.label}</b><span>↑↓ move · → open branch · ← close · Enter go there · Esc back</span></p>}
    </div>
  );
});
