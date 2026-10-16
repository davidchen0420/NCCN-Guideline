import type { BEdge, FlowPage } from "../types";
import type { Parsed } from "./parseBox";

export interface Placed { id: string; x: number; y: number; w: number; h: number; col: number }
export interface HeaderLabel { id: string; x: number; w: number; text: string }
export interface Layout {
  cards: Record<string, Placed>;
  headers: HeaderLabel[];
  width: number;
  height: number;
}

export const GAP_X = 96;
export const GAP_Y = 22;
export const PAD = 28;
const HEADER_H = 34;
const SCALE_Y = 1.25;

/** Card width depends only on how much text the card holds, so it can be set before measuring. */
export function cardWidth(p: Parsed): number {
  const n = p.plain.length;
  return n < 48 ? 232 : n < 220 ? 296 : 352;
}

/**
 * Lay a flow page out as columns that follow the original PDF left-to-right order.
 * Cards keep the reading order of the PDF but are spaced by their real (measured) heights,
 * and each column is nudged toward the mean height of its parents so arrows stay short.
 */
export function layoutPage(page: FlowPage, heights: Record<string, number>, parsed: Record<string, Parsed>, top = 85): Layout {
  const boxes = page.nodes.filter((n) => n.kind === "box");
  const headers = page.nodes.filter((n) => n.kind === "header");
  const cx = (b: number[]) => (b[0] + b[2]) / 2;

  // columns by left edge
  const sorted = [...boxes].sort((a, b) => a.bbox[0] - b.bbox[0] || a.bbox[1] - b.bbox[1]);
  const cols: { x0: number; ids: string[] }[] = [];
  for (const n of sorted) {
    const last = cols[cols.length - 1];
    if (last && n.bbox[0] - last.x0 <= 34) last.ids.push(n.id);
    else cols.push({ x0: n.bbox[0], ids: [n.id] });
  }
  const byId = Object.fromEntries(boxes.map((n) => [n.id, n]));
  const width = (id: string) => cardWidth(parsed[id]);
  const colW = cols.map((c) => Math.max(...c.ids.map(width)));
  const colX: number[] = [];
  let x = PAD;
  colW.forEach((w, i) => { colX[i] = x; x += w + GAP_X; });

  const placed: Record<string, Placed> = {};
  const parentsOf: Record<string, string[]> = {};
  page.edges.forEach((e: BEdge) => (parentsOf[e.dst] ??= []).push(e.src));

  const topY = PAD + (headers.length ? HEADER_H : 0);
  cols.forEach((c, ci) => {
    const items = c.ids.map((id) => {
      const h = heights[id] ?? 60;
      const natural = (cy(byId[id].bbox) - top) * SCALE_Y - h / 2;
      const ps = (parentsOf[id] ?? []).map((p) => placed[p]).filter(Boolean);
      const want = ps.length ? ps.reduce((s, p) => s + p.y + p.h / 2, 0) / ps.length - h / 2 : natural;
      return { id, h, want: Math.max(topY, want) };
    });
    items.sort((a, b) => a.want - b.want || cy(byId[a.id].bbox) - cy(byId[b.id].bbox));
    let y = topY;
    for (const it of items) {
      y = Math.max(y, it.want);
      placed[it.id] = { id: it.id, x: colX[ci] + (colW[ci] - width(it.id)) / 2, y, w: width(it.id), h: it.h, col: ci };
      y += it.h + GAP_Y;
    }
  });

  const labels: HeaderLabel[] = headers.map((h) => {
    let best = 0, bd = Infinity;
    cols.forEach((c, i) => { const d = Math.abs(c.x0 - h.bbox[0]); if (d < bd) { bd = d; best = i; } });
    return { id: h.id, x: colX[best] ?? PAD, w: colW[best] ?? 232, text: h.text };
  });

  const all = Object.values(placed);
  const w = Math.max(...all.map((p) => p.x + p.w), 300) + PAD;
  const hgt = Math.max(...all.map((p) => p.y + p.h), 200) + PAD;
  void cx;
  return { cards: placed, headers: labels, width: w, height: hgt };
}

const cy = (b: number[]) => (b[1] + b[3]) / 2;

/** Elbow-free cubic curve from the right edge of one card to the left edge of another. */
/** The middle of the arrow edgePath draws (its curve is symmetric, so the middle of its end points). */
export function edgeMid(a: Placed, b: Placed): { x: number; y: number } {
  const fwd = b.x > a.x + a.w - 8;
  if (fwd) return { x: (a.x + a.w + b.x) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 };
  if (b.x + b.w < a.x + 8) return { x: (a.x + b.x + b.w) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 };
  const down = b.y > a.y;
  return { x: (a.x + a.w / 2 + b.x + b.w / 2) / 2, y: ((down ? a.y + a.h : a.y) + (down ? b.y : b.y + b.h)) / 2 };
}

export function edgePath(a: Placed, b: Placed): string {
  const fwd = b.x > a.x + a.w - 8;
  if (fwd) {
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
    const dx = Math.max(36, (x2 - x1) * 0.5);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
  if (b.x + b.w < a.x + 8) {
    const x1 = a.x, y1 = a.y + a.h / 2, x2 = b.x + b.w, y2 = b.y + b.h / 2;
    const dx = Math.max(36, (x1 - x2) * 0.5);
    return `M${x1},${y1} C${x1 - dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`;
  }
  // same column: bottom to top
  const down = b.y > a.y;
  const x1 = a.x + a.w / 2, y1 = down ? a.y + a.h : a.y, x2 = b.x + b.w / 2, y2 = down ? b.y : b.y + b.h;
  const dy = Math.max(20, Math.abs(y2 - y1) * 0.5) * (down ? 1 : -1);
  return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
}
