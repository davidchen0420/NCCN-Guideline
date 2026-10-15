/**
 * Source previews: hover anything that came from the guideline to see the PDF page it was
 * read from (the box outlined), click to open that page in a floating viewer that can be
 * moved, resized, zoomed, stepped through, or popped out into its own window.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowRight, ChevronLeft, ChevronRight, FileText, FolderOpen, Minus, Plus, X, PictureInPicture2 } from "lucide-react";
import { useAppMaybe } from "./store";
import type { Bundle } from "./types";
import { connectFolder, forgetPdf, knownGuidelines, loadSavedPdf, openPdf, PDFS_CHANGED, renderPage, savedPdfSlugs, savePdf, sha256, type FolderResult, type Rendered } from "./lib/pdf";

export interface SrcTarget {
  page: number;                       // 0-based PDF page index
  bbox?: number[];                    // PDF points, top-left origin
  label: string;                      // e.g. "PROS-3" or "Footnote o · PROS-7A"
  excerpt?: string;                   // text to show when the PDF is not connected
  /** an extra action offered with the page (e.g. open the box in the reader) */
  action?: { label: string; run: () => void };
}
type PdfState = { status: "none" | "loading" | "ready" | "error"; doc?: PDFDocumentProxy; name?: string; note?: string; verified?: boolean };

type FolderState = { status: "idle" | "working" | "done"; done?: number; total?: number; result?: FolderResult };

interface SourceCtx {
  bundle: Bundle | null;
  pdf: PdfState;
  /** guidelines whose PDF this browser keeps */
  saved: Set<string>;
  folder: FolderState;
  connect: (file: File) => void;
  connectFiles: (files: File[]) => void;
  disconnect: () => void;
  pick: () => void;
  pickFolder: () => void;
  peek: (t: SrcTarget, el: HTMLElement) => void;
  unpeek: () => void;
  open: (t: SrcTarget) => void;
}
const Ctx = createContext<SourceCtx | null>(null);
export const useSource = () => { const c = useContext(Ctx); if (!c) throw new Error("no source provider"); return c; };

const canHover = () => typeof matchMedia !== "undefined" && matchMedia("(hover: hover)").matches;

/** Props that make an element preview its source on hover/focus and open it on click (or Enter). */
export interface SrcProps {
  onMouseEnter?: (e: React.MouseEvent<HTMLElement>) => void; onMouseLeave?: () => void;
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void; onBlur?: () => void; onClick?: (e: React.MouseEvent) => void;
}
export function useSrc(t: SrcTarget | null, opts: { click?: boolean } = { click: true }): SrcProps {
  const s = useSource();
  if (!t) return {};
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { if (canHover()) s.peek(t, e.currentTarget); },
    onMouseLeave: () => s.unpeek(),
    onFocus: (e: React.FocusEvent<HTMLElement>) => { if (e.currentTarget === e.target) s.peek(t, e.currentTarget); },
    onBlur: () => s.unpeek(),
    ...(opts.click ? { onClick: (e: React.MouseEvent) => { e.stopPropagation(); s.unpeek(); s.open(t); } } : {}),
  };
}

/** A small "PROS-3 · p. 15" chip that previews and opens the source page. */
export function SrcChip({ t, text }: { t: SrcTarget; text?: string }) {
  const props = useSrc(t);
  return (
    <button type="button" className="src-chip" aria-label={`Source: ${t.label}, PDF page ${t.page + 1}. Open page`} {...props}>
      <FileText size={12} aria-hidden />{text ?? `${t.label} · p.${t.page + 1}`}
    </button>
  );
}

/** Source pages for one guideline: the reader's (from its store) or the one the atlas has open
 * (`bundle` prop; null when none is). */
