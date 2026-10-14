/**
 * The guideline library: data/index.json lists every encoded guideline; each one is loaded
 * from data/<slug>/guideline.json when opened. The URL hash carries the guideline
 * ("#prostate/flow/PROS-3"), so links between guidelines and browser history work.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Search as SearchIcon, ArrowRight } from "lucide-react";
import type { Bundle, Example, Library, LibraryEntry } from "./types";
import { adaptGuideline, isGuidelineFile } from "./lib/adapt";
import { Provider, type LibraryNav } from "./store";
import { SourceProvider } from "./source";
import { App } from "./App";

const slugOf = (hash: string) => { const m = hash.replace(/^#/, "").match(/^([a-z0-9_]+)(\/|$)/); return m ? m[1] : null; };
const RECENT = "nav-recent";
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? "[]"); } catch { return []; } };
const remember = (slug: string) => { try { localStorage.setItem(RECENT, JSON.stringify([slug, ...recent().filter((s) => s !== slug)].slice(0, 6))); } catch { /* storage blocked */ } };

/** Find data/index.json next to the page (or where the build said it is). */
export async function findLibrary(): Promise<Library | null> {
  const bases = [window.__LIBRARY__?.base, "data/", "../data/", "./"].filter((x): x is string => typeof x === "string");
  for (const base of [...new Set(bases)]) {
    try {
      const r = await fetch(`${base}index.json`);
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j?.guidelines)) return { base, guidelines: j.guidelines as LibraryEntry[] };
    } catch { /* file:// or not there */ }
  }
  return null;
}

async function loadGuideline(lib: Library, e: LibraryEntry): Promise<Bundle> {
  const r = await fetch(`${lib.base}${e.path}`);
  if (!r.ok) throw new Error(`${e.path}: HTTP ${r.status}`);
  const j = await r.json();
  if (!isGuidelineFile(j)) throw new Error(`${e.path} is not a guideline.json file`);
  const b = adaptGuideline(j);
  try {   // hand-encoded example patients, when the guideline has them
    const x = await fetch(`${lib.base}${e.slug}/vignettes/examples.json`);
    if (x.ok) b.examples = (await x.json()) as Example[];
  } catch { /* none */ }
  return b;
}

export function LibraryShell({ lib }: { lib: Library }) {
  const [slug, setSlug] = useState<string | null>(() => slugOf(location.hash));
  const [state, setState] = useState<{ slug: string; bundle: Bundle } | { slug: string; error: string } | null>(null);

  useEffect(() => {
    const f = () => setSlug(slugOf(location.hash));
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    if (!slug) { setState(null); document.title = "NCCN Explorer"; return; }
    const e = lib.guidelines.find((x) => x.slug === slug);
    if (!e) { setState({ slug, error: `No guideline called “${slug}” in this library.` }); return; }
    let off = false;
    setState(null);
    loadGuideline(lib, e).then((bundle) => {
      if (off) return;
      remember(slug);
      document.title = `${e.title} · NCCN Explorer`;
      setState({ slug, bundle });
    }).catch((err) => { if (!off) setState({ slug, error: String(err.message ?? err) }); });
    return () => { off = true; };
  }, [slug, lib]);

  const nav = useMemo<LibraryNav>(() => ({
    entries: lib.guidelines,
    open: (s, code) => { location.hash = `#${s}/${code ? `ref/${code.split("/").map(encodeURIComponent).join("/")}` : ""}`; },
    home: () => { location.hash = ""; },
  }), [lib]);

  if (!slug) return <LibraryHome lib={lib} onOpen={(s) => nav.open(s)} />;
  if (!state) return <div className="lib-loading" role="status">Loading {lib.guidelines.find((x) => x.slug === slug)?.title ?? slug}…</div>;
  if ("error" in state) {
    return (
      <div className="lib-loading" role="alert">
        <p>Could not open this guideline: {state.error}</p>
        <button type="button" className="btn" onClick={nav.home}>Back to all guidelines</button>
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

export function LibraryHome({ lib, onOpen }: { lib: Library; onOpen: (slug: string) => void }) {
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
        <h1 className="brand">NCCN Explorer</h1>
        <p className="lib-count">{lib.guidelines.length} encoded NCCN Guidelines</p>
        <p className="lib-lead">Pick a guideline to enter a patient, see the routes through its algorithm that fit, and check each step against the source page.</p>
        <div className="field lib-search">
          <SearchIcon size={15} aria-hidden />
          <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Find a guideline, e.g. prostate, lymphoma, antiemesis" aria-label="Find a guideline" />
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
      <p className="lib-fine">NCCN Explorer is an independent research prototype. It is not made, reviewed or endorsed by NCCN. The guidelines were encoded by software; branch conditions are machine-drafted and not clinician-reviewed. Always check the source page.</p>
    </div>
  );
}

function Row({ e, onOpen }: { e: LibraryEntry; onOpen: (slug: string) => void }) {
  const q = quality(e);
  return (
    <li>
      <button type="button" className="lib-row" onClick={() => onOpen(e.slug)}>
        <BookOpen size={16} aria-hidden />
        <span className="lib-title">{e.title}</span>
        <span className="lib-meta">{e.version ? `v${e.version}` : ""}{e.version_date ? ` · ${e.version_date}` : ""}</span>
        <span className="lib-q" title="Algorithm pages · boxes with an encoded condition">{q.pages} algorithm pages · {q.encoded} conditions</span>
        <ArrowRight size={14} aria-hidden className="lib-go" />
      </button>
    </li>
  );
}
