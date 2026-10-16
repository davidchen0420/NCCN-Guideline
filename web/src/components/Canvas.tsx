import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { Maximize2, Minus, Plus, Crosshair } from "lucide-react";
import { useApp } from "../store";
import { Card, type CardFlags } from "./Card";
import { cardWidth, edgePath, layoutPage } from "../lib/layout";
import { pathSets } from "../lib/graph";
import { matcher } from "../lib/search";
import { boxSrc } from "./PathwaysPanel";
import { useSource } from "../source";

/** The smallest zoom a page opens at: below this the cards' text is too small to read. */
const FLOOR = 0.55;

const n_entry =(g: { bundle: { roots: Record<string, string[]> } }, full: string) => (g.bundle.roots[full.split(":")[0]] ?? []).includes(full);

export function Canvas({ page }: { page: string }) {
  const { s, g, set, dispatch, openFootnote, selected: route, isPhone } = useApp();
  const flow = g.bundle.pages[page];
  const boxes = useMemo(() => flow.nodes.filter((n) => n.kind === "box"), [flow]);
  const parsedByShort = useMemo(() => Object.fromEntries(boxes.map((n) => [n.id, g.parsed.get(`${page}:${n.id}`)!])), [boxes, g, page]);

  const measureRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tx = useRef<ReactZoomPanPinchRef>(null);
  const [heights, setHeights] = useState<Record<string, number> | null>(null);
  const [scale, setScale] = useState(1);
  const moved = useRef(false);
  /** a card the reader just clicked is already where they are looking: do not re-centre on it */
  const clicked = useRef<string | null>(null);

  const measure = useCallback(() => {
    const root = measureRef.current;
    if (!root) return;
    const h: Record<string, number> = {};
    root.querySelectorAll<HTMLElement>("[data-sid]").forEach((el) => { h[el.dataset.sid!] = el.offsetHeight; });
    setHeights((prev) => (prev && Object.keys(h).every((k) => prev[k] === h[k]) ? prev : h));
  }, []);
  useLayoutEffect(() => { measure(); }, [measure, boxes]);
  useEffect(() => { void document.fonts?.ready.then(measure); }, [measure]);

  const layout = useMemo(() => (heights ? layoutPage(flow, heights, parsedByShort, flow.band?.[0] ?? g.bundle.top) : null), [flow, heights, parsedByShort, g.bundle.top]);

  /**
   * "all": the whole page in view. "reading": the reading size, from the top left. Otherwise (a
   * page opening) the page's width fitted into the visible canvas, so most of its cards are in
   * view at once: never larger than the reading size, never smaller than FLOOR (cards stay
   * legible); a page still wider than that shows its first columns and the rest is panned to.
   */
  const fit = useCallback((mode: "open" | "all" | "reading") => {
    const el = wrapRef.current, t = tx.current;
    if (!el || !t || !layout) return;
    const cw = el.clientWidth, ch = el.clientHeight;
    const phone = cw < 620;
    const left = phone ? 52 : 64;   // room for the zoom controls
    const reading = phone ? 0.82 : Math.min(1, Math.max(0.9, cw / layout.width));
    if (mode === "reading") { t.setTransform(left, 12, reading, 0); return; }
    if (mode === "open") {
      const sc = Math.min(phone ? 0.82 : 1, Math.max(FLOOR, (cw - left - 16) / layout.width));
      t.setTransform(left, 12, sc, 0);
      return;
    }
    const sc = Math.max(0.12, Math.min((cw - 70) / layout.width, ch / layout.height, 1.2) * 0.96);
    t.setTransform(60 + (cw - 60 - layout.width * sc) / 2, Math.max(8, (ch - layout.height * sc) / 2), sc, 0);
  }, [layout]);
  useEffect(() => { fit("open"); }, [fit]);

  // keep the selected card in view
  const selected = s.loc.kind === "flow" ? s.loc.node : undefined;
  useEffect(() => {
    const el = wrapRef.current, t = tx.current;
    if (!selected || !layout || !el || !t) return;
    if (clicked.current === selected) { clicked.current = null; return; }
    const p = layout.cards[selected.split(":")[1]];
    if (!p) return;
    const sc = t.instance.state.scale;
    const cw = el.clientWidth, ch = el.clientHeight;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const sx = t.instance.state.positionX + cx * sc, sy = t.instance.state.positionY + cy * sc;
    const margin = 60;
    const inside = sx > margin && sx < cw - margin && sy > margin && sy < ch - margin;
    if (!inside) t.setTransform(cw / 2 - cx * sc, ch / 2 - cy * sc, sc, 280);
  }, [selected, layout]);

  const path = useMemo(() => pathSets(g, s.answers), [g, s.answers]);
  // The manual walk when one is running, else the pathway picked in the Pathways tab.
  const trail = useMemo(() => (s.walk ? s.walk.path.map((x) => x.node) : route ? route.steps.map((x) => x.node) : []), [s.walk, route]);
  const walkNodes = useMemo(() => new Set(trail), [trail]);
  const walkEdges = useMemo(() => {
    const e = new Set<string>();
    trail.forEach((x, i) => { if (i) e.add(`${trail[i - 1]}>${x}`); });
    return e;
  }, [trail]);
  const hasFilter = !!s.query.trim() || s.tags.length > 0;
  const match = useMemo(() => matcher(s.query), [s.query]);

  const flagsFor = (shortId: string): CardFlags => {
    const full = `${page}:${shortId}`;
    const p = parsedByShort[shortId];
    const inPath = path.nodes.has(full);
    const answerMode = s.answers.length > 0;
    const hit = hasFilter && match(p.plain) && s.tags.every((t) => p.tags.includes(t));
    return {
      selected: selected === full, answer: s.answers.includes(full), onPath: answerMode && inPath,
      dim: answerMode && !inPath && s.showNon, hide: answerMode && !inPath && !s.showNon,
      gray: hasFilter && !hit, hit, fnActive: s.fn, walk: walkNodes.has(full), current: s.walk ? s.walk.at === full : !!route && route.steps[route.steps.length - 1].node === full,
      entry: g.node(full)?.role === "entry" || (g.node(full)?.role == null && !g.parents[full]?.length && g.kids(full).length > 0 && n_entry(g, full)),
    };
  };

  const source = useSource();
  const select = (shortId: string) => {
    const full = `${page}:${shortId}`;
    // every click opens the step's NCCN page (the window follows each choice); the highlight toggles on its own
    const src = boxSrc(g, full);
    if (src) source.open(src);
    dispatch({ type: "toggleAnswer", id: full });
    clicked.current = full;
    dispatch({ type: "go", loc: { kind: "flow", page, node: full }, push: false });
    // the panel keeps the tab the reader is on; it moves to Step only when already there, or when the phone sheet was closed
    const toStep = s.rightTab === "details" || (isPhone && !s.sheet);
    set({ ...(toStep ? { rightTab: "details" as const } : {}), ...(isPhone ? { sheet: true } : {}), dock: s.dock === "fn" ? s.dock : null });
  };

  const byId = layout?.cards;
  return (
    <div className="canvas" ref={wrapRef}
      onPointerDown={() => { moved.current = false; }}
      onPointerMove={(e) => { if (e.buttons && (Math.abs(e.movementX) + Math.abs(e.movementY)) > 1) moved.current = true; }}
      onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } }}>
      {/* hidden twin used only to measure how tall each card is at its width */}
      <div className="measure" ref={measureRef} aria-hidden>
        {boxes.map((n) => (
          <div key={n.id} data-sid={n.id} style={{ width: cardWidth(parsedByShort[n.id]) }}>
            <Card node={g.node(`${page}:${n.id}`)!} parsed={parsedByShort[n.id]} measure flags={{ ...flagsFor(n.id), answer: false, selected: false, hide: false, dim: false }} />
          </div>
        ))}
      </div>
      <TransformWrapper ref={tx} minScale={0.12} maxScale={2.5} limitToBounds={false} doubleClick={{ disabled: true }}
        wheel={{ step: 0.12 }} panning={{ velocityDisabled: true }} onTransform={(_, st) => setScale(st.scale)}>
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
          {layout && byId && (
            <div className="plane" style={{ width: layout.width, height: layout.height }}>
              <svg className="edges" width={layout.width} height={layout.height} aria-hidden>
                <defs>
                  {(["arrow", "arrow-path", "arrow-walk"] as const).map((id) => (
                    <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" /></marker>
                  ))}
                </defs>
                {flow.edges.map((e, i) => {
                  const a = byId[e.src], b = byId[e.dst];
                  if (!a || !b) return null;
                  const key = `${page}:${e.src}>${page}:${e.dst}`;
                  const cls = ["edge", s.conf ? e.cls : "agreed", path.edges.has(key) && "onpath", s.answers.length && !path.edges.has(key) && (s.showNon ? "dim" : "hide"), walkEdges.has(key) && "walk"].filter(Boolean).join(" ");
                  return <path key={i} className={cls} d={edgePath(a, b)} markerEnd={`url(#${walkEdges.has(key) ? "arrow-walk" : path.edges.has(key) ? "arrow-path" : "arrow"})`} />;
                })}
              </svg>
              {layout.headers.map((h) => (
                <div key={h.id} className="col-head" title={h.text} style={{ left: h.x, width: h.w, top: 14 }}>{h.text.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase())}</div>
              ))}
              {boxes.map((n) => {
                const p = byId[n.id];
                if (!p) return null;
                return (
                  <Card key={n.id} node={g.node(`${page}:${n.id}`)!} parsed={parsedByShort[n.id]} flags={flagsFor(n.id)}
                    style={{ left: p.x, top: p.y, width: p.w }} onSelect={() => select(n.id)}
                    onFootnote={(l) => openFootnote(l, `${page}:${n.id}`)} src={boxSrc(g, `${page}:${n.id}`)} />
                );
              })}
            </div>
          )}
        </TransformComponent>
      </TransformWrapper>
      <div className="zoomctl">
        <button aria-label="Fit page" title="Fit the whole page" onClick={() => fit("all")}><Maximize2 size={15} /></button>
        <button aria-label="Back to reading size" title="Reading size" onClick={() => fit("reading")}><Crosshair size={15} /></button>
        <div className="zbox">
          <button aria-label="Zoom in" onClick={() => tx.current?.zoomIn(0.3, 150)}><Plus size={15} /></button>
          <input type="range" aria-label="Zoom" min={12} max={250} value={Math.round(scale * 100)}
            onChange={(e) => { const t = tx.current; if (!t) return; const st = t.instance.state; const ns = Number(e.target.value) / 100; const el = wrapRef.current!; const cx = el.clientWidth / 2, cy = el.clientHeight / 2; const k = ns / st.scale; t.setTransform(cx - (cx - st.positionX) * k, cy - (cy - st.positionY) * k, ns, 0); }} />
          <button aria-label="Zoom out" onClick={() => tx.current?.zoomOut(0.3, 150)}><Minus size={15} /></button>
        </div>
      </div>
      {!layout && <div className="loading">Laying out page…</div>}
    </div>
  );
}
