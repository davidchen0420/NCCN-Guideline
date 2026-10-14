/**
 * The source guideline PDF, for page previews.
 *
 * The PDF is licensed and never bundled. The viewer looks for it next to the data when served
 * over http (bundle.pdf_candidates), or the user picks or drops the file; it is then kept in
 * this browser's IndexedDB so it survives a reload. Nothing is uploaded anywhere.
 * pdf.js is bundled (the page must work offline) and loaded on first use.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

let lib: typeof import("pdfjs-dist") | null = null;
async function pdfjs() {
  if (lib) return lib;
  const [mod, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?raw")]);
  // The worker ships as text inside the single HTML file and runs from a blob URL. Pages
  // opened from file:// cannot start module workers from blob URLs, so it runs as a classic
  // script: drop the final export and the import.meta use (only inside a try for optional decoders).
  const classic = worker.default.replace(/export\s*\{[^}]*\};?\s*$/, "").replace(/import\.meta\.url/g, "self.location.href");
  const url = URL.createObjectURL(new Blob([classic], { type: "text/javascript" }));
  mod.GlobalWorkerOptions.workerPort = new Worker(url);
  lib = mod;
  return mod;
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  return m.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
}

// ---- persistence (per browser, per guideline) ----
const DB = "guideline-navigator", STORE = "pdf";
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function savePdf(key: string, name: string, data: ArrayBuffer) {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ name, data }, key);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  } catch { /* storage blocked (private window, file://): the PDF just isn't remembered */ }
}
export async function loadSavedPdf(key: string): Promise<{ name: string; data: ArrayBuffer } | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const r = d.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => res((r.result as { name: string; data: ArrayBuffer }) ?? null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}
export async function forgetPdf(key: string) {
  try {
    const d = await db();
    d.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
  } catch { /* ignore */ }
}

// ---- rendering ----
export interface Rendered { url: string; w: number; h: number }
const cache = new Map<string, Promise<Rendered>>();
/** Render a 0-based page to a PNG data URL `width` pixels wide (device pixels included). */
export function renderPage(doc: PDFDocumentProxy, index: number, width: number): Promise<Rendered> {
  const key = `${doc.fingerprints[0]}:${index}:${width}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: width / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
      return { url: canvas.toDataURL("image/png"), w: base.width, h: base.height };
    })();
    cache.set(key, p);
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
  }
  return p;
}
