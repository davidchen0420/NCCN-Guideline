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

// ---- finding the PDFs ----

export async function sha256(data: ArrayBuffer): Promise<string | null> {
  if (!crypto?.subtle) return null;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Guidelines whose PDF this browser has kept. */
export async function savedPdfSlugs(): Promise<Set<string>> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const r = d.transaction(STORE).objectStore(STORE).getAllKeys();
      r.onsuccess = () => res(new Set((r.result as string[]).filter((k) => typeof k === "string" && k.startsWith("pdf:")).map((k) => k.slice(4))));
      r.onerror = () => res(new Set());
    });
  } catch { return new Set(); }
}

/** Fired when PDFs are connected or forgotten, so open views pick them up. */
export const PDFS_CHANGED = "oc-pdfs-changed";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.pdf$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export interface PdfGuideline { slug: string; title: string; pdf_sha256?: string }
export interface FolderResult { matched: { slug: string; file: string; by: "checksum" | "name" }[]; unmatched: string[] }

/** Match a folder of PDFs to guidelines: by SHA-256 (the data records the checksum of the PDF each
 * guideline was encoded from), else by file name (slug or title). Matches are kept in this browser. */
let known: PdfGuideline[] = [];
/** The library's guidelines, for matching a folder of PDFs. */
export const registerGuidelines = (g: PdfGuideline[]) => { known = g; };
export const knownGuidelines = () => known;

export async function connectFolder(files: File[], guidelines: PdfGuideline[] = known, progress?: (done: number, total: number) => void): Promise<FolderResult> {
  const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
  const bySha = new Map(guidelines.filter((g) => g.pdf_sha256).map((g) => [g.pdf_sha256!, g.slug]));
  const byName = new Map<string, string>();
  for (const g of guidelines) { byName.set(norm(g.slug), g.slug); byName.set(norm(g.title), g.slug); }
  const out: FolderResult = { matched: [], unmatched: [] };
  const taken = new Set<string>();
  let done = 0;
  for (const f of pdfs) {
    const data = await f.arrayBuffer();
    const sum = await sha256(data);
    let slug = sum ? bySha.get(sum) : undefined;
    let by: "checksum" | "name" = "checksum";
    if (!slug) { slug = byName.get(norm(f.name)); by = "name"; }
    if (slug && !taken.has(slug)) {
      taken.add(slug);
      await savePdf(`pdf:${slug}`, f.name, data);
      out.matched.push({ slug, file: f.name, by });
    } else out.unmatched.push(f.name);
    progress?.(++done, pdfs.length);
  }
  window.dispatchEvent(new CustomEvent(PDFS_CHANGED));
  return out;
}

/** Where a served copy of a guideline's PDF may sit, relative to the data folder. */
export function pdfCandidates(base: string, slug: string, manifest?: Record<string, string>): string[] {
  const out = manifest?.[slug] ? [manifest[slug]] : [];
  out.push(`pdfs/${slug}.pdf`);   // published next to the page (the hosted copy)
  out.push(`${base}${slug}/pdf/${slug}.pdf`, `${base}${slug}/${slug}.pdf`, `${base}../private/${slug}/pdf/${slug}.pdf`, `${base}../pdf/${slug}.pdf`);
  return [...new Set(out)];
}
