/**
 * Source previews: hover anything that came from the guideline to see the PDF page it was
 * read from (the box outlined), click to open that page in a floating viewer that can be
 * moved, resized, zoomed, stepped through, or popped out into its own window.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, FileText, Minus, Plus, X, PictureInPicture2 } from "lucide-react";
import { useApp } from "./store";
import { forgetPdf, loadSavedPdf, openPdf, renderPage, savePdf, type Rendered } from "./lib/pdf";

export interface SrcTarget {
  page: number;                       // 0-based PDF page index
  bbox?: number[];                    // PDF points, top-left origin
  label: string;                      // e.g. "PROS-3" or "Footnote o · PROS-7A"
  excerpt?: string;                   // text to show when the PDF is not connected
}
type PdfState = { status: "none" | "loading" | "ready" | "error"; doc?: PDFDocumentProxy; name?: string; note?: string; verified?: boolean };

interface SourceCtx {
  pdf: PdfState;
  connect: (file: File) => void;
  disconnect: () => void;
  pick: () => void;
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

export function SourceProvider({ children }: { children: ReactNode }) {
  const { bundle } = useApp();
  const key = `pdf:${bundle.guideline?.slug ?? bundle.title}`;
  const [pdf, setPdf] = useState<PdfState>({ status: "none" });
  const [peekT, setPeek] = useState<{ t: SrcTarget; rect: DOMRect } | null>(null);
  const [view, setView] = useState<SrcTarget | null>(null);
  const timer = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const check = useCallback((doc: PDFDocumentProxy) => {
    const want = bundle.pdf_pages;
    return want && doc.numPages !== want
      ? `This PDF has ${doc.numPages} pages but the encoded guideline has ${want}. Previews may show the wrong page.`
      : undefined;
  }, [bundle.pdf_pages]);

  const use = useCallback(async (data: ArrayBuffer, name: string, save: boolean) => {
    setPdf({ status: "loading", name });
    try {
      const copy = data.slice(0);   // pdf.js transfers the buffer to its worker
      // The data records the SHA-256 of the PDF it was built from: a different file (another
      // version or a re-saved copy) may have boxes in other places.
      const want = bundle.guideline?.pdf_sha256;
      let mismatch: string | undefined;
      if (want && crypto?.subtle) {
        const got = [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((b) => b.toString(16).padStart(2, "0")).join("");
        if (got !== want) mismatch = `This PDF is not the file the guideline was encoded from${bundle.guideline?.version ? ` (version ${bundle.guideline.version})` : ""}. Page previews and box outlines may point at the wrong place.`;
      }
      const doc = await openPdf(data);
      setPdf({ status: "ready", doc, name, note: mismatch ?? check(doc), verified: !!want && !mismatch });
      if (save) void savePdf(key, name, copy);
    } catch (e) {
      setPdf({ status: "error", name, note: `Could not open ${name}: ${String((e as Error).message ?? e)}` });
    }
  }, [check, key, bundle.guideline]);

  // On load: a PDF remembered in this browser, else one next to the data (http only).
  useEffect(() => {
    let off = false;
    (async () => {
      const saved = await loadSavedPdf(key);
      if (off) return;
      if (saved) return use(saved.data, saved.name, false);
      if (!location.protocol.startsWith("http")) return;
      for (const url of bundle.pdf_candidates ?? []) {
        try {
          const r = await fetch(url);
          if (r.ok && (r.headers.get("content-type") ?? "").includes("pdf")) { if (!off) await use(await r.arrayBuffer(), url.split("/").pop()!, false); return; }
        } catch { /* try the next one */ }
      }
    })();
    return () => { off = true; };
  }, [bundle.pdf_candidates, key, use]);

  const connect = useCallback((file: File) => { void file.arrayBuffer().then((b) => use(b, file.name, true)); }, [use]);
  const disconnect = useCallback(() => { void forgetPdf(key); setPdf({ status: "none" }); }, [key]);
  const pick = useCallback(() => inputRef.current?.click(), []);

  // Drop a PDF anywhere on the page.
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    const isFile = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const over = (e: DragEvent) => { if (isFile(e)) { e.preventDefault(); setDrag(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDrag(false); };
    const drop = (e: DragEvent) => {
      if (!isFile(e)) return;
      e.preventDefault(); setDrag(false);
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type === "application/pdf" || x.name.toLowerCase().endsWith(".pdf"));
      if (f) connect(f);
    };
    window.addEventListener("dragover", over); window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, [connect]);

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

  const value = useMemo(() => ({ pdf, connect, disconnect, pick, peek, unpeek, open }), [pdf, connect, disconnect, pick, peek, unpeek, open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) connect(f); e.target.value = ""; }} />
      {peekT && createPortal(<Peek t={peekT.t} rect={peekT.rect} onEnter={holdPeek} onLeave={unpeek} onOpen={() => open(peekT.t)} />, document.body)}
      {view && <Viewer t={view} onClose={() => setView(null)} onNav={(page) => setView({ page, label: pageLabel(bundle, page) })} />}
      {drag && createPortal(<div className="drop"><p><FileText size={18} /> Drop the guideline PDF to connect it</p></div>, document.body)}
    </Ctx.Provider>
  );
}

