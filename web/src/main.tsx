import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./styles/app.css";
import { App } from "./App";
import { Provider } from "./store";
import type { Bundle } from "./types";

async function load(): Promise<Bundle> {
  if (window.__BUNDLE__) return window.__BUNDLE__;
  // dev server only: build the sample with `python -m nccn_nav.dashboard --sample` and copy bundle.json to public/
  const r = await fetch("./sample-bundle.json");
  return (await r.json()) as Bundle;
}

load().then((bundle) => {
  document.title = bundle.title || "Guideline Navigator";
  createRoot(document.getElementById("root")!).render(<Provider bundle={bundle}><App /></Provider>);
}).catch((e) => { document.body.textContent = "Could not load guideline data: " + String(e); });
