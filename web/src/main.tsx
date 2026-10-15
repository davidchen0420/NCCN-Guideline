import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/source-serif-4/latin-400.css";
import "@fontsource/source-serif-4/latin-600.css";
import "./styles/app.css";
import { App } from "./App";
import { Provider } from "./store";
import { SourceProvider } from "./source";
import type { Bundle } from "./types";

import { LibraryShell, findLibrary } from "./Library";
import { adaptGuideline, isGuidelineFile } from "./lib/adapt";
import { registerGuidelines } from "./lib/pdf";
import "./atlas/model";   // declares window.__ATLAS__

const root = createRoot(document.getElementById("root")!);
const single = (bundle: Bundle) => {
  document.title = bundle.title ? `${bundle.title} · OncoCarta` : "OncoCarta";
  root.render(<Provider bundle={bundle}><SourceProvider><App /></SourceProvider></Provider>);
};

/**
 * Where the data comes from, in order: one guideline embedded in the file (offline build:
 * window.__GUIDELINE__ in guideline.json format, or a legacy __BUNDLE__); the library next to
 * the page (data/index.json, served over http); the dev sample; else ask for a file.
 */
async function start() {
  if (window.__GUIDELINE__ && isGuidelineFile(window.__GUIDELINE__)) return single(adaptGuideline(window.__GUIDELINE__));
  if (window.__BUNDLE__) return single(window.__BUNDLE__);
  const lib = await findLibrary();
  const atlas = window.__ATLAS__ ?? null;
  if (lib) { root.render(<LibraryShell lib={lib} atlas={atlas} />); return; }
  if (atlas) {
    // opened from disk: the map works, guidelines cannot be read (the panel says so)
    const guidelines = atlas.guidelines.map((g) => ({ slug: g.slug, title: g.title, category: g.category, version: g.version ?? undefined, pdf_sha256: g.sha ?? undefined, path: `${g.slug}/guideline.json` }));
    registerGuidelines(guidelines);
    root.render(<LibraryShell lib={{ base: window.__LIBRARY__?.base ?? "../data/", guidelines }} atlas={atlas} />);
    return;
  }
  try {
    const r = await fetch("./sample-bundle.json");   // dev server only
    if (r.ok) return single((await r.json()) as Bundle);
  } catch { /* not the dev server */ }
  root.render(<OpenFile />);
}

/** Opened from disk without data next to it: open a guideline.json directly. */
function OpenFile() {
  return (
    <div className="lib-loading">
      <h1>Open a guideline</h1>
      <p>This page could not find the guideline library next to it. Browsers do not let pages opened from disk read neighbouring files, so either serve the repository folder (for example <code>python -m http.server</code> in the repository, then open <code>/built/oncocarta.html</code>), or open one guideline file here.</p>
      <label className="btn primary">Choose a guideline.json
        <input type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const j = JSON.parse(await f.text());
            if (isGuidelineFile(j)) single(adaptGuideline(j));
            else alert("That file is not a guideline.json (format nccn-guideline/1).");
          } catch (err) { alert("Could not read the file: " + String(err)); }
        }} />
      </label>
    </div>
  );
}

start().catch((e) => { document.body.textContent = "Could not load guideline data: " + String(e); });