export function SourceProvider({ children, bundle: given }: { children: ReactNode; bundle?: Bundle | null }) {
  const app = useAppMaybe();
  const bundle = given !== undefined ? given : app?.bundle ?? null;
  const key = bundle ? `pdf:${bundle.guideline?.slug ?? bundle.title}` : null;
  const [pdf, setPdf] = useState<PdfState>({ status: "none" });
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState<FolderState>({ status: "idle" });
  const [tick, setTick] = useState(0);
  const folderRef = useRef<HTMLInputElement>(null);
  const [peekT, setPeek] = useState<{ t: SrcTarget; rect: DOMRect } | null>(null);
  const [view, setView] = useState<SrcTarget | null>(null);
  const timer = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const check = useCallback((doc: PDFDocumentProxy) => {
    const want = bundle?.pdf_pages;
    return want && doc.numPages !== want
      ? `This PDF has ${doc.numPages} pages but the encoded guideline has ${want}. Previews may show the wrong page.`
      : undefined;
  }, [bundle?.pdf_pages]);

  const use = useCallback(async (data: ArrayBuffer, name: string, save: boolean) => {
    setPdf({ status: "loading", name });
    try {
      const copy = data.slice(0);   // pdf.js transfers the buffer to its worker
      // The data records the SHA-256 of the PDF it was built from: a different file (another
      // version or a re-saved copy) may have boxes in other places.
      const want = bundle?.guideline?.pdf_sha256;
      let mismatch: string | undefined;
      const got = want ? await sha256(copy) : null;
      if (want && got && got !== want) mismatch = `This PDF is not the file the guideline was encoded from${bundle?.guideline?.version ? ` (version ${bundle.guideline.version})` : ""}. Page previews and box outlines may point at the wrong place.`;
      const doc = await openPdf(data);
      setPdf({ status: "ready", doc, name, note: mismatch ?? check(doc), verified: !!want && !!got && !mismatch });
      if (save && key) { await savePdf(key, name, copy); window.dispatchEvent(new CustomEvent(PDFS_CHANGED)); }
    } catch (e) {
      setPdf({ status: "error", name, note: `Could not open ${name}: ${String((e as Error).message ?? e)}` });
    }
  }, [check, key, bundle?.guideline, bundle?.pdf_pages]);

  // Which guidelines have a PDF kept in this browser; refreshed when PDFs are connected anywhere.
  useEffect(() => {
    const f = () => { void savedPdfSlugs().then(setSaved); setTick((t) => t + 1); };
    f();
    window.addEventListener(PDFS_CHANGED, f);
    return () => window.removeEventListener(PDFS_CHANGED, f);
  }, []);

  // A PDF remembered in this browser, else a served copy next to the data (http only).
  const candidates = bundle?.pdf_candidates;
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    let off = false;
    if (!key) { setPdf({ status: "none" }); loadedFor.current = null; return; }
    (async () => {
      const kept = await loadSavedPdf(key);
      if (off) return;
      if (kept) { if (loadedFor.current !== `${key}|${kept.name}`) { loadedFor.current = `${key}|${kept.name}`; await use(kept.data, kept.name, false); } return; }
      if (loadedFor.current?.startsWith(`${key}|`)) return;
      setPdf({ status: "none" });
      if (!location.protocol.startsWith("http")) return;
      for (const url of candidates ?? []) {
        try {
          const r = await fetch(url);
          if (r.ok && (r.headers.get("content-type") ?? "").includes("pdf")) {
            if (off) return;
            loadedFor.current = `${key}|${url}`;
            await use(await r.arrayBuffer(), url.split("/").pop()!, false);
            return;
          }
        } catch { /* try the next one */ }
      }
    })();
    return () => { off = true; };
  }, [candidates, key, use, tick]);

  const connect = useCallback((file: File) => { loadedFor.current = null; void file.arrayBuffer().then((b) => use(b, file.name, true)); }, [use]);
  const connectFiles = useCallback((files: File[]) => {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return;
    // one PDF with a guideline open: that guideline's; otherwise match each file to its guideline
    if (pdfs.length === 1 && key && files.length === 1) { connect(pdfs[0]); return; }
    setFolder({ status: "working", done: 0, total: pdfs.length });
    loadedFor.current = null;
    void connectFolder(pdfs, knownGuidelines(), (done, total) => setFolder({ status: "working", done, total }))
      .then((result) => setFolder({ status: "done", result }));
  }, [connect, key]);
  const disconnect = useCallback(() => {
    if (!key) return;
    loadedFor.current = null;
    void forgetPdf(key).then(() => window.dispatchEvent(new CustomEvent(PDFS_CHANGED)));
    setPdf({ status: "none" });
  }, [key]);
  const pick = useCallback(() => inputRef.current?.click(), []);
  const pickFolder = useCallback(() => folderRef.current?.click(), []);

  // Drop a PDF anywhere on the page.
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    const isFile = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const over = (e: DragEvent) => { if (isFile(e)) { e.preventDefault(); setDrag(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDrag(false); };
    const drop = (e: DragEvent) => {
      if (!isFile(e)) return;
      e.preventDefault(); setDrag(false);
      connectFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragover", over); window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, [connectFiles]);

  const peek = useCallback((t: SrcTarget, el: HTMLElement) => {
    window.clearTimeout(timer.current);
    const rect = el.getBoundingClientRect();
    timer.current = window.setTimeout(() => setPeek({ t, rect }), 280);
  }, []);
  const unpeek = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(null), 160);
  }, []);
  const holdPeek = useCallback(() => window.clearTimeout(timer.current), []);
  const open = useCallback((t: SrcTarget) => { window.clearTimeout(timer.current); setPeek(null); setView(t); }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setPeek(null); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const value = useMemo(() => ({ bundle, pdf, saved, folder, connect, connectFiles, disconnect, pick, pickFolder, peek, unpeek, open }),
    [bundle, pdf, saved, folder, connect, connectFiles, disconnect, pick, pickFolder, peek, unpeek, open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) connect(f); e.target.value = ""; }} />
      <input ref={folderRef} type="file" hidden multiple {...{ webkitdirectory: "", directory: "" }} data-testid="pdf-folder-input"
        onChange={(e) => { connectFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      {peekT && createPortal(<Peek t={peekT.t} rect={peekT.rect} onEnter={holdPeek} onLeave={unpeek} onOpen={() => open(peekT.t)} />, document.body)}
      {view && bundle && <Viewer t={view} onClose={() => setView(null)} onNav={(page) => setView({ page, label: pageLabel(bundle, page) })} />}
      {drag && createPortal(<div className="drop"><p><FileText size={18} /> {key ? "Drop the guideline PDF (or a folder of NCCN PDFs) to connect it" : "Drop NCCN guideline PDFs to connect them"}</p></div>, document.body)}
    </Ctx.Provider>
  );
}