/** The guideline's own page code for a PDF page, when known. */
export function pageLabel(bundle: ReturnType<typeof useApp>["bundle"], index: number): string {
  for (const [code, p] of Object.entries(bundle.pages)) if (p.pdf === index) return code;
  for (const d of Object.values(bundle.docs)) {
    const i = d.pages.findIndex((p) => p.pdf === index);
    if (i >= 0) return d.pages.length > 1 ? `${d.code} ${i + 1} of ${d.pages.length}` : d.code;
  }
  return `Page ${index + 1}`;
}

// ---------------------------------------------------------------- page images

function useRendered(page: number, width: number): Rendered | null | "none" {
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
  const { bundle } = useApp();
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

function PageImage({ t, width, big }: { t: SrcTarget; width: number; big?: boolean }) {
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
      {pdf.status !== "ready" && <p className="peek-note">{showText ? "Text as extracted." : "Reconstructed from the extracted layout."} Connect the PDF to see the original page.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- floating viewer

declare global { interface Window { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } } }

function Viewer({ t, onClose, onNav }: { t: SrcTarget; onClose: () => void; onNav: (page: number) => void }) {
  const { pdf, pick } = useSource();
  const { bundle } = useApp();
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

  const total = bundle.pdf_pages ?? pdf.doc?.numPages ?? 0;
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
          {window.documentPictureInPicture && !pip && <button type="button" aria-label="Pop out into its own window" title="Pop out into its own window" onClick={() => void popOut()}><PictureInPicture2 size={15} /></button>}
          <button type="button" aria-label="Close page viewer" onClick={() => { pip?.close(); onClose(); }}><X size={16} /></button>
        </span>
      </div>
      <div className="viewer-body" ref={body}>
        {pdf.status !== "ready" && (
          <p className="viewer-msg">Showing the page as extracted. <button type="button" className="linkish" onClick={pick}>Connect the PDF</button> to see the original.</p>
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

/** Title-bar control: shows whether the source PDF is connected and connects it. */
export function PdfButton() {
  const { pdf, pick, disconnect } = useSource();
  const ready = pdf.status === "ready";
  return (
    <span className="pdf-ctl">
      <button type="button" className={`pdf-btn ${pdf.status}`} onClick={pick}
        title={ready ? `${pdf.name}${pdf.verified ? " — matches the encoded guideline" : ""} — click to choose a different file` : "Connect the guideline PDF to preview original pages. It stays in this browser."}>
        <span className="dot" aria-hidden />{ready ? (pdf.verified ? "Source PDF ✓" : "Source PDF") : pdf.status === "loading" ? "Opening PDF…" : "Connect PDF"}
      </button>
      {ready && <button type="button" className="ib sm" aria-label="Forget the connected PDF" title="Forget the connected PDF" onClick={disconnect}><X size={14} /></button>}
      {pdf.note && <span className="pdf-note" role="status">{pdf.note}</span>}
    </span>
  );
}

