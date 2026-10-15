/**
 * The guideline library: data/index.json lists every encoded guideline; each one is loaded
 * from data/<slug>/guideline.json when opened. The URL hash carries the guideline
 * ("#prostate/flow/PROS-3"), so links between guidelines and browser history work.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Search as SearchIcon, ArrowRight, Compass, List } from "lucide-react";
import type { Bundle, Example, Library, LibraryEntry } from "./types";
import { adaptGuideline, isGuidelineFile } from "./lib/adapt";
import { Provider, useAdvanced, type LibraryNav } from "./store";
import { readPref, writePref } from "./lib/prefs";
import { T } from "./lib/terms";
import { SourceProvider } from "./source";
import { App } from "./App";
import { Atlas } from "./atlas/Atlas";
import { pdfCandidates, registerGuidelines } from "./lib/pdf";
import type { AtlasRaw } from "./atlas/model";

/** The guideline the hash points into; "#atlas…" and "#list" are the home views. */
const slugOf = (hash: string) => { const m = hash.replace(/^#/, "").match(/^([a-z0-9_]+)(\/|$)/); return m && m[1] !== "atlas" && m[1] !== "list" ? m[1] : null; };
/** On a phone the first visit (no hash) opens the list: the radial map is one tap away. */
const phoneFirst = (hash: string) => hash.replace(/^#/, "") === "" && typeof matchMedia !== "undefined" && matchMedia("(max-width: 480px)").matches;
const homeView = (hash: string): "atlas" | "list" => (hash.replace(/^#/, "").startsWith("list") || phoneFirst(hash) ? "list" : "atlas");
const RECENT = "nav-recent";
const recent = (): string[] => { try { return JSON.parse(readPref(RECENT) ?? "[]"); } catch { return []; } };
const remember = (slug: string) => writePref(RECENT, JSON.stringify([slug, ...recent().filter((s) => s !== slug)].slice(0, 6)));

/** Find data/index.json next to the page (or where the build said it is). */
export async function findLibrary(): Promise<Library | null> {
  const L = window.__LIBRARY__;
  if (L?.index?.length) {
    // the guideline list is in the page: nothing to fetch (works opened from disk)
    registerGuidelines(L.index);
    return { base: L.base ?? "../data/", guidelines: L.index, pdfs: L.pdfs, packs: L.packs };
  }
  const bases = [window.__LIBRARY__?.base, "data/", "../data/", "./"].filter((x): x is string => typeof x === "string");
  for (const base of [...new Set(bases)]) {
    try {
      const r = await fetch(`${base}index.json`);
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j?.guidelines)) {
        const guidelines = j.guidelines as LibraryEntry[];
        registerGuidelines(guidelines);
        return { base, guidelines, pdfs: window.__LIBRARY__?.pdfs };
      }
    } catch { /* file:// or not there */ }
  }
  return null;
}

const cache = new Map<string, Promise<Bundle>>();
const forget = (slug: string) => { cache.delete(slug); if (window.__OC_PACKS) delete window.__OC_PACKS[slug]; };
/** A guideline, read once per page load (the atlas and the reader share it). */
export function getGuideline(lib: Library, slug: string): Promise<Bundle> {
  let p = cache.get(slug);
  if (!p) {
    const e = lib.guidelines.find((x) => x.slug === slug);
    p = e ? loadGuideline(lib, e) : Promise.reject(new Error(`No guideline called “${slug}”.`));
    p.catch(() => cache.delete(slug));
    cache.set(slug, p);
  }
  return p;
}

/** A guideline packed as a script next to the page (python -m nccn_nav.dashboard --library).
 * Script tags load from disk where fetch() is refused, so this works for a page opened as a file. */
function loadPack(lib: Library, slug: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const have = window.__OC_PACKS?.[slug];
    const unpack = (b64: string) => {
      if (typeof DecompressionStream === "undefined") { reject(new Error("This browser is too old to open the guideline. Use a current Safari, Chrome or Firefox.")); return; }
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
        .then((t) => resolve(JSON.parse(t)), reject);
    };
    if (have) { unpack(have); return; }
    const el = document.createElement("script");
    el.src = `${lib.packs}${slug}.js`;
    el.async = true;
    el.onload = () => { const b64 = window.__OC_PACKS?.[slug]; if (b64) unpack(b64); else reject(new Error(`${el.src} did not contain the guideline`)); };
    el.onerror = () => reject(new Error(`could not read ${new URL(el.src, location.href).href}`));
    document.head.appendChild(el);
  });
}

async function loadGuideline(lib: Library, e: LibraryEntry): Promise<Bundle> {
  let j: unknown = null;
  const errs: string[] = [];
  let packed = false;
  if (lib.packs) {
    try { j = await loadPack(lib, e.slug); packed = !!j; } catch (err) { errs.push(String((err as Error).message ?? err)); }
  }
  if (!j) {
    const url = new URL(`${lib.base}${e.path}`, location.href).href;
    for (let attempt = 0; attempt < 2 && !j; attempt++) {   // one retry: a dropped connection is often transient
      try {
        const r = await fetch(url, { cache: attempt ? "reload" : "default" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        j = await r.json();
      } catch (err) {
        if (attempt) errs.push(`${url}: ${String((err as Error).message ?? err)}`);
        else await new Promise((res) => setTimeout(res, 300));
      }
    }
  }
  if (!j) {
    const disk = location.protocol === "file:";
    throw new Error(disk
      ? `the guideline files were not found next to this page (${errs.join("; ")}). Keep the page in its folder: built/oncocarta.html needs built/guidelines/ beside it.`
      : errs.join("; "));
  }
  if (!isGuidelineFile(j)) throw new Error(`${e.path} is not an OncoCarta guideline file`);
  const b = adaptGuideline(j);
  b.pdf_candidates = pdfCandidates(lib.base, e.slug, lib.pdfs);   // a served copy of the source PDF, if any
  // a packed guideline carries its example patients (or has none): no request, no 404 in the console
  if (!packed && !b.examples?.length && location.protocol.startsWith("http")) {
    try {   // hand-encoded example patients, when the guideline has them
      const x = await fetch(`${lib.base}${e.slug}/vignettes/examples.json`);
      if (x.ok) b.examples = (await x.json()) as Example[];
    } catch { /* none */ }
  }
  return b;
}

export function LibraryShell({ lib, atlas = null }: { lib: Library; atlas?: AtlasRaw | null }) {
  const [slug, setSlug] = useState<string | null>(() => slugOf(location.hash));
  const [view, setView] = useState(() => homeView(location.hash));
  const [state, setState] = useState<{ slug: string; bundle: Bundle } | { slug: string; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const f = () => { setSlug(slugOf(location.hash)); setView(homeView(location.hash)); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    if (!slug) { setState(null); document.title = "OncoCarta"; return; }
    const e = lib.guidelines.find((x) => x.slug === slug);
    if (!e) { setState({ slug, error: `No guideline called “${slug}” in this library.` }); return; }
    let off = false;
    setState(null);
    getGuideline(lib, slug).then((bundle) => {
      if (off) return;
      remember(slug);
      document.title = `${e.title} · OncoCarta`;
      setState({ slug, bundle });
    }).catch((err) => { if (!off) setState({ slug, error: String(err.message ?? err) }); });
    return () => { off = true; };
  }, [slug, lib, attempt]);

  const nav = useMemo<LibraryNav>(() => ({
    entries: lib.guidelines,
    open: (s, code) => { location.hash = `#${s}/${code ? `ref/${code.split("/").map(encodeURIComponent).join("/")}` : ""}`; },
    home: (page?: string | null) => {
      const at = slugOf(location.hash);
      location.hash = atlas && at ? `#atlas/${at}${page ? `/${encodeURIComponent(page)}` : ""}` : atlas ? "#atlas" : "#list";
    },
  }), [lib, atlas]);

  if (!slug) {
    if (atlas && view === "atlas") {
      return <Atlas lib={lib} raw={atlas} onList={() => { location.hash = "#list"; }}
        onOpen={(s, page, node) => { location.hash = `#${s}/${page ? `flow/${encodeURIComponent(page)}${node ? `/${node.split(":")[1] ?? ""}` : ""}` : ""}`; }} />;
    }
    return <LibraryHome lib={lib} onOpen={(s) => nav.open(s)} onAtlas={atlas ? () => { location.hash = "#atlas"; } : undefined} />;
  }
  if (!state) return <div className="lib-loading" role="status">Loading {lib.guidelines.find((x) => x.slug === slug)?.title ?? slug}…</div>;
  if ("error" in state) {
    return (
      <div className="lib-loading load-error" role="alert">
        <h2>This guideline couldn't open</h2>
        <p>Try again, or go back to all guidelines.</p>
        <div className="le-actions">
          <button type="button" className="btn primary" onClick={() => { forget(state.slug); setAttempt((a) => a + 1); }}>Try again</button>
          <button type="button" className="btn" onClick={() => nav.home()}>Back to all guidelines</button>
        </div>
        <details className="le-details">
          <summary>Details</summary>
          <p className="le-why">{state.error}</p>
          <p className="note">{location.protocol === "file:"
            ? "Opened from disk: keep built/oncocarta.html next to its built/guidelines/ folder."
            : `Served from ${location.host}. If the address is 0.0.0.0 or [::], open it as localhost instead; check the server is still running.`}</p>
        </details>
      </div>
    );
  }
  return (
    <Provider key={state.slug} bundle={state.bundle} slug={state.slug} library={nav}>
      <SourceProvider><App /></SourceProvider>
    </Provider>
  );
}

const CATEGORY_ORDER = ["Treatment", "Detection Prevention Risk Reduction", "Supportive Care", "Specific Populations"];
const CATEGORY_LABEL: Record<string, string> = { "Detection Prevention Risk Reduction": "Detection, prevention and risk reduction" };

function quality(e: LibraryEntry) {
  const q = (e.quality ?? {}) as { algorithm_pages?: number; boxes?: number; decision_boxes?: number; predicate_status?: Record<string, number> };
  const st = q.predicate_status ?? {};
  const encoded = (st.model_reviewed ?? 0) + (st.inherited_from_link ?? 0) + (st.section_only ?? 0);
  return { pages: q.algorithm_pages ?? 0, boxes: q.boxes ?? 0, encoded, rejected: st.rejected ?? 0 };
}

export function LibraryHome({ lib, onOpen, onAtlas }: { lib: Library; onOpen: (slug: string) => void; onAtlas?: () => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const term = q.trim().toLowerCase();
  const list = useMemo(() => lib.guidelines.filter((e) => (!cat || e.category === cat) && (!term || `${e.title} ${e.slug}`.toLowerCase().includes(term))), [lib, cat, term]);
  const groups = CATEGORY_ORDER.concat([...new Set(lib.guidelines.map((e) => e.category))].filter((c) => !CATEGORY_ORDER.includes(c)))
    .map((c) => ({ c, items: list.filter((e) => e.category === c).sort((a, b) => a.title.localeCompare(b.title)) })).filter((x) => x.items.length);
  const rec = recent().map((s) => lib.guidelines.find((e) => e.slug === s)).filter((e): e is LibraryEntry => !!e);
  const onKey = useCallback((e: React.KeyboardEvent) => { if (e.key === "Enter" && list.length === 1) onOpen(list[0].slug); }, [list, onOpen]);
  return (
    <div className="lib">
      <header className="lib-head">
        {onAtlas && (
          <div className="view-switch lib-switch" role="group" aria-label="View">
            <button type="button" aria-pressed="false" onClick={onAtlas} data-testid="to-atlas"><Compass size={14} aria-hidden /> Map</button>
            <button type="button" className="on" aria-pressed="true"><List size={14} aria-hidden /> List</button>
          </div>
        )}
        <h1 className="brand">OncoCarta</h1>
        <p className="lib-count">{lib.guidelines.length} NCCN guidelines</p>
        <p className="lib-lead">Pick a guideline to find the NCCN recommendation for a patient, or read its pages.</p>
        <div className="field lib-search">
          <SearchIcon size={15} aria-hidden />
          <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Which cancer or topic?" aria-label="Find a guideline" />
        </div>
        <div className="chips" role="group" aria-label="Category">
          <button type="button" className={`chip${!cat ? " on" : ""}`} aria-pressed={!cat} onClick={() => setCat(null)}>All</button>
          {CATEGORY_ORDER.filter((c) => lib.guidelines.some((e) => e.category === c)).map((c) => (
            <button key={c} type="button" className={`chip${cat === c ? " on" : ""}`} aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
              {CATEGORY_LABEL[c] ?? c} <em>{lib.guidelines.filter((e) => e.category === c).length}</em>
            </button>
          ))}
        </div>
      </header>
      {!term && !cat && rec.length > 0 && (
        <section className="lib-sec">
          <h2>Recently opened</h2>
          <ul className="lib-list">{rec.map((e) => <Row key={e.slug} e={e} onOpen={onOpen} />)}</ul>
        </section>
      )}
      {groups.map(({ c, items }) => (
        <section key={c} className="lib-sec">
          <h2>{CATEGORY_LABEL[c] ?? c} <em>{items.length}</em></h2>
          <ul className="lib-list">{items.map((e) => <Row key={e.slug} e={e} onOpen={onOpen} />)}</ul>
        </section>
      ))}
      {!list.length && <p className="note lib-none">No guideline matches “{q}”.</p>}
      <p className="lib-fine">OncoCarta is an independent research prototype built on NCCN Guidelines®. It is not made, reviewed or endorsed by NCCN. {T.prototype}</p>
    </div>
  );
}

function Row({ e, onOpen }: { e: LibraryEntry; onOpen: (slug: string) => void }) {
  const advanced = useAdvanced();
  const q = quality(e);
  return (
    <li>
      <button type="button" className="lib-row" onClick={() => onOpen(e.slug)}>
        <BookOpen size={16} aria-hidden />
        <span className="lib-title">{e.title}</span>
        <span className="lib-meta">{e.version ? `Version ${e.version}` : ""}{e.version_date ? ` · ${e.version_date}` : ""}</span>
        {advanced && <span className="lib-q" title="Algorithm pages · boxes with an encoded condition">{q.pages} algorithm pages · {q.encoded} conditions</span>}
        <ArrowRight size={14} aria-hidden className="lib-go" />
      </button>
    </li>
  );
}