/** The guideline's own page code for a PDF page, when known. */
export function pageLabel(bundle: Bundle, index: number): string {
  for (const [code, p] of Object.entries(bundle.pages)) if (p.pdf === index) return code;
  for (const d of Object.values(bundle.docs)) {
    const i = d.pages.findIndex((p) => p.pdf === index);
    if (i >= 0) return d.pages.length > 1 ? `${d.code} ${i + 1} of ${d.pages.length}` : d.code;
  }
  return `Page ${index + 1}`;
}

// ---------------------------------------------------------------- page images

export function useRendered(page: number, width: number): Rendered | null | "none" {
  const { pdf } = useSource();
  const [img, setImg] = useState<Rendered | null>(null);
  useEffect(() => {
    if (pdf.status !== "ready" || !pdf.doc) return;
    let off = false;
    setImg(null);
    renderPage(pdf.doc, page, width).then((r) => { if (!off) setImg(r); }).catch(() => { if (!off) setImg(null); });
    return () => { off = true; };
  }, [pdf, page, width]);
  return pdf.status === "ready" ? img : "none";
}

/** The page from the extracted layout: every box drawn where it sits, the target outlined. */
function Reconstructed({ page, bbox, big }: { page: number; bbox?: number[]; big?: boolean }) {
  const { bundle } = useSource();
  if (!bundle) return null;
  const flow = Object.entries(bundle.pages).find(([, p]) => p.pdf === page);
  const W = flow?.[1].size?.[0] ?? bundle.w ?? 792, H = flow?.[1].size?.[1] ?? bundle.h ?? 612;
  if (flow) {
    return (
      <svg className="recon" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Reconstructed layout of ${flow[0]}`}>
        <rect x="0" y="0" width={W} height={H} className="paper" />
        {flow[1].nodes.map((n) => {
          const [x0, y0, x1, y1] = n.bbox;
          const hit = bbox && Math.abs(bbox[0] - x0) < 0.5 && Math.abs(bbox[1] - y0) < 0.5;
          return (
            <g key={n.id}>
              <rect x={x0 - 2} y={y0 - 2} width={x1 - x0 + 4} height={y1 - y0 + 4} rx="2" className={hit ? "hit" : n.kind === "header" ? "hdr" : ""} />
              {big && <foreignObject x={x0 - 1} y={y0 - 1} width={x1 - x0 + 2} height={y1 - y0 + 2}><div className="recon-t">{n.text.replace(/\u0017/g, "◦")}</div></foreignObject>}
            </g>
          );
        })}
        <text x={W - 24} y={H - 16} textAnchor="end" className="code">{flow[0]}</text>
      </svg>
    );
  }
  const doc = Object.values(bundle.docs).find((d) => d.pages.some((p) => p.pdf === page));
  const text = doc?.pages.find((p) => p.pdf === page)?.text;
  return <div className="recon-text">{text ? text.slice(0, big ? 6000 : 700) : "This page is not in the extracted text."}</div>;
}

export function PageImage({ t, width, big }: { t: SrcTarget; width: number; big?: boolean }) {
  const r = useRendered(t.page, width);
  if (r === "none") return <Reconstructed page={t.page} bbox={t.bbox} big={big} />;
  if (!r) return <div className="page-loading" style={{ aspectRatio: "792 / 612" }}>Rendering page…</div>;
  const box = t.bbox && { left: `${(t.bbox[0] - 3) / r.w * 100}%`, top: `${(t.bbox[1] - 3) / r.h * 100}%`, width: `${(t.bbox[2] - t.bbox[0] + 6) / r.w * 100}%`, height: `${(t.bbox[3] - t.bbox[1] + 6) / r.h * 100}%` };
  return (
    <div className="page-img" style={{ aspectRatio: `${r.w} / ${r.h}` }}>
      <img src={r.url} alt={`PDF page ${t.page + 1} (${t.label})`} />
      {box && <span className="hl" style={box} />}
    </div>
  );
}

// ---------------------------------------------------------------- hover card

function Peek({ t, rect, onEnter, onLeave, onOpen }: { t: SrcTarget; rect: DOMRect; onEnter: () => void; onLeave: () => void; onOpen: () => void }) {
  const { pdf } = useSource();
  const W = 340, gap = 10;
  const right = rect.right + gap + W < innerWidth;
  const left = right ? rect.right + gap : Math.max(8, rect.left - gap - W);
  const top = Math.min(Math.max(8, rect.top - 20), innerHeight - 330);
  // Without the PDF, a box is best shown in its reconstructed page; footnotes and prose as text.
  const showText = pdf.status !== "ready" && !!t.excerpt && !t.bbox;
  return (
    <div className="peek" role="dialog" aria-label={`Source preview: ${t.label}`} style={{ left, top, width: W }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button type="button" className="peek-page" onClick={onOpen} aria-label="Open this page">
        {showText ? <div className="recon-text">{t.excerpt}</div> : <PageImage t={t} width={W * 2} />}
      </button>
      <div className="peek-cap">
        <span><b>{t.label}</b> · PDF page {t.page + 1}</span>
        <button type="button" className="linkish" onClick={onOpen}>Open page</button>
      </div>
      {t.action && <div className="peek-cap"><span /><button type="button" className="linkish" onClick={t.action.run}>{t.action.label} <ArrowRight size={12} aria-hidden /></button></div>}
      {pdf.status !== "ready" && <PeekConnect showText={showText} />}
    </div>
  );
}

function PeekConnect({ showText }: { showText: boolean }) {
  const { pdf, pick, pickFolder } = useSource();
  return (
    <p className="peek-note">
      {pdf.status === "loading" ? "Opening the PDF…" : <>{showText ? "Text as extracted." : "Reconstructed from the extracted layout."} To see the original page, <button type="button" className="linkish" onClick={pick}>connect this guideline's PDF</button> or <button type="button" className="linkish" onClick={pickFolder}>a folder of NCCN PDFs</button>.</>}
    </p>
  );
}

/** A window of the original page around a box (falls back to nothing when the PDF is not here). */
export function PageCrop({ t, width = 300 }: { t: SrcTarget; width?: number }) {
  const r = useRendered(t.page, 1400);
  if (r === "none") return null;
  if (!r) return <div className="page-loading crop" style={{ width }}>Rendering page…</div>;
  const b = t.bbox ?? [0, 0, r.w, r.h];
  const cw = Math.min(r.w, Math.max(b[2] - b[0] + 90, 320)), ch = Math.min(r.h, Math.max(b[3] - b[1] + 60, cw * 0.5));
  const x0 = Math.min(Math.max(0, (b[0] + b[2]) / 2 - cw / 2), r.w - cw), y0 = Math.min(Math.max(0, (b[1] + b[3]) / 2 - ch / 2), r.h - ch);
  const pct = (v: number, d: number) => `${(v / d) * 100}%`;
  return (
    <div className="page-crop" style={{ width, aspectRatio: `${cw} / ${ch}` }}>
      <img src={r.url} alt={`PDF page ${t.page + 1} (${t.label})`} style={{ width: pct(r.w, cw), left: pct(-x0, cw), top: pct(-y0, ch) }} />
      {t.bbox && <span className="hl" style={{ left: pct(b[0] - 3 - x0, cw), top: pct(b[1] - 3 - y0, ch), width: pct(b[2] - b[0] + 6, cw), height: pct(b[3] - b[1] + 6, ch) }} />}
    </div>
  );
}

// ---------------------------------------------------------------- floating viewer

declare global { interface Window { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } } }

function Viewer({ t, onClose, onNav }: { t: SrcTarget; onClose: () => void; onNav: (page: number) => void }) {
  const { pdf, pick, pickFolder, bundle } = useSource();
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [pip, setPip] = useState<Window | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [bw, setBw] = useState(600);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBw(el.clientWidth - 24));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pip]);
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => { if (t.bbox) body.current?.querySelector(".hl")?.scrollIntoView({ block: "center", inline: "center" }); });

  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const el = box.current!;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (m: PointerEvent) => setPos({ x: Math.min(Math.max(0, m.clientX - dx), innerWidth - 120), y: Math.min(Math.max(0, m.clientY - dy), innerHeight - 40) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const popOut = async () => {
    const api = window.documentPictureInPicture;
    if (!api) return;
    const w = await api.requestWindow({ width: 560, height: 620 });
    [...document.styleSheets].forEach((ss) => {
      try { const st = w.document.createElement("style"); st.textContent = [...ss.cssRules].map((r) => r.cssText).join("\n"); w.document.head.appendChild(st); } catch { /* cross-origin sheet */ }
    });
    w.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? "";
    w.document.body.className = "pip-body";
    w.addEventListener("pagehide", () => setPip(null));
    setPip(w);
  };
  useEffect(() => () => { pip?.close(); }, [pip]);

  const total = bundle?.pdf_pages ?? pdf.doc?.numPages ?? 0;
  const width = Math.round(Math.max(320, bw) * zoom * (window.devicePixelRatio > 1 ? 2 : 1));
  const content = (
    <>
      <div className="viewer-bar" onPointerDown={pip ? undefined : drag}>
        <span className="viewer-title"><b>{t.label}</b> · PDF page {t.page + 1}{total ? ` of ${total}` : ""}</span>
        <span className="viewer-tools">
          <button type="button" aria-label="Previous page" disabled={t.page <= 0} onClick={() => onNav(t.page - 1)}><ChevronLeft size={16} /></button>
          <button type="button" aria-label="Next page" disabled={!!total && t.page >= total - 1} onClick={() => onNav(t.page + 1)}><ChevronRight size={16} /></button>
          <button type="button" aria-label="Zoom out" disabled={zoom <= 0.6} onClick={() => setZoom((z) => Math.max(0.6, z - 0.25))}><Minus size={15} /></button>
          <span className="zoom-v" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><Plus size={15} /></button>
          {t.action && <button type="button" className="viewer-act" onClick={() => { pip?.close(); onClose(); t.action!.run(); }}>{t.action.label} <ArrowRight size={13} aria-hidden /></button>}
          {window.documentPictureInPicture && !pip && <button type="button" aria-label="Pop out into its own window" title="Pop out into its own window" onClick={() => void popOut()}><PictureInPicture2 size={15} /></button>}
          <button type="button" aria-label="Close page viewer" onClick={() => { pip?.close(); onClose(); }}><X size={16} /></button>
        </span>
      </div>
      <div className="viewer-body" ref={body}>
        {pdf.status !== "ready" && (
          <p className="viewer-msg">{pdf.status === "loading" ? "Opening the PDF…" : <>Showing the page as extracted. <button type="button" className="linkish" onClick={pick}>Connect this guideline's PDF</button> or <button type="button" className="linkish" onClick={pickFolder}>a folder of NCCN PDFs</button> to see the original.</>}</p>
        )}
        <div className="viewer-page" style={{ width: `${zoom * 100}%` }}><PageImage t={t} width={width} big /></div>
      </div>
    </>
  );
  if (pip) return createPortal(<div className="viewer popped">{content}</div>, pip.document.body);
  return createPortal(
    <section ref={box} className="viewer" role="dialog" aria-label={`Guideline page ${t.label}`} tabIndex={-1}
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight" && e.altKey) onNav(t.page + 1); if (e.key === "ArrowLeft" && e.altKey) onNav(t.page - 1); }}>
      {content}
    </section>, document.body);
}

/** Title-bar control: whether the source PDF is here, and ways to connect it (this guideline's
 * file, or a whole folder matched to every guideline by checksum). */
export function PdfButton({ total }: { total?: number }) {
  const { bundle, pdf, saved, folder, pick, pickFolder, disconnect } = useSource();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", f); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", f); document.removeEventListener("keydown", k); };
  }, [open]);
  useEffect(() => { if (folder.status !== "idle") setOpen(true); }, [folder.status]);
  const ready = pdf.status === "ready";
  const n = total ?? knownGuidelines().length;
  const label = bundle
    ? (ready ? (pdf.verified ? "Source PDF ✓" : "Source PDF") : pdf.status === "loading" ? "Opening PDF…" : "Connect PDF")
    : `Source PDFs${saved.size ? ` · ${saved.size}${n ? ` of ${n}` : ""}` : ""}`;
  const st = bundle ? pdf.status : saved.size ? "ready" : "none";
  return (
    <span className="pdf-ctl" ref={ref}>
      <button type="button" className={`pdf-btn ${st}`} aria-expanded={open} aria-haspopup="dialog" data-testid="pdf-btn" onClick={() => setOpen((o) => !o)}
        title={ready ? `${pdf.name}${pdf.verified ? " — matches the encoded guideline" : ""}` : "Connect the original NCCN PDFs to preview their pages. They stay in this browser."}>
        <span className="dot" aria-hidden />{label}
      </button>
      {open && (
        <div className="pdf-menu" role="dialog" aria-label="Source PDFs">
          {bundle && (
            <p className="pm-status">{ready ? <><b>{pdf.name}</b>{pdf.verified ? " — the file this guideline was encoded from." : "."}</> : pdf.status === "loading" ? "Opening the PDF…" : <>The original PDF of <b>{bundle.guideline?.title ?? bundle.title}</b> is not connected: previews show the page rebuilt from the extracted boxes.</>}</p>
          )}
          {pdf.note && bundle && <p className="pm-note" role="status">{pdf.note}</p>}
          {bundle && <button type="button" className="pm-btn" onClick={() => { setOpen(false); pick(); }}><FileText size={15} aria-hidden /> {ready ? "Choose a different PDF…" : "Choose this guideline's PDF…"}</button>}
          <button type="button" className="pm-btn" onClick={pickFolder} disabled={folder.status === "working"}><FolderOpen size={15} aria-hidden /> Connect a folder of NCCN PDFs…</button>
          {folder.status === "working" && <p className="pm-note" role="status">Matching {folder.done} of {folder.total} PDFs…<span className="pm-bar"><i style={{ width: `${((folder.done ?? 0) / Math.max(1, folder.total ?? 1)) * 100}%` }} /></span></p>}
          {folder.status === "done" && folder.result && (
            <p className="pm-note" role="status">Connected {folder.result.matched.length} guideline PDF{folder.result.matched.length === 1 ? "" : "s"}{folder.result.matched.some((m) => m.by === "name") ? ` (${folder.result.matched.filter((m) => m.by === "name").length} by file name, not checksum)` : ""}.{folder.result.unmatched.length ? ` ${folder.result.unmatched.length} file${folder.result.unmatched.length === 1 ? "" : "s"} matched no guideline: ${folder.result.unmatched.slice(0, 3).join(", ")}${folder.result.unmatched.length > 3 ? "…" : ""}.` : ""}</p>
          )}
          <p className="pm-fine">{saved.size ? `${saved.size}${n ? ` of ${n}` : ""} guideline PDFs are kept in this browser. ` : ""}Files are matched by the checksum recorded when each guideline was encoded, and never leave this browser.</p>
          {bundle && ready && <button type="button" className="pm-btn subtle" onClick={() => { disconnect(); setOpen(false); }}><X size={14} aria-hidden /> Forget this guideline's PDF</button>}
        </div>
      )}
    </span>
  );
}
