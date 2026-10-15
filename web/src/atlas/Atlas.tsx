/**
 * The atlas home page: one map of every encoded guideline. Search from the hub at the centre or
 * walk the map: site -> guideline (its algorithm pages) -> page (its boxes) -> the reader.
 * The URL hash records where you are (#atlas, #atlas/@gi, #atlas/prostate, #atlas/prostate/PROS-3)
 * so Back goes up a level and links can point at any place on the map.
 */
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronRight, Compass, List, Minus, Plus, Search as SearchIcon, UserRound, X } from "lucide-react";
import type { Bundle, Example, Facts, Library } from "../types";
import { buildGraph, type Graph } from "../lib/graph";
import { rankPathways, likelihoodWord, confidenceWord, hasFacts, type Pathway } from "../lib/pathways";
import { stripMarks } from "../lib/adapt";
import { buildModel, searchIndex, CATEGORY_LABEL, type AtlasRaw, type GNode, type Model, type SearchHit } from "./model";
import { Engine, type Focus, type Hit, type Route } from "./engine";
import { getGuideline } from "../Library";
import { readPatient, writePatient } from "../lib/patient";
import "./atlas.css";

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
  const narrow = useMedia("(max-width: 640px)");
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
    engineRef.current?.setFocus(f);
    try { if (push) history.pushState(null, "", atlasHash(f)); else history.replaceState(null, "", atlasHash(f)); } catch { /* file:// */ }
  }, []);
  const up = useCallback(() => {
    const f = focusRef.current;
    if (f.level === 2) go({ level: 1, slug: f.slug });
    else if (f.level === 1) go(f.section != null ? { level: 1, slug: f.slug } : { level: 0, site: model.bySlug.get(f.slug)!.site.id });
    else if (f.site) go({ level: 0 });
  }, [go, model]);
  const openReader = useCallback((s: string, page?: string, node?: string, rect: DOMRect | null = null) => {
    morph(rect, () => onOpen(s, page, node));
  }, [onOpen]);

  // back / forward
  useEffect(() => {
    const f = () => {
      if (!location.hash.startsWith("#atlas") && location.hash !== "" && location.hash !== "#") return;
      const n = parseAtlasHash(location.hash, model);
      if (!sameFocus(n, focusRef.current)) { focusRef.current = n; setFocus(n); engineRef.current?.setFocus(n); }
    };
    window.addEventListener("hashchange", f);
    window.addEventListener("popstate", f);
    return () => { window.removeEventListener("hashchange", f); window.removeEventListener("popstate", f); };
  }, [model]);

  /* ----- engine ----- */
  useEffect(() => {
    const c = canvasRef.current!;
    const e = new Engine(c, model, {
      hover: (hit, x, y) => setTip(hit ? { hit, x, y } : null),
      click: (hit, rect) => {
        if (!hit) return;
        const f = focusRef.current;
        if (hit.kind === "site") go({ level: 0, site: hit.site });
        else if (hit.kind === "guideline") go(f.level === 2 && f.slug === hit.slug ? { level: 1, slug: hit.slug } : { level: 1, slug: hit.slug });
        else if (hit.kind === "page") go({ level: 2, slug: hit.slug, page: hit.page });
        else if (hit.kind === "box") openReader(hit.slug, hit.page, hit.node, rect);
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
    getGuideline(lib, slug).then((b) => {
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
  const bundle = slug && typeof bundles[slug] === "object" ? (bundles[slug] as Bundle) : null;
  const loadError = slug && typeof bundles[slug] === "string" ? (bundles[slug] as string) : null;
  const graph = useMemo<Graph | null>(() => (bundle ? buildGraph(bundle) : null), [bundle]);

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
  useEffect(() => { engineRef.current?.setPreview(searchOpen && hits[active] ? hitOf(hits[active]) : null); }, [hits, active, searchOpen]);

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

  const canvasLabel = focus.level === 2 ? `${g!.title}, page ${focus.page}: its boxes as printed` : g ? `${g.title}: ${g.pages.length} algorithm pages and the links between them` : site ? `${site.label}: ${site.members.length} guidelines` : `Map of ${model.guidelines.length} guidelines in ${model.sites.length} sites, with ${model.links.length} references between them`;

  return (
    <div className={`atlas${docked ? " is-docked" : ""}${panel ? " has-panel" : ""}`}>
      <canvas ref={canvasRef} className="atlas-canvas" role="img" aria-label={canvasLabel} />

      <header className="atlas-top">
        <nav className="crumbs" aria-label="Where you are">
          <span className="crumb-mark" aria-hidden><Compass size={16} /></span>
          {(narrow && crumbs.length > 2 ? crumbs.slice(-2) : crumbs).map((c, i) => (
            <span key={i} className="crumb">
              {i > 0 && <ChevronRight size={13} aria-hidden className="crumb-sep" />}
              {c.f ? <button type="button" onClick={() => go(c.f!)}>{c.root ? <b>OncoCarta</b> : c.label}</button> : <span aria-current="page">{c.root ? <b>OncoCarta</b> : c.label}</span>}
            </span>
          ))}
        </nav>
        <div className="view-switch" role="group" aria-label="View">
          <button type="button" className="on" aria-pressed="true"><Compass size={14} aria-hidden /> Atlas</button>
          <button type="button" aria-pressed="false" onClick={onList} data-testid="to-list"><List size={14} aria-hidden /> List</button>
        </div>
      </header>

      <div ref={hubRef} className={`hub${docked ? " docked" : ""}${gliding ? " gliding" : ""}`} role="search">
        {!docked && <p className="hub-brand" aria-hidden>Onco<span>Carta</span></p>}
        <div className="hub-q">
        <div className={`hub-field${searchOpen && q ? " open" : ""}`}>
          <SearchIcon size={16} aria-hidden />
          <input ref={inputRef} type="search" value={q} placeholder={docked ? "Search guidelines and pages" : `Search ${model.guidelines.length} guidelines`}
            aria-label="Search guidelines, sections and pages" role="combobox" aria-expanded={searchOpen && hits.length > 0} aria-controls="atlas-results"
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
                <span className={`res-kind k-${h.kind}`}>{h.kind === "guideline" ? "Guideline" : h.kind === "site" ? "Site" : h.kind === "section" ? "Section" : "Page"}</span>
                <span className="res-label">{h.label}</span>
                <span className="res-sub">{h.sub}</span>
              </li>
            ))}
            {!hits.length && <li className="res-none" role="option" aria-selected="false" aria-disabled="true">Nothing matches “{q}”.</li>}
          </ul>
        )}
        </div>
        {!docked && <p className="hub-meta">{fmt(model.guidelines.length)} guidelines · {fmt(model.totalPages)} algorithm pages · {fmt(model.links.length)} cross-references</p>}
        {!docked && <p className="hub-hint">or follow a branch of the map</p>}
      </div>

      {tip && <Tip tip={tip} model={model} bundle={bundle} />}

      {panel && (
        <aside className="atlas-panel" aria-label="Details" key={atlasHash(focus)}>
          <button type="button" className="panel-x" aria-label="Hide details" onClick={() => setPanelHidden(true)}><X size={16} /></button>
          {site && <SitePanel site={site} go={go} preview={(h) => engineRef.current?.setPreview(h)} />}
          {g && focus.level === 1 && (
            <GuidelinePanel g={g} model={model} focus={focus} go={go} bundle={bundle} loadError={loadError}
              patients={patients} chosen={chosen?.id ?? null} best={best} graph={graph}
              choosePatient={(id) => setPatient(id && slug ? { slug, id } : null)}
              open={(page) => openReader(g.slug, page)}
              openWithPatient={() => { if (chosen && route) { writePatient(g.slug, chosen.facts, chosen.age); openReader(g.slug, route.pages[0]); } }}
              preview={(h) => engineRef.current?.setPreview(h)} />
          )}
          {g && focus.level === 2 && (
            <PagePanel g={g} page={focus.page} go={go} bundle={bundle} loadError={loadError} route={route}
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

      <div className="zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => engineRef.current?.zoomBy(1.6)}><Plus size={16} /></button>
        <button type="button" aria-label="Zoom out" title="Zoom out (−)" onClick={() => engineRef.current?.zoomBy(1 / 1.6)}><Minus size={16} /></button>
        <button type="button" aria-label="Fit to screen" title="Fit (0)" onClick={() => engineRef.current?.setFocus(focusRef.current)}><Compass size={16} /></button>
      </div>

      <MapTree ref={treeRef} model={model} focus={focus} go={go} engine={engineRef} openReader={(s, p) => openReader(s, p)}
        setTip={(hit) => { const pt = hit && engineRef.current?.screenOf(hit); setTip(hit && pt ? { hit, x: pt[0], y: pt[1] } : null); }} />
    </div>
  );
}

function safeArea(panel: boolean, wide: boolean) {
  const w = innerWidth, h = innerHeight;
  const top = 60;
  if (panel && wide) return { x0: 0, y0: top, x1: w - 384, y1: h - 8 };
  if (panel) return { x0: 0, y0: top + 40, x1: w, y1: h - Math.min(h * 0.42, 360) };
  return { x0: 0, y0: w <= 640 ? top + 48 : top - 20, x1: w, y1: h - 8 };
}

/* ---------------- tooltip ---------------- */

function Tip({ tip, model, bundle }: { tip: { hit: Hit; x: number; y: number }; model: Model; bundle: Bundle | null }) {
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
      <p className="tip-eyebrow" style={{ color: g.site.color }}>{g.site.label} · {CATEGORY_LABEL[g.category] ?? g.category}</p>
      <p className="tip-title">{g.title}</p>
      <p className="tip-meta">{g.version ? `Version ${g.version}` : ""}{g.date ? ` · ${g.date}` : ""}</p>
      <dl className="tip-stats">
        <div><dt>Algorithm pages</dt><dd>{g.pages.length}</dd></div>
        <div><dt>Boxes</dt><dd>{fmt(g.boxes)}</dd></div>
        <div><dt>Encoded conditions</dt><dd>{fmt(g.encoded)}</dd></div>
      </dl>
      {(g.cites.length > 0 || g.citedBy.length > 0) && <p className="tip-meta">Cites {g.cites.length} · cited by {g.citedBy.length} guidelines</p>}
    </>);
  } else if (h.kind === "site") {
    const s = model.sites.find((x) => x.id === h.site)!;
    body = (<>
      <p className="tip-eyebrow" style={{ color: s.color }}>Site</p>
      <p className="tip-title">{s.label}</p>
      <p className="tip-meta">{s.members.length} guidelines: {s.members.slice(0, 4).map((x) => x.short).join(", ")}{s.members.length > 4 ? "…" : ""}</p>
    </>);
  } else if (h.kind === "page") {
    const g = model.bySlug.get(h.slug)!;
    const p = g.pages.find((x) => x.id === h.page);
    if (!p) return null;
    const out = g.links.filter(([a]) => a === p.index).length, inn = g.links.filter(([, b]) => b === p.index).length;
    body = (<>
      <p className="tip-eyebrow"><code>{p.id}</code>{p.start ? " · Start page" : ""}{p.section !== null ? ` · ${g.sections[p.section]}` : ""}</p>
      <p className="tip-title">{p.title}</p>
      <p className="tip-meta">{p.boxes} boxes · {p.decisions} with an encoded condition · reached from {inn}, leads to {out} pages</p>
    </>);
  } else if (h.kind === "box") {
    const n = bundle?.pages[h.page]?.nodes.find((x) => `${h.page}:${x.id}` === h.node);
    if (!n) return null;
    const text = stripMarks(n.text);
    body = (<>
      <p className="tip-eyebrow"><code>{h.page}</code> · {n.pred ? "Condition" : n.role === "leaf" ? "Next step" : "Box"}</p>
      <p className="tip-box">{text.length > 320 ? text.slice(0, 320) + "…" : text}</p>
    </>);
  } else if (h.kind === "jump") {
    const g = model.bySlug.get(h.slug)!;
    const p = g.pages.find((x) => x.id === h.to);
    body = (<><p className="tip-eyebrow">Go to page</p><p className="tip-title"><code>{h.to}</code> {p?.title}</p></>);
  } else if (h.kind === "cite") {
    const g = model.bySlug.get(h.slug)!, t = model.bySlug.get(h.to)!;
    const from = g.cites.find((c) => c.slug === h.to)?.pages.map((i) => g.pages[i]?.id).filter(Boolean) ?? [];
    body = (<><p className="tip-eyebrow" style={{ color: t.site.color }}>Cited guideline</p><p className="tip-title">{t.title}</p><p className="tip-meta">Cited on {from.join(", ")}</p></>);
  }
  const hint = h.kind === "box" ? "Click to read it in the guideline" : h.kind === "page" ? "Click to open the page" : h.kind === "guideline" ? "Click to open its map" : h.kind === "site" ? "Click to zoom to this site" : "Click to go there";
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
      <p className="eyebrow" style={{ color: site.color }}>Site</p>
      <h2 className="panel-title">{site.label}</h2>
      <p className="panel-meta">{site.members.length} guidelines · {fmt(site.members.reduce((n, g) => n + g.pages.length, 0))} algorithm pages</p>
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
}
function GuidelinePanel({ g, model, focus, go, bundle, loadError, patients, chosen, best, graph, choosePatient, open, openWithPatient, preview }: GPProps) {
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
  return (
    <div className="panel-body">
      <p className="eyebrow" style={{ color: g.site.color }}>{g.site.label} · {CATEGORY_LABEL[g.category] ?? g.category}</p>
      <h2 className="panel-title">{g.title}</h2>
      <p className="panel-meta">{g.version ? `Version ${g.version}` : ""}{g.date ? ` · ${g.date}` : ""}</p>
      <dl className="stats">
        <div><dt>Algorithm pages</dt><dd>{g.pages.length}</dd></div>
        <div><dt>Boxes</dt><dd>{fmt(g.boxes)}</dd></div>
        <div><dt>Decision boxes encoded</dt><dd>{pct(g.encoded, g.decisions)}%<span className="bar" aria-hidden><i style={{ width: `${pct(g.encoded, g.decisions)}%` }} /></span></dd></div>
      </dl>
      <button type="button" className="btn primary wide" onClick={() => open(starts[0]?.id)}>Open the guideline <ArrowRight size={15} aria-hidden /></button>

      <section className="psec">
        <h3><UserRound size={14} aria-hidden /> A patient's route</h3>
        {loadError ? <p className="note">Could not read this guideline: {loadError}</p>
          : !bundle ? <p className="note shimmer">Reading the guideline…</p>
          : patients.length === 0 ? <p className="note">No example patients for this guideline yet. Enter a patient in the reader and come back: the route shows up here.</p>
          : (<>
            <div className="pchips" role="group" aria-label="Patient">
              {patients.map((p) => (
                <button key={p.id} type="button" className={`pchip${chosen === p.id ? " on" : ""}`} aria-pressed={chosen === p.id} title={p.note} onClick={() => choosePatient(chosen === p.id ? null : p.id)}>{p.label}</button>
              ))}
            </div>
            {chosen && !best && <p className="note">No route fits this patient from the start pages.</p>}
            {best && (
              <div className="route-card">
                <p className="route-lik"><b>{likelihoodWord(best.likelihood)}</b> · {Math.round(best.likelihood * 100)}% of the weight · {confidenceWord(best.confidence)} confidence ({Math.round(best.confidence)})</p>
                <p className="route-meta">{best.met} criteria met · {best.open} still open · through {new Set(best.steps.map((s) => s.node.split(":")[0])).size} pages</p>
                {last && <p className="route-end">Ends at: <span>{stripMarks(last.text).slice(0, 160)}</span></p>}
                <button type="button" className="btn small" onClick={openWithPatient}>Open in the reader with this patient <ArrowRight size={13} aria-hidden /></button>
              </div>
            )}
          </>)}
      </section>

      {starts.length > 0 && (
        <section className="psec">
          <h3>Start here</h3>
          <ul className="panel-list compact">
            {starts.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => go({ level: 2, slug: g.slug, page: p.id })} onMouseEnter={() => preview({ kind: "page", slug: g.slug, page: p.id })} onMouseLeave={() => preview(null)}>
                  <code>{p.id}</code><span className="pl-title">{p.title}</span>
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

      {(g.cites.length > 0 || g.citedBy.length > 0) && (
        <section className="psec">
          {g.cites.length > 0 && <><h3>Cites</h3><div className="gchips">{g.cites.map((c) => chip(c.slug))}</div></>}
          {g.citedBy.length > 0 && <><h3>Cited by</h3><div className="gchips">{[...new Set(g.citedBy)].map(chip)}</div></>}
        </section>
      )}
      <p className="panel-key"><span className="k-start" aria-hidden /> start page <span className="k-wedge" aria-hidden /> share of boxes with a condition <span className="k-dash" aria-hidden /> extra link</p>
    </div>
  );
}

interface PPProps {
  g: GNode; page: string; go: (f: Focus) => void; bundle: Bundle | null; loadError: string | null; route: Route | null;
  open: (node?: string) => void; hoverBox: (node: string | null) => void; preview: (h: Hit) => void;
}
function PagePanel({ g, page, go, bundle, loadError, route, open, hoverBox, preview }: PPProps) {
  const p = g.pages.find((x) => x.id === page)!;
  const fp = bundle?.pages[page];
  const from = g.links.filter(([, b]) => b === p.index).map(([a]) => g.pages[a]);
  const to = g.links.filter(([a]) => a === p.index).map(([, b]) => g.pages[b]);
  const boxes = (fp?.nodes ?? []).filter((n) => n.kind !== "header");
  const pageLink = (x: typeof p) => (
    <li key={x.id}>
      <button type="button" onClick={() => go({ level: 2, slug: g.slug, page: x.id })} onMouseEnter={() => preview({ kind: "page", slug: g.slug, page: x.id })} onMouseLeave={() => preview(null)}>
        <code>{x.id}</code><span className="pl-title">{x.title}</span>
      </button>
    </li>
  );
  return (
    <div className="panel-body">
      <p className="eyebrow"><button type="button" className="linkish" onClick={() => go({ level: 1, slug: g.slug })} style={{ color: g.site.color }}>{g.short}</button>{p.section !== null ? ` · ${g.sections[p.section]}` : ""}</p>
      <h2 className="panel-title"><code className="ptid">{p.id}</code> {p.title}</h2>
      <p className="panel-meta">{p.boxes} boxes · {p.decisions} with an encoded condition{p.start ? " · a start page" : ""}</p>
      <button type="button" className="btn primary wide" onClick={() => open()}>Read this page <ArrowRight size={15} aria-hidden /></button>
      {route && route.pages.includes(page) && <p className="note route-note">The selected patient's route passes through this page (highlighted).</p>}
      {(from.length > 0 || to.length > 0) && (
        <section className="psec two">
          {from.length > 0 && <div><h3>Reached from</h3><ul className="panel-list compact">{from.map(pageLink)}</ul></div>}
          {to.length > 0 && <div><h3>Leads to</h3><ul className="panel-list compact">{to.map(pageLink)}</ul></div>}
        </section>
      )}
      <section className="psec">
        <h3>Boxes on this page</h3>
        {loadError ? <p className="note">Could not read this guideline: {loadError}</p> : !bundle ? <p className="note shimmer">Reading the page…</p> : !boxes.length ? <p className="note no-boxes">No boxes were extracted from this page. Read it in the guideline, or check the source PDF.</p> : (
          <ol className="box-list">
            {boxes.map((n) => { const full = `${page}:${n.id}`; return (
              <li key={n.id} className={route?.nodes.has(full) ? "on-route" : ""}>
                <button type="button" onClick={() => open(full)} onMouseEnter={() => hoverBox(full)} onMouseLeave={() => hoverBox(null)} onFocus={() => hoverBox(full)} onBlur={() => hoverBox(null)}>
                  {n.pred && <span className="bl-cond" title="Has an encoded condition" />}
                  <span>{stripMarks(n.text).slice(0, 140)}</span>
                </button>
              </li>
            ); })}
          </ol>
        )}
      </section>
    </div>
  );
}

/* ---------------- legend ---------------- */

function Legend({ onClose }: { onClose: () => void }) {
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
      <p className="lg-note">Size: number of algorithm pages. Outer arc: share of decision boxes with an encoded condition. Curves: one guideline citing another; point at a guideline to trace them.</p>
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
