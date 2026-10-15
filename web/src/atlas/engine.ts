/**
 * Draws the atlas on one canvas and owns the camera. Drawing happens only while something
 * moves (intro, a camera flight, a fade, particles); otherwise the canvas is left alone.
 *
 * Levels: 0 the whole map (optionally zoomed to one site), 1 one guideline's pages inside a
 * "lens", 2 one page's boxes on a paper card. Sizes on screen are computed from world sizes
 * and the zoom, with limits, so text stays readable at every zoom (semantic zoom).
 */
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { select, type Selection } from "d3-selection";
import { interpolateZoom } from "d3-interpolate";
import type { Bundle, BNode } from "../types";
import {
  type GNode, type L1Layout, type L1Page, type Model, type Pt, type Site,
  R_HUB, R_RING, R_SITE, layoutGuideline, pointAt, polar, polyLength,
} from "./model";

export type Focus =
  | { level: 0; site?: string | null }
  | { level: 1; slug: string; section?: number | null }
  | { level: 2; slug: string; page: string };

export type Hit =
  | { kind: "site"; site: string }
  | { kind: "guideline"; slug: string }
  | { kind: "page"; slug: string; page: string }
  | { kind: "box"; slug: string; page: string; node: string }
  | { kind: "jump"; slug: string; page: string; to: string }
  | { kind: "cite"; slug: string; to: string }
  | { kind: "lens"; slug: string }
  | null;

export interface Route { slug: string; pages: string[]; nodes: Set<string>; steps: string[] }

export interface EngineEvents {
  hover(hit: Hit, x: number, y: number): void;
  click(hit: Hit, rect: DOMRect | null): void;
  background(): void;
  zoomedOut(): void;
}

type View = [number, number, number];
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const ease = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const backOut = (t: number) => { const c = 1.5; t = clamp(t, 0, 1) - 1; return 1 + (c + 1) * t * t * t + c * t * t; };
const same = (a: Hit, b: Hit) => JSON.stringify(a) === JSON.stringify(b);

/** Critically damped springs keyed by name; `x` chases `to`. */
class Springs {
  private m = new Map<string, { x: number; v: number; to: number; k: number }>();
  get(key: string, init = 0) { return (this.m.get(key) ?? this.set(key, init, true)).x; }
  target(key: string) { return this.m.get(key)?.to ?? 0; }
  set(key: string, to: number, jump = false, k = 170) {
    let s = this.m.get(key);
    if (!s) { s = { x: jump ? to : 0, v: 0, to, k }; this.m.set(key, s); }
    s.to = to; s.k = k;
    if (jump) { s.x = to; s.v = 0; }
    return s;
  }
  step(dt: number) {
    let moving = false;
    for (const s of this.m.values()) {
      if (s.x === s.to && s.v === 0) continue;
      const c = 2 * Math.sqrt(s.k);
      s.v += (s.k * (s.to - s.x) - c * s.v) * dt;
      s.x += s.v * dt;
      if (Math.abs(s.to - s.x) < 0.0008 && Math.abs(s.v) < 0.002) { s.x = s.to; s.v = 0; } else moving = true;
    }
    return moving;
  }
  snapAll() { for (const s of this.m.values()) { s.x = s.to; s.v = 0; } }
}

interface Theme {
  paper: string; surface: string; ink: string; ink2: string; muted: string; faint: string;
  line: string; strong: string; accent: string; hl: string; dark: boolean;
}
function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    paper: v("--paper", "#f3f1ec"), surface: v("--surface", "#fdfcfa"), ink: v("--ink", "#1d1c19"), ink2: v("--ink-2", "#45433d"),
    muted: v("--muted", "#6b6860"), faint: v("--faint", "#8f8b81"), line: v("--line", "#dedad1"), strong: v("--line-strong", "#c7c2b6"),
    accent: v("--accent", "#135c4d"), hl: v("--hl-line", "#b88600"), dark: matchMedia("(prefers-color-scheme: dark)").matches,
  };
}
const rgbCache = new Map<string, [number, number, number]>();
function rgb(c: string): [number, number, number] {
  let r = rgbCache.get(c);
  if (r) return r;
  const h = c.replace("#", "");
  const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  r = [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
  rgbCache.set(c, r);
  return r;
}
const rgba = (c: string, a: number) => { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${clamp(a, 0, 1).toFixed(3)})`; };
const mix = (c: string, d: string, t: number) => {
  const a = rgb(c), b = rgb(d);
  return "#" + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, "0")).join("");
};

const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const SERIF = '"Source Serif 4", Georgia, serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const CARD_W = 28;          // a page card is this wide in world units
const CARD_HEAD = 1.3;      // room for the page title above the boxes (world units)
const PAGE_W = 792;         // PDF points
const REF_FONT = 10;        // box text is wrapped once at this size and scaled when drawn

/** Short site names for annotations where the full name has no room. */
const SITE_SHORT: Record<string, string> = {
  gi: "GI", gu: "GU", gyn: "Gyn", hereditary: "Hereditary", lymphoma: "Lymphoma", leukemia: "Leukemia",
  neuro: "H&N, CNS", sarcoma: "Sarcoma", populations: "Special", supportive: "Supportive", endocrine: "Endocrine",
  pediatric: "Pediatric", thoracic: "Thoracic",
};
interface SiteLabel {
  site: Site; kind: "arc" | "callout" | "bracket"; lines: string[]; fs: number; r: number; ruleR: number;
  x0: number; y0: number; x1: number; y1: number;
  /** bracket: the line beside the group's labels, and which side the text is on */
  bx?: number; by0?: number; by1?: number; right?: boolean;
}
interface BoxGeom { n: BNode; x0: number; y0: number; x1: number; y1: number; lines: string[]; jumps: string[] }
/** A page card: boxes in world units from the card's top-left corner below the title strip. */
interface Card { boxes: BoxGeom[]; edges: { a: BoxGeom; b: BoxGeom; cls: string }[]; ph: number; pw: number; top: number; title: string }

export class Engine {
  private ctx: CanvasRenderingContext2D;
  private sel: Selection<HTMLCanvasElement, unknown, null, undefined>;
  private zb: ZoomBehavior<HTMLCanvasElement, unknown>;
  t: ZoomTransform = zoomIdentity;
  private w = 0; private h = 0; private dpr = 1;
  private springs = new Springs();
  private raf = 0; private last = 0;
  private flight: { i: ReturnType<typeof interpolateZoom>; t0: number; dur: number; done?: () => void } | null = null;
  private introT0 = -1;
  private theme = readTheme();
  private siteColor = new Map<string, string>();
  private l1 = new Map<string, L1Layout>();
  private cards = new Map<string, Card>();
  private bundles = new Map<string, Bundle>();
  /** rendered original PDF pages for page cards, keyed "slug/page" */
  private pageImages = new Map<string, { img: CanvasImageSource; w: number; h: number }>();
  /** draw page cards from the original PDF page when it is available */
  showOriginal = false;   // page cards draw the diagram; the PDF page only when asked
  private time = 0;
  focus: Focus = { level: 0 };
  hover: Hit = null;
  kbd: Hit = null;
  route: Route | null = null;
  preview: Hit = null;          // search result under the pointer
  /** screen rectangle (CSS px) the camera frames; the side panel is excluded */
  safe = { x0: 0, y0: 0, x1: 0, y1: 0 };
  hubEl: HTMLElement | null = null;
  docked = false;
  reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private ro: ResizeObserver;
  private mqs: MediaQueryList[] = [];

  constructor(private canvas: HTMLCanvasElement, readonly m: Model, private ev: EngineEvents) {
    this.ctx = canvas.getContext("2d")!;
    for (const s of m.sites) this.siteColor.set(s.id, s.color);
    this.maxR = Math.max(...m.guidelines.map((g) => g.r));
    this.applyTheme();
    this.sel = select(canvas);
    this.zb = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.08, 400])
      .filter((e: Event) => (e.type === "wheel" || !(e as MouseEvent).button) && !(e as KeyboardEvent).ctrlKey || e.type === "wheel")
      .on("zoom", (e: { transform: ZoomTransform; sourceEvent: Event | null }) => {
        this.t = e.transform;
        if (e.sourceEvent) { this.flight = null; this.checkZoomOut(); }
        this.request();
      });
    this.sel.call(this.zb).on("dblclick.zoom", null);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("click", this.onClick);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const onDark = () => { this.theme = readTheme(); this.applyTheme(); this.request(); };
    const onMotion = () => { this.reduced = motion.matches; };
    dark.addEventListener("change", onDark); motion.addEventListener("change", onMotion);
    this.mqs = [dark, motion];
    this.cleanupMq = () => { dark.removeEventListener("change", onDark); motion.removeEventListener("change", onMotion); };
    this.resize();
    document.fonts?.ready.then(() => this.request());
  }
  private cleanupMq = () => {};

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.cleanupMq();
    this.sel.on(".zoom", null);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.canvas.removeEventListener("click", this.onClick);
  }

  private applyTheme() {
    for (const s of this.m.sites) this.siteColor.set(s.id, this.theme.dark ? mix(s.color, "#ffffff", 0.32) : s.color);
  }
  color(site: Site | string) { return this.siteColor.get(typeof site === "string" ? site : site.id) ?? this.theme.muted; }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const first = !this.w;
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const oldSafe = { ...this.safe };
    const before = this.w ? this.viewOf(this.t, oldSafe) : null;
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.safe.x1) this.safe = { x0: 0, y0: 0, x1: r.width, y1: r.height };
    if (first) return;
    if (before) this.jump(this.focusView());
    this.labelWCache.clear();
    this.request();
  }

  setSafe(s: { x0: number; y0: number; x1: number; y1: number }, refit = true) {
    const changed = Object.entries(s).some(([k, v]) => Math.abs(this.safe[k as keyof typeof s] - v) > 1);
    this.safe = s;
    if (changed && refit && this.w) this.fly(this.focusView(), undefined, 0.6);
  }

  addBundle(slug: string, b: Bundle) { this.bundles.set(slug, b); this.request(); }
  setPageImage(slug: string, page: string, img: { img: CanvasImageSource; w: number; h: number } | null) {
    const key = `${slug}/${page}`;
    if (img) this.pageImages.set(key, img); else this.pageImages.delete(key);
    this.springs.set(`img:${key}`, img ? 1 : 0, false, 120);
    this.request();
  }
  hasPageImage(slug: string, page: string) { return this.pageImages.has(`${slug}/${page}`); }
  setShowOriginal(v: boolean) { this.showOriginal = v; this.request(); }
  hasBundle(slug: string) { return this.bundles.has(slug); }

  /* ---------------- camera ---------------- */

  private viewOf(t: ZoomTransform, safe = this.safe): View {
    const sx = (safe.x0 + safe.x1) / 2, sy = (safe.y0 + safe.y1) / 2;
    const md = Math.max(50, Math.min(safe.x1 - safe.x0, safe.y1 - safe.y0));
    return [(sx - t.x) / t.k, (sy - t.y) / t.k, md / t.k];
  }
  private transformOf(v: View): ZoomTransform {
    const sx = (this.safe.x0 + this.safe.x1) / 2, sy = (this.safe.y0 + this.safe.y1) / 2;
    const md = Math.max(50, Math.min(this.safe.x1 - this.safe.x0, this.safe.y1 - this.safe.y0));
    const k = md / v[2];
    return zoomIdentity.translate(sx - v[0] * k, sy - v[1] * k).scale(k);
  }
  private md() { return Math.max(50, Math.min(this.safe.x1 - this.safe.x0, this.safe.y1 - this.safe.y0)); }

  homeView(): View { this.decideSiteMode(); return this.homeViewFor(this.siteMode); }
  private homeViewFor(sitesFirst: boolean): View {
    const md = this.md();
    // room around the ring: for the guideline names, or (sites first, small screens) for site names
    const pad = sitesFirst ? clamp(md * 0.11, 40, 96) : md < 600 ? 26 : clamp(md * 0.2, 40, 200);
    const k = Math.max(0.05, (md / 2 - pad) / (R_RING + 30));
    return [0, 0, md / k];
  }
  siteView(s: Site): View {
    const pts = s.members.flatMap((g) => [polar(g.angle, g.rad + 190), polar(g.angle, R_SITE - 20)]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sw = this.safe.x1 - this.safe.x0, sh = this.safe.y1 - this.safe.y0;
    const k = Math.min(sw / (x1 - x0 + 60), sh / (y1 - y0 + 60), 1.6);
    return [(x0 + x1) / 2, (y0 + y1) / 2, this.md() / k];
  }
  layout(slug: string) {
    let l = this.l1.get(slug);
    if (!l) { l = layoutGuideline(this.m.bySlug.get(slug)!); this.l1.set(slug, l); }
    return l;
  }
  guidelineView(slug: string): View {
    const g = this.m.bySlug.get(slug)!;
    const l = this.layout(slug);
    const md = this.md();
    const k = Math.max(0.2, (md / 2 - this.labelRoom() - 34) / l.R);
    return [g.x, g.y, md / k];
  }
  pageView(slug: string, page: string): View {
    const l = this.layout(slug);
    const p = l.pages.find((q) => q.p.id === page);
    if (!p) return this.guidelineView(slug);
    const c = this.card(slug, page);
    const ch = (c ? c.ph : CARD_W * 0.66) + CARD_HEAD;
    const sw = this.safe.x1 - this.safe.x0, sh = this.safe.y1 - this.safe.y0;
    const k = Math.min((sw * 0.92) / CARD_W, (sh * 0.9) / ch);
    return [p.x, p.y, this.md() / k];
  }
  focusView(f = this.focus): View {
    if (f.level === 2) return this.pageView(f.slug, f.page);
    if (f.level === 1) return this.guidelineView(f.slug);
    const s = f.site ? this.m.sites.find((x) => x.id === f.site) : null;
    return s ? this.siteView(s) : this.homeView();
  }
  private jump(v: View) {
    this.flight = null;
    this.sel.call(this.zb.transform, this.transformOf(v));
  }
  fly(v: View, done?: () => void, speed = 1) {
    if (this.reduced || !this.w) { this.jump(v); done?.(); return; }
    const i = (interpolateZoom as unknown as { rho(r: number): typeof interpolateZoom }).rho(1.25)(this.viewOf(this.t), v);
    const dur = clamp(i.duration * 0.55 / speed, 420, 1500);
    this.flight = { i, t0: performance.now(), dur, done };
    this.request();
  }
  /** Zoom by a factor around the safe-area centre (buttons and keys). */
  zoomBy(f: number) {
    const v = this.viewOf(this.t);
    this.fly([v[0], v[1], v[2] / f], undefined, 2);
  }
  private zoomOutArmed = 0;
  private checkZoomOut() {
    // Zooming far out of a guideline or page goes back up a level.
    if (this.focus.level === 0) return;
    const want = this.focusView()[2];
    const now = this.viewOf(this.t)[2];
    if (now > want * (this.focus.level === 2 ? 3.2 : 2.6)) {
      const t = performance.now();
      if (t - this.zoomOutArmed > 500) { this.zoomOutArmed = t; this.ev.zoomedOut(); }
    }
  }

  /* ---------------- state from React ---------------- */

  setFocus(f: Focus, opts: { animate?: boolean } = {}) {
    const prev = this.focus;
    this.focus = f;
    const slug = f.level >= 1 ? (f as { slug: string }).slug : null;
    this.springs.set("l0", f.level === 0 ? 1 : 0, false, 120);
    // lenses that close do so at once; the one that opens waits until the camera is nearly there
    for (const g of this.m.guidelines) if (g.slug !== slug && this.springs.target(`lens:${g.slug}`)) this.springs.set(`lens:${g.slug}`, 0, false, 200);
    const opening = slug && this.springs.target(`lens:${slug}`) !== 1 ? slug : null;
    this.pendingLens = null;
    for (const key of this.cards.keys()) this.springs.set(`card:${key}`, 0, false, 220);
    if (f.level === 2) this.springs.set(`card:${f.slug}/${f.page}`, 1, false, 110);
    for (const s of this.m.sites) this.springs.set(`site:${s.id}`, f.level === 0 && f.site === s.id ? 1 : 0);
    this.springs.set("site-focus", f.level === 0 && f.site ? 1 : 0);
    const view = this.focusView(f);
    if (opts.animate === false || !this.w) {
      this.jump(view); this.springs.set("l0", f.level === 0 ? 1 : 0, true);
      if (opening) this.springs.set(`lens:${opening}`, 1, false, 90);
    } else {
      this.fly(view, undefined, prev.level === f.level ? 1.2 : 1);
      if (opening) {
        if (this.flight) this.pendingLens = { slug: opening, at: this.flight.t0 + this.flight.dur * 0.42 };
        else this.springs.set(`lens:${opening}`, 1, false, 90);
      }
    }
    this.request();
  }
  private pendingLens: { slug: string; at: number } | null = null;
  private waiters: (() => void)[] = [];
  /** Resolves when the camera has stopped (for work that would stutter a flight). */
  settled(): Promise<void> {
    if (!this.flight) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }
  setRoute(r: Route | null) {
    this.route = r;
    this.springs.set("route", 0, true);
    if (r) this.springs.set("route", 1, false, 40);
    this.request();
  }
  setHover(h: Hit) {
    if (same(h, this.hover)) return;
    this.hover = h;
    this.request();
  }
  setPreview(h: Hit) { if (!same(h, this.preview)) { this.preview = h; this.request(); } }
  setKbd(h: Hit) { if (!same(h, this.kbd)) { this.kbd = h; this.request(); } }

  intro() {
    if (this.reduced) { this.introT0 = -1; this.springs.snapAll(); this.request(); return; }
    this.introT0 = performance.now();
    this.request();
  }
  skipIntro() { this.introT0 = -1; this.request(); }
  get introRunning() { return this.introT0 >= 0; }

  /* ---------------- loop ---------------- */

  request() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }
  private frame = (now: number) => {
    this.raf = 0;
    const dt = clamp((now - (this.last || now)) / 1000, 0, 1 / 20);
    this.last = now;
    this.time = now / 1000;
    let moving = this.springs.step(dt);
    if (this.flight) {
      const f = this.flight;
      const u = clamp((now - f.t0) / f.dur, 0, 1);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.sel.call(this.zb.transform, this.transformOf(f.i(e) as View));
      if (u >= 1) { this.flight = null; f.done?.(); } else moving = true;
    }
    if (this.pendingLens && (now >= this.pendingLens.at || !this.flight)) {
      this.springs.set(`lens:${this.pendingLens.slug}`, 1, false, 90);
      this.pendingLens = null;
      moving = true;
    }
    if (!this.flight && this.waiters.length) {
      const w = this.waiters; this.waiters = [];
      setTimeout(() => w.forEach((f) => f()), 0);
    }
    if (this.introT0 >= 0) {
      if (now - this.introT0 > 2600) this.introT0 = -1; else moving = true;
    }
    if (!this.reduced && (this.particlesOn())) moving = true;
    this.draw();
    if (moving) this.request(); else this.last = 0;
  };
  private particlesOn() {
    if (this.route && this.focus.level >= 1) return true;
    const h = this.preview ?? this.hover ?? this.kbd;
    return this.focus.level === 0 && !!h && h.kind === "guideline";
  }

  /* ---------------- geometry helpers ---------------- */

  private S(x: number, y: number): Pt { return [x * this.t.k + this.t.x, y * this.t.k + this.t.y]; }
  private W(sx: number, sy: number): Pt { return [(sx - this.t.x) / this.t.k, (sy - this.t.y) / this.t.k]; }
  /** Intro progress for something that starts at `at` (0..1 of the intro) and lasts `len`. */
  private ip(at: number, len = 0.25) {
    if (this.introT0 < 0) return 1;
    const t = (performance.now() - this.introT0) / 2200;
    return clamp((t - at) / len, 0, 1);
  }
  nodeR(g: GNode) { return clamp(g.r * this.t.k * 1.05, 2.4, 30); }
  labelSpace() { return (TAU / (this.m.guidelines.length * 1.25)) * R_RING * this.t.k; }

  /** Screen position of the hub and the size its search box may take. */
  hubScreen(t = this.t) { return { x: t.x, y: t.y, r: R_HUB * t.k }; }
  /** The hub is drawn at least big enough to hold the search box (unless it is docked). */
  private hubR() { const r = R_HUB * this.t.k; return this.docked ? r : Math.max(r, Math.min(180, 134 + r * 0.1)); }
  hubScreenFor(f: Focus) { return this.hubScreen(this.transformOf(this.focusView(f))); }

  card(slug: string, page: string) {
    const key = `${slug}/${page}`;
    const hit = this.cards.get(key);
    if (hit) return hit;
    const b = this.bundles.get(slug);
    const fp = b?.pages[page];
    if (!b || !fp) return null;
    const band: [number, number] = fp.band ?? [b.top ?? 60, b.bottom ?? 560];
    const pw = fp.size?.[0] ?? b.w ?? PAGE_W;
    const ph = ((band[1] - band[0] + 14) / pw) * CARD_W;
    const ctx = this.ctx;
    ctx.save();
    const boxes: BoxGeom[] = fp.nodes.map((n) => {
      const [x0, y0, x1, y1] = n.bbox;
      const width = ((x1 - x0) / pw) * CARD_W;
      ctx.font = `${n.kind === "header" ? 600 : 400} ${REF_FONT}px ${SANS}`;
      const lines = wrap(ctx, n.text.replace(/\s+/g, " ").trim(), (width / CARD_W) * pw * (REF_FONT / 7.4) - 12);
      return { n, x0: (x0 / pw) * CARD_W, x1: (x1 / pw) * CARD_W, y0: ((y0 - band[0] + 4) / pw) * CARD_W, y1: ((y1 - band[0] + 4) / pw) * CARD_W, lines, jumps: [...new Set(n.links.filter((c) => b.pages[c] && c !== page))].slice(0, 2) };
    });
    ctx.restore();
    const byId = new Map(boxes.map((x) => [x.n.id, x]));
    const edges = fp.edges.flatMap((e) => { const a = byId.get(e.src), d = byId.get(e.dst); return a && d ? [{ a, b: d, cls: e.cls }] : []; });
    const g = this.m.bySlug.get(slug)!;
    const c: Card = { boxes, edges, ph, pw, top: band[0] - 4, title: g.pages.find((p) => p.id === page)?.title ?? page };
    this.cards.set(key, c);
    return c;
  }

  /* ---------------- hit testing ---------------- */

  hitAt(sx: number, sy: number): Hit {
    const f = this.focus;
    // level 2: the card's boxes and jump chips
    if (f.level === 2 && this.springs.get(`card:${f.slug}/${f.page}`) > 0.5) {
      const c = this.card(f.slug, f.page);
      const p = this.layout(f.slug).pages.find((q) => q.p.id === f.page);
      if (c && p) {
        const [wx, wy] = this.W(sx, sy);
        const [ox, oy] = this.cardOrigin(p, c);
        const lx = wx - ox, ly = wy - oy;
        if (this.t.k * 0.44 >= 7) {
          for (const b of c.boxes) {
            for (let j = 0; j < b.jumps.length; j++) {
              const q = chip(b, j);
              if (lx >= q.x && lx <= q.x + q.w && ly >= q.y && ly <= q.y + q.h) return { kind: "jump", slug: f.slug, page: f.page, to: b.jumps[j] };
            }
          }
        }
        for (let i = c.boxes.length - 1; i >= 0; i--) {
          const b = c.boxes[i];
          if (b.n.kind !== "header" && lx >= b.x0 - 0.1 && lx <= b.x1 + 0.1 && ly >= b.y0 - 0.1 && ly <= b.y1 + 0.1) return { kind: "box", slug: f.slug, page: f.page, node: `${f.page}:${b.n.id}` };
        }
        if (lx >= -0.3 && lx <= CARD_W + 0.3 && ly >= -CARD_HEAD - 0.3 && ly <= c.ph + 0.3) return { kind: "lens", slug: f.slug };
      }
    }
    // level 1: the focused guideline's pages and citations
    if (f.level >= 1) {
      const slug = (f as { slug: string }).slug;
      const g = this.m.bySlug.get(slug)!;
      const l = this.layout(slug);
      if (this.springs.get(`lens:${slug}`) > 0.4) {
        let best: L1Page | null = null, bd = Infinity;
        for (const p of l.pages) {
          const [x, y] = this.S(p.x, p.y);
          const d = Math.hypot(x - sx, y - sy);
          if (d < Math.max(12, this.pageR(p) + 6) && d < bd) { bd = d; best = p; }
        }
        if (best && !(f.level === 2 && best.p.id === f.page)) return { kind: "page", slug, page: best.p.id };
        for (const c of this.citeStubs(g, l)) {
          const [x, y] = this.S(c.x, c.y);
          if (Math.abs(sx - x) < c.wpx / 2 + 4 && Math.abs(sy - y) < 11) return { kind: "cite", slug, to: c.to };
        }
        const [gx, gy] = this.S(g.x, g.y);
        const d = Math.hypot(gx - sx, gy - sy);
        if (d < 16) return { kind: "guideline", slug };
        if (d < this.lensR(l)) return { kind: "lens", slug };
      }
    }
    // level 0: guidelines (node or label) and sites
    const [wx, wy] = this.W(sx, sy);
    const rad = Math.hypot(wx, wy);
    let ang = Math.atan2(wx, -wy); if (ang < 0) ang += TAU;
    const half = (TAU / (this.m.guidelines.length * 1.25)) * 0.55;
    for (const g of this.m.guidelines) {
      const [x, y] = this.S(g.x, g.y);
      if (Math.hypot(x - sx, y - sy) <= this.nodeR(g) + 5) return { kind: "guideline", slug: g.slug };
    }
    if (this.showLabels() && rad > R_RING - 30) {
      for (const g of this.m.guidelines) {
        let d = Math.abs(ang - g.angle); d = Math.min(d, TAU - d);
        const lw = (this.labelW(g) + 16) / this.t.k;
        if (d < half && rad >= g.rad && rad <= this.labelRadius() + lw) return { kind: "guideline", slug: g.slug };
      }
    }
    if (this.focus.level === 0 && this.siteLabelCache) {
      for (const L of this.siteLabelCache.labels) if (L.kind !== "arc" && sx >= L.x0 - 3 && sx <= L.x1 + 3 && sy >= L.y0 - 3 && sy <= L.y1 + 3) return { kind: "site", site: L.site.id };
    }
    if (rad > R_SITE - 10 && rad < R_RING - 30) {
      for (const s of this.m.sites) if (ang >= s.a0 && ang <= s.a1) return { kind: "site", site: s.id };
    }
    return null;
  }
  private labelWCache = new Map<string, number>();
  private labelW(g: GNode) {
    let w = this.labelWCache.get(g.slug);
    if (w === undefined) { this.ctx.font = `500 12px ${SANS}`; w = this.ctx.measureText(g.short).width; this.labelWCache.set(g.slug, w); }
    return w * (this.labelFont() / 12);
  }
  private labelFont() { return clamp(this.labelSpace() * 0.8, 10, 14.5); }
  /** Guideline labels all start on one circle, outside the largest marker. */
  private labelRadius() { const k = this.t.k; return R_RING + 26 + (clamp(this.maxR * k * 1.05, 2.4, 30) + 8) / k; }
  private maxR = 0;
  private showLabels() {
    if (this.labelSpace() < 11) return false;
    // sites first: guideline names come back once the map is zoomed in past the home view
    return !(this.siteMode && this.focus.level === 0 && !(this.focus as { site?: string | null }).site && this.t.k < this.siteModeK * 1.3);
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const r = this.canvas.getBoundingClientRect();
    const h = this.hitAt(e.clientX - r.left, e.clientY - r.top);
    this.canvas.style.cursor = h ? "pointer" : "";
    if (!same(h, this.hover)) { this.hover = h; this.request(); }
    this.ev.hover(h, e.clientX, e.clientY);
  };
  private onLeave = () => { this.hover = null; this.ev.hover(null, 0, 0); this.request(); };
  private onClick = (e: MouseEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const h = this.hitAt(e.clientX - r.left, e.clientY - r.top);
    if (this.introT0 >= 0) this.skipIntro();
    if (h) this.ev.click(h, h.kind === "box" ? this.boxRect(h.slug, h.page, h.node) : null);
    else this.ev.background();
  };

  /** World position of the top-left of a card's box area (below the title strip). */
  private cardOrigin(p: L1Page, c: Card): Pt { return [p.x - CARD_W / 2, p.y - (c.ph + CARD_HEAD) / 2 + CARD_HEAD]; }
  /** Room for page labels around the outer ring of a guideline's tree (CSS px). */
  private labelRoom() { return clamp(this.md() * 0.17, 40, 150); }
  lensR(l: L1Layout) { return l.R * this.t.k + this.labelRoom(); }

  /** CSS-pixel rectangle of a box on screen (for the morph into the reader). */
  boxRect(slug: string, page: string, node: string): DOMRect | null {
    const c = this.card(slug, page);
    const p = this.layout(slug).pages.find((q) => q.p.id === page);
    const b = c?.boxes.find((x) => `${page}:${x.n.id}` === node);
    if (!c || !p || !b) return null;
    const [ox, oy] = this.cardOrigin(p, c);
    const [x0, y0] = this.S(ox + b.x0, oy + b.y0), [x1, y1] = this.S(ox + b.x1, oy + b.y1);
    const r = this.canvas.getBoundingClientRect();
    return new DOMRect(r.left + x0, r.top + y0, x1 - x0, y1 - y0);
  }
  /** Screen position of something, for tooltips placed by keyboard focus. */
  screenOf(h: Hit): Pt | null {
    if (!h) return null;
    if (h.kind === "guideline") { const g = this.m.bySlug.get(h.slug)!; return this.S(g.x, g.y); }
    if (h.kind === "page") { const p = this.layout(h.slug).pages.find((q) => q.p.id === h.page); return p ? this.S(p.x, p.y) : null; }
    if (h.kind === "site") { const s = this.m.sites.find((x) => x.id === h.site)!; return this.S(...polar(s.angle, R_RING - 50)); }
    return null;
  }

  /* ---------------- drawing ---------------- */

  private draw() {
    const { ctx, theme: th } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = th.paper;
    ctx.fillRect(0, 0, this.w, this.h);
    if (this.hubEl) this.placeHub();
    const l0 = this.springs.get("l0", 1);
    const dim = 0.1 + 0.9 * l0;
    this.drawGraticule(dim);
    this.drawSites(dim);
    this.drawLinks(dim);
    this.drawSiteLabels(dim);
    this.drawGuidelines(dim, l0);
    this.drawHub(l0);
    for (const g of this.m.guidelines) {
      const p = this.springs.get(`lens:${g.slug}`);
      if (p > 0.002) this.drawLens(g, p);
    }
  }

  private placeHub() {
    const el = this.hubEl!;
    if (this.docked) return;
    const { x, y } = this.hubScreen();
    const a = this.ip(0.05, 0.35);
    el.style.setProperty("--hx", `${x}px`);
    el.style.setProperty("--hy", `${y}px`);
    el.style.setProperty("--hr", `${R_HUB * this.t.k}px`);
    el.style.opacity = String(a);
  }

  private drawGraticule(dim: number) {
    const { ctx, theme: th } = this;
    const [cx, cy] = this.S(0, 0);
    const k = this.t.k;
    const a = this.ip(0, 0.4);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = dim;
    ctx.strokeStyle = th.strong;
    ctx.lineWidth = 1;
    // rings, drawn on during the intro
    const rings: [number, number[]][] = [[R_SITE, [2, 5]], [R_RING - 40, []], [R_RING + 236, [1, 6]]];
    for (const [r, dash] of rings) {
      ctx.setLineDash(dash);
      ctx.globalAlpha = dim * (r === R_RING - 40 ? 0.55 : 0.8);
      ctx.beginPath();
      ctx.arc(cx, cy, r * k, -Math.PI / 2, -Math.PI / 2 + TAU * ease(a));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // compass ticks on the outer ring: every 2 degrees, longer every 10
    const R = (R_RING + 236) * k;
    if (R > 120) {
      ctx.globalAlpha = dim * 0.7;
      ctx.beginPath();
      const n = 180;
      for (let i = 0; i < n * a; i++) {
        const t = (i / n) * TAU;
        const len = i % 5 === 0 ? 7 : 3;
        const s = Math.sin(t), c = -Math.cos(t);
        ctx.moveTo(cx + s * R, cy + c * R);
        ctx.lineTo(cx + s * (R - len), cy + c * (R - len));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSiteLabels(dim: number) {
    const { ctx, theme: th } = this;
    const [cx, cy] = this.S(0, 0);
    const k = this.t.k;
    const hs = this.hoverSite();
    ctx.save();
    // every site is named: along its arc when the name fits there, else as a callout inside the
    // ring with a leader to its arc
    for (const L of this.siteLabels(cx, cy, k)) {
      const s = L.site, col = this.color(s), hov = hs === s.id;
      ctx.globalAlpha = this.siteAlpha(s) * dim * this.ip(0.3 + (s.a0 / TAU) * 0.3, 0.3);
      ctx.font = `600 ${L.fs}px ${SANS}`;
      if (L.kind === "arc") {
        ctx.fillStyle = hov ? th.ink : mix(col, th.ink, 0.35);
        arcText(ctx, L.lines[0], cx, cy, L.r, s.angle, L.fs * 0.16);
        continue;
      }
      if (L.kind === "bracket") {
        // a bracket grouping the guideline names, with the site's name beside it
        const x = L.bx!, d = L.right ? -5 : 5;
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x + d, L.by0!); ctx.lineTo(x, L.by0!); ctx.lineTo(x, L.by1!); ctx.lineTo(x + d, L.by1!);
        const ym = (L.by0! + L.by1!) / 2;
        ctx.moveTo(x, ym); ctx.lineTo(x - d, ym);
        ctx.stroke();
        ctx.textAlign = L.right ? "left" : "right"; ctx.textBaseline = "middle";
        ctx.fillStyle = hov ? th.ink : mix(col, th.ink, 0.35);
        L.lines.forEach((ln, i) => ctx.fillText(ln, L.right ? L.x0 : L.x1, L.y0 + L.fs * 0.62 + i * L.fs * 1.18));
        continue;
      }
      // leader from the callout to its sector rule
      const [ax, ay] = [cx + Math.sin(s.angle) * (L.ruleR - 3), cy - Math.cos(s.angle) * (L.ruleR - 3)];
      const bx = clamp(ax, L.x0, L.x1), by = clamp(ay, L.y0, L.y1);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([1.5, 2.5]);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ax, ay); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ax, ay, 2, 0, TAU); ctx.fill();
      // text on a paper halo so the curves beneath do not cut through it
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = rgba(th.paper, 0.92);
      const mx = (L.x0 + L.x1) / 2;
      L.lines.forEach((ln, i) => {
        const y = L.y0 + L.fs * 0.62 + i * L.fs * 1.18;
        ctx.strokeText(ln, mx, y);
        ctx.fillStyle = hov ? th.ink : mix(col, th.ink, 0.35);
        ctx.fillText(ln, mx, y);
      });
    }
    ctx.restore();
  }

  /** screen rectangles (CSS px) the annotations keep clear of: the legend, the zoom buttons */
  obstacles: [number, number, number, number][] = [];
  setObstacles(r: [number, number, number, number][]) {
    if (JSON.stringify(r) === JSON.stringify(this.obstacles)) return;
    this.obstacles = r; this.siteLabelCache = null; this.request();
  }
  private siteLabelCache: { key: string; labels: SiteLabel[] } | null = null;
  /** Where each site's name goes at this zoom (cached until the zoom or size changes). */
  private siteLabels(cx: number, cy: number, k: number): SiteLabel[] {
    const key = `${k.toFixed(4)}|${Math.round(cx)}|${Math.round(cy)}|${this.w}|${this.h}|${this.docked}`;
    if (this.siteLabelCache?.key === key) return this.siteLabelCache.labels;
    this.decideSiteMode();
    const r = this.siteLabelsPass(cx, cy, k);
    this.siteLabelCache = { key, labels: r.out };
    // which sites are named, and how (read by tests and handy when debugging layouts)
    this.canvas.dataset.siteLabels = r.out.map((L) => `${L.site.id}:${L.kind}`).join(" ");
    this.canvas.dataset.siteMode = String(this.siteMode);
    return r.out;
  }
  /** guideline names hidden at the home zoom so the site names can show */
  private siteMode = false;
  private siteModeK = 0;
  private modeKey = "";
  /** Sites are the landmarks. When their names cannot all sit cleanly beside the guideline names
   * at this screen size, the home view puts sites first (bigger ring, site names outside it) and
   * guideline names wait for a hover or a zoom. Decided once per size, so it never flickers. */
  private decideSiteMode() {
    const key = `${this.w}|${this.h}|${JSON.stringify(this.safe)}|${this.docked}|${JSON.stringify(this.obstacles)}`;
    if (key === this.modeKey) return;
    this.modeKey = key;
    this.siteMode = false;
    const save = this.t;
    this.t = this.transformOf(this.homeViewFor(false));
    const r = this.siteLabelsPass(this.t.x, this.t.y, this.t.k);
    this.siteMode = r.margin && this.labelSpace() >= 11;
    this.t = this.transformOf(this.homeViewFor(this.siteMode));
    this.siteModeK = this.t.k;
    this.t = save;
    this.siteLabelCache = null;
  }
  private siteLabelsPass(cx: number, cy: number, k: number): { out: SiteLabel[]; margin: boolean } {
    let margin = false;
    const ctx = this.ctx;
    const fs = clamp(7 + k * 9, 9, 13);
    const ruleR = (R_RING - 52) * k;
    const arcR = ruleR - fs - 4;
    const hubR = this.hubR();
    const out: SiteLabel[] = [];
    const boxes: [number, number, number, number][] = [];
    ctx.save();
    ctx.font = `600 ${fs}px ${SANS}`;
    const pending: Site[] = [];
    for (const s of this.m.sites) {
      if (!s.members.length) continue;
      const text = s.label.toUpperCase();
      const need = [...text].reduce((n, ch) => n + ctx.measureText(ch).width + fs * 0.16, 0) + 8;
      if ((s.a1 - s.a0) * arcR >= need) out.push({ site: s, kind: "arc", lines: [text], fs, r: arcR, ruleR, x0: 0, y0: 0, x1: 0, y1: 0 });
      else pending.push(s);
    }
    // callouts: one or two lines, placed as far out as they fit without touching each other,
    // the arc labels or the hub
    const cfs = Math.max(9, fs - 1);
    ctx.font = `600 ${cfs}px ${SANS}`;
    const inner = arcR - fs - 6;
    const hit = (b: number[], o: number[]) => b[0] < o[2] + 4 && b[2] > o[0] - 4 && b[1] < o[3] + 3 && b[3] > o[1] - 3;
    const overlaps = (b: number[]) => boxes.some((o) => hit(b, o)) || this.obstacles.some((o) => hit(b, o));
    const split = (text: string) => {
      const words = text.toUpperCase().split(" ");
      if (words.length < 2 || ctx.measureText(text.toUpperCase()).width <= 80) return [words.join(" ")];
      let best = 1, bw = Infinity;
      for (let i = 1; i < words.length; i++) {
        const w = Math.max(ctx.measureText(words.slice(0, i).join(" ")).width, ctx.measureText(words.slice(i).join(" ")).width);
        if (w < bw) { bw = w; best = i; }
      }
      return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
    };
    for (const s of pending) {
      let done = false;
      for (const text of [s.label, SITE_SHORT[s.id] ?? s.label]) {
        if (done) break;
        const lines = split(text);
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 6;
        const h = lines.length * cfs * 1.18 + 2;
        let placed: [number, number, number, number] | null = null;
        // 1. inside the ring, between the hub and the arc labels
        search: for (let r = inner; r > hubR + 4; r -= 4) {
          for (const da of [0, 0.03, -0.03, 0.06, -0.06, 0.1, -0.1, 0.14, -0.14, 0.19, -0.19, 0.24, -0.24]) {
            const a = s.angle + da;
            const px = cx + Math.sin(a) * r, py = cy - Math.cos(a) * r;
            const bx = px - Math.sin(a) * (w / 2) - w / 2, by = py + Math.cos(a) * (h / 2) - h / 2;
            const b: [number, number, number, number] = [bx, by, bx + w, by + h];
            const nx = clamp(cx, b[0], b[2]), ny = clamp(cy, b[1], b[3]);
            if (Math.hypot(nx - cx, ny - cy) < hubR + 6) continue;
            const far = Math.max(...[[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
            if (far > arcR - fs * 0.6 || overlaps(b)) continue;
            placed = b;
            break search;
          }
        }
        // 2. guideline names hidden (small screens): the room outside the ring is free
        if (!placed && !this.showLabels()) {
          for (let r = (R_RING + 40) * k + clamp(this.maxR * k * 1.05, 2.4, 30) + 4; r < Math.max(this.w, this.h) && !placed; r += 5) {
            for (const da of [0, 0.04, -0.04, 0.08, -0.08, 0.13, -0.13]) {
              const a = s.angle + da;
              const px = cx + Math.sin(a) * r, py = cy - Math.cos(a) * r;
              const bx = px + Math.sin(a) * (w / 2) - w / 2, by = py - Math.cos(a) * (h / 2) - h / 2;
              const b: [number, number, number, number] = [bx, by, bx + w, by + h];
              if (b[0] < 4 || b[1] < this.safe.y0 + 4 || b[2] > this.w - 4 || b[3] > this.h - 4 || overlaps(b)) continue;
              placed = b;
              break;
            }
          }
        }
        if (placed) {
          boxes.push(placed);
          out.push({ site: s, kind: "callout", lines, fs: cfs, r: 0, ruleR, x0: placed[0], y0: placed[1], x1: placed[2], y1: placed[3] });
          done = true;
          continue;
        }
        // 3. on the left and right: a bracket beside the group's guideline names, the site's name beyond it
        if (!this.showLabels() || Math.abs(Math.cos(s.angle)) > 0.6) continue;
        const right = Math.sin(s.angle) >= 0;
        const lr = this.labelRadius() * k;
        const ends = s.members.map((g) => {
          const L = lr + this.labelW(g);
          return [cx + Math.sin(g.angle) * L, cy - Math.cos(g.angle) * L] as const;
        });
        const xEdge = right ? Math.max(...ends.map((e) => e[0])) + 10 : Math.min(...ends.map((e) => e[0])) - 10;
        const yA = Math.min(...ends.map((e) => e[1])) - 4, yB = Math.max(...ends.map((e) => e[1])) + 4;
        const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
        const x0 = right ? xEdge + 8 : xEdge - 8 - tw, x1 = x0 + tw;
        const ym = (yA + yB) / 2, b: [number, number, number, number] = [x0, ym - h / 2, x1, ym + h / 2];
        if (b[0] < 6 || b[2] > this.w - 6 || b[1] < this.safe.y0 || b[3] > this.h - 6 || overlaps(b)) continue;
        boxes.push(b);
        out.push({ site: s, kind: "bracket", lines, fs: cfs, r: 0, ruleR, x0: b[0], y0: b[1], x1: b[2], y1: b[3], bx: xEdge, by0: yA, by1: yB, right });
        done = true;
      }
      if (done) continue;
      margin = true;
      // last resort, so every site is named: in the margin on its side, with a leader to its arc
      const lines = split(s.label);
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 6;
      const h = lines.length * cfs * 1.18 + 2;
      const right = Math.sin(s.angle) >= 0;
      const x0 = right ? this.w - 14 - w : 14;
      const want = clamp(cy - Math.cos(s.angle) * ruleR - h / 2, this.safe.y0 + 4, this.h - h - 6);
      for (let i = 0; i < 80; i++) {
        const y = want + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 6;
        if (y < this.safe.y0 + 4 || y > this.h - h - 6) continue;
        const b: [number, number, number, number] = [x0, y, x0 + w, y + h];
        if (overlaps(b)) continue;
        boxes.push(b);
        out.push({ site: s, kind: "callout", lines, fs: cfs, r: 0, ruleR, x0: b[0], y0: b[1], x1: b[2], y1: b[3] });
        break;
      }
    }
    ctx.restore();
    return { out, margin };
  }

  private siteAlpha(s: Site) {
    const sf = this.springs.get("site-focus");
    const on = this.springs.get(`site:${s.id}`);
    return 1 - sf * 0.7 * (1 - on);
  }
  private hoverSlug(): string | null {
    const h = this.preview ?? this.hover ?? this.kbd;
    return h && (h.kind === "guideline" || h.kind === "cite") ? (h.kind === "cite" ? h.to : h.slug) : null;
  }
  private hoverSite(): string | null {
    const h = this.preview ?? this.hover ?? this.kbd;
    return h?.kind === "site" ? h.site : null;
  }

  private drawSites(dim: number) {
    const { ctx, theme: th } = this;
    const [cx, cy] = this.S(0, 0);
    const k = this.t.k;
    const hs = this.hoverSite();
    ctx.save();
    for (const s of this.m.sites) {
      const a = this.ip(0.08 + (s.a0 / TAU) * 0.3, 0.3);
      if (a <= 0) continue;
      const col = this.color(s);
      const sa = this.siteAlpha(s) * dim;
      const hov = hs === s.id;
      // faint wedge behind the sector
      ctx.globalAlpha = sa * a;
      ctx.fillStyle = rgba(col, (hov ? 0.11 : 0.045) * (th.dark ? 1.3 : 1));
      ctx.beginPath();
      ctx.arc(cx, cy, (R_RING + 34) * k, s.a0 - Math.PI / 2, s.a1 - Math.PI / 2);
      ctx.arc(cx, cy, R_SITE * k, s.a1 - Math.PI / 2, s.a0 - Math.PI / 2, true);
      ctx.closePath();
      ctx.fill();
      // sector rule with end ticks
      const rr = (R_RING - 52) * k;
      ctx.strokeStyle = col;
      ctx.lineWidth = hov ? 3 : 2;
      ctx.beginPath();
      const span = (s.a1 - s.a0) * ease(a);
      ctx.arc(cx, cy, rr, s.a0 - Math.PI / 2 + 0.006, s.a0 + span - Math.PI / 2 - 0.006);
      ctx.stroke();
      ctx.lineWidth = 1;
      for (const t of [s.a0 + 0.006, s.a1 - 0.006]) {
        const [x0, y0] = polar(t, R_RING - 58), [x1, y1] = polar(t, R_RING - 46);
        ctx.beginPath(); ctx.moveTo(cx + x0 * k, cy + y0 * k); ctx.lineTo(cx + x1 * k, cy + y1 * k); ctx.stroke();
      }
      // spokes from the sector rule to each guideline
      ctx.globalAlpha = sa * a * 0.5;
      ctx.beginPath();
      for (const g of s.members) {
        const [x0, y0] = polar(g.angle, R_RING - 52);
        ctx.moveTo(cx + x0 * k, cy + y0 * k);
        ctx.lineTo(cx + g.x * k, cy + g.y * k);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLinks(dim: number) {
    const { ctx } = this;
    const k = this.t.k;
    const hs = this.hoverSlug();
    const hsite = this.hoverSite();
    const focusSlug = this.focus.level >= 1 ? (this.focus as { slug: string }).slug : null;
    const key = hs ?? focusSlug;
    ctx.save();
    ctx.lineCap = "round";
    const draw = (l: typeof this.m.links[number], frac: number) => {
      const n = Math.max(2, Math.ceil(l.pts.length * frac));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const [x, y] = this.S(l.pts[i][0], l.pts[i][1]);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    const lit: typeof this.m.links = [];
    for (const l of this.m.links) {
      const a = this.ip(0.42 + (l.a.angle / TAU) * 0.25, 0.35);
      if (a <= 0) continue;
      const on = key && (l.a.slug === key || l.b.slug === key);
      if (on) { lit.push(l); continue; }
      const siteOn = hsite && (l.a.site.id === hsite || l.b.site.id === hsite);
      const base = key ? 0.03 : hsite ? (siteOn ? 0.4 : 0.05) : 0.17;
      ctx.globalAlpha = dim * base * Math.min(this.siteAlpha(l.a.site), 1);
      ctx.strokeStyle = this.color(l.a.site);
      ctx.lineWidth = clamp(0.6 + Math.sqrt(l.w) * 0.35, 0.6, 2.2) * clamp(k * 2, 0.7, 1.6);
      draw(l, ease(a));
    }
    // highlighted links on top, with particles running from the citing guideline to the cited one
    for (const l of lit) {
      ctx.globalAlpha = Math.max(dim, 0.55) * 0.85;
      ctx.strokeStyle = this.color(l.a.site);
      ctx.lineWidth = clamp(1.2 + Math.sqrt(l.w) * 0.5, 1.2, 3.2);
      draw(l, 1);
    }
    if (lit.length && !this.reduced && (this.focus.level === 0 || hs)) {
      for (const l of lit) {
        ctx.fillStyle = this.color(l.a.site);
        const n = Math.max(1, Math.round(l.len / 260));
        for (let i = 0; i < n; i++) {
          const t = ((this.time * 120) / l.len + i / n + (l.a.angle * 7) % 1) % 1;
          const [x, y] = pointAt(l.pts, t, l.len);
          const [sx, sy] = this.S(x, y);
          ctx.globalAlpha = 0.9 * Math.sin(Math.PI * t);
          ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, TAU); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  private drawGuidelines(dim: number, l0: number) {
    const { ctx, theme: th } = this;
    const k = this.t.k;
    const hs = this.hoverSlug();
    const hsite = this.hoverSite();
    const focusSlug = this.focus.level >= 1 ? (this.focus as { slug: string }).slug : null;
    const key = hs ?? focusSlug;
    const neigh = new Set<string>();
    if (key) {
      const g = this.m.bySlug.get(key)!;
      g.cites.forEach((c) => neigh.add(c.slug));
      g.citedBy.forEach((s) => neigh.add(s));
    }
    const space = this.labelSpace();
    const showAll = this.showLabels();
    const fs = this.labelFont();
    ctx.save();
    for (const g of this.m.guidelines) {
      const col = this.color(g.site);
      const start = 0.18 + (g.angle / TAU) * 0.32;
      const a = this.ip(start, 0.3);
      if (a <= 0) continue;
      const e = backOut(a);
      // during the intro the guideline travels out from the hub along its spoke
      const rad = R_SITE + (g.rad - R_SITE) * e;
      const [wx, wy] = a < 1 ? polar(g.angle, rad) : [g.x, g.y];
      const [x, y] = this.S(wx, wy);
      if (x < -300 || y < -300 || x > this.w + 300 || y > this.h + 300) continue;
      const isKey = key === g.slug, isN = neigh.has(g.slug);
      const sa = this.siteAlpha(g.site);
      let alpha = dim * sa * (key && !isKey && !isN ? 0.35 : 1) * (hsite && g.site.id !== hsite ? 0.55 : 1);
      if (isKey && focusSlug === g.slug) alpha = 1;
      if (this.focus.level >= 1 && isN) alpha = Math.max(alpha, 0.45);
      const r = this.nodeR(g) * (isKey ? 1.18 : 1) * Math.min(1, e + 0.001);
      ctx.globalAlpha = alpha;
      this.glyph(g, x, y, r, col, isKey);
      // keyboard focus ring
      if (this.kbd?.kind === "guideline" && this.kbd.slug === g.slug) {
        ctx.strokeStyle = th.accent; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
      // radial label
      const big = g.pages.length >= 30;
      const inSite = !!hsite && g.site.id === hsite && space >= 6;   // pointing at a site names its guidelines
      if ((showAll || big && space >= 5 && !this.siteMode || isKey || (isN && key) || inSite) && l0 > 0.05 || isKey && this.focus.level === 0) {
        ctx.globalAlpha = alpha * this.ip(start + 0.12, 0.25) * (showAll || isKey || isN ? 1 : 0.85);
        const ang = g.angle - Math.PI / 2;
        const left = Math.sin(g.angle) < -0.0001;
        // during the intro labels ride out with their marker; then they sit on the label circle
        const lr = a < 1 ? rad * k + r + 5 : this.labelRadius() * k;
        const out = 0;
        const [hx, hy] = this.S(0, 0);
        if (a >= 1) {
          // a dotted leader from the marker to where its label starts
          const r0 = g.rad * k + r + 3, r1 = lr - 3;
          if (r1 - r0 > 4) {
            ctx.strokeStyle = th.strong; ctx.lineWidth = 1; ctx.setLineDash([1, 3]);
            ctx.beginPath();
            ctx.moveTo(hx + Math.sin(g.angle) * r0, hy - Math.cos(g.angle) * r0);
            ctx.lineTo(hx + Math.sin(g.angle) * r1, hy - Math.cos(g.angle) * r1);
            ctx.stroke(); ctx.setLineDash([]);
          }
        }
        ctx.save();
        ctx.translate(hx + Math.sin(g.angle) * lr, hy - Math.cos(g.angle) * lr);
        ctx.rotate(left ? ang + Math.PI : ang);
        ctx.font = `${isKey || isN ? 600 : 400} ${fs}px ${SANS}`;
        ctx.fillStyle = isKey ? th.ink : isN ? mix(col, th.ink, 0.25) : th.ink2;
        ctx.textBaseline = "middle";
        ctx.textAlign = left ? "right" : "left";
        ctx.fillText(g.short, left ? -out : out, 0.5);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /** A guideline marker: the category decides the shape, the ring fill shows how many of its
   * decision boxes have an encoded condition. */
  private glyph(g: GNode, x: number, y: number, r: number, col: string, on: boolean) {
    const { ctx, theme: th } = this;
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.strokeStyle = col;
    ctx.fillStyle = th.surface;
    const share = g.decisions ? clamp(g.encoded / Math.max(g.decisions, 1), 0, 1) : 0;
    ctx.beginPath();
    if (g.category === "Specific Populations") roundRect(ctx, x - r, y - r, 2 * r, 2 * r, r * 0.35);
    else if (g.category === "Detection Prevention Risk Reduction") diamond(ctx, x, y, r * 1.15);
    else ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (g.category === "Treatment" || g.category === "Supportive Care") {
      // inner disc for treatment, inner ring for supportive care
      ctx.beginPath();
      ctx.arc(x, y, r * 0.58, 0, TAU);
      if (g.category === "Treatment") { ctx.fillStyle = rgba(col, on ? 1 : 0.85); ctx.fill(); }
      else { ctx.lineWidth = Math.max(1, r * 0.12); ctx.stroke(); }
    } else {
      ctx.beginPath(); ctx.arc(x, y, r * 0.28, 0, TAU); ctx.fillStyle = col; ctx.fill();
    }
    if (r > 7 && share > 0) {
      // encoded share as an outer arc
      ctx.strokeStyle = rgba(col, 0.9);
      ctx.lineWidth = Math.max(1.2, r * 0.13);
      ctx.beginPath();
      ctx.arc(x, y, r + ctx.lineWidth * 1.6, -Math.PI / 2, -Math.PI / 2 + TAU * share);
      ctx.stroke();
    }
  }

  private drawHub(l0: number) {
    const { ctx, theme: th } = this;
    const [x, y] = this.S(0, 0);
    const r = this.hubR();
    const a = this.ip(0, 0.35);
    if (a <= 0 || l0 < 0.01 || x + r < 0 || y + r < 0 || x - r > this.w || y - r > this.h) return;
    ctx.save();
    ctx.globalAlpha = l0;
    const rr = r * (0.6 + 0.4 * backOut(a));
    const grad = ctx.createRadialGradient(x, y, rr * 0.2, x, y, rr);
    grad.addColorStop(0, rgba(th.surface, 0.97));
    grad.addColorStop(0.8, rgba(th.surface, 0.9));
    grad.addColorStop(1, rgba(th.surface, 0.55));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
    ctx.strokeStyle = th.strong; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
    ctx.globalAlpha = l0 * 0.6;
    ctx.setLineDash([1, 4]);
    ctx.beginPath(); ctx.arc(x, y, rr - 7, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // a slow-turning tick that marks the hub as alive
    if (!this.reduced && r > 60) {
      const t = this.time * 0.08 % TAU;
      ctx.globalAlpha = l0 * 0.8;
      ctx.strokeStyle = th.accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, rr, t, t + 0.35); ctx.stroke();
    }
    ctx.restore();
  }

  /* ----- level 1 ----- */

  private pageR(p: L1Page) { return clamp((1.1 + Math.sqrt(p.p.boxes) * 0.55) * this.t.k * 0.9, 3, 15); }

  private stubW = new Map<string, number>();
  private citeStubs(g: GNode, l: L1Layout) {
    const out: { to: string; x: number; y: number; ang: number; label: string; wpx: number; color: string; from: L1Page[] }[] = [];
    const k = this.t.k;
    const Rs = this.lensR(l) + 30;   // screen px from the guideline
    this.ctx.font = `500 11px ${SANS}`;
    for (const c of g.cites) {
      const t = this.m.bySlug.get(c.slug)!;
      const from = c.pages.map((i) => l.pages[i]).filter(Boolean);
      if (!from.length) continue;
      // the stub sits on the side where the cited guideline lies on the map
      let ang = Math.atan2(t.x - g.x, -(t.y - g.y)); if (ang < 0) ang += TAU;
      const label = `→ ${t.short}`;
      let wpx = this.stubW.get(label);
      if (wpx === undefined) { wpx = this.ctx.measureText(label).width + 16; this.stubW.set(label, wpx); }
      out.push({ to: t.slug, x: 0, y: 0, ang, label, wpx, color: this.color(t.site), from });
    }
    // keep neighbouring stubs apart
    out.sort((a, b) => a.ang - b.ang);
    const sep = 26 / Rs;
    for (let i = 1; i < out.length; i++) if (out[i].ang - out[i - 1].ang < sep) out[i].ang = out[i - 1].ang + sep;
    for (const s of out) { const [x, y] = polar(s.ang, Rs / k); s.x = g.x + x; s.y = g.y + y; }
    // pills are horizontal: push apart any that still overlap on screen
    const byY = [...out].sort((a, b) => a.y - b.y);
    for (let i = 1; i < byY.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = byY[j], b = byY[i];
        const dx = Math.abs(a.x - b.x) * k, dy = (b.y - a.y) * k;
        if (dx < (a.wpx + b.wpx) / 2 + 4 && dy < 24) b.y = a.y + 24 / k;
      }
    }
    return out;
  }

  private drawLens(g: GNode, p: number) {
    const { ctx, theme: th } = this;
    const l = this.layout(g.slug);
    const [cx, cy] = this.S(g.x, g.y);
    const k = this.t.k;
    const col = this.color(g.site);
    const level2 = this.focus.level === 2 && (this.focus as { slug: string }).slug === g.slug;
    const cardOpen = level2 ? this.springs.get(`card:${g.slug}/${(this.focus as { page: string }).page}`) : 0;
    const R = this.lensR(l) * (0.15 + 0.85 * backOut(Math.min(1, p * 1.1)));
    if (cx + R < 0 || cy + R < 0 || cx - R > this.w || cy - R > this.h) { if (level2) this.drawCard(g, l, cardOpen); return; }
    ctx.save();
    // the lens: an opaque disc that clears the map under it
    ctx.globalAlpha = Math.min(1, p * 1.6);
    ctx.fillStyle = th.paper;
    ctx.shadowColor = th.dark ? "rgba(0,0,0,.6)" : "rgba(30,28,22,.16)";
    ctx.shadowBlur = 48;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.strokeStyle = th.strong; ctx.lineWidth = 1; ctx.setLineDash([1, 5]);
    ctx.beginPath(); ctx.arc(cx, cy, R - 7, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    // depth rings
    ctx.globalAlpha = p * 0.6;
    ctx.strokeStyle = th.line;
    for (let d = 1; d <= l.maxDepth; d++) { ctx.beginPath(); ctx.arc(cx, cy, (l.R * d / l.maxDepth) * k * Math.min(1, p), 0, TAU); ctx.stroke(); }

    const dimL1 = 1 - cardOpen * 0.8;
    const hov = this.hover?.kind === "page" && this.hover.slug === g.slug ? this.hover.page : this.kbd?.kind === "page" && this.kbd.slug === g.slug ? this.kbd.page : null;
    const route = this.route?.slug === g.slug ? this.route : null;
    const routeSet = new Set(route?.pages ?? []);
    const rp = this.springs.get("route");
    // pages grow out of the guideline, ring by ring
    const prog = (q: L1Page) => clamp(p * 2.1 - (q.depth / (l.maxDepth + 1)) * 1.1, 0, 1);
    const pos = (q: L1Page): Pt => {
      const e = backOut(prog(q));
      return this.S(g.x + (q.x - g.x) * e, g.y + (q.y - g.y) * e);
    };
    const hovIdx = hov ? l.pages.findIndex((q) => q.p.id === hov) : -1;
    const near = new Set<number>();
    if (hovIdx >= 0) for (const [a, b] of g.links) { if (a === hovIdx) near.add(b); if (b === hovIdx) near.add(a); }
    const parents = new Set(l.pages.map((q) => q.parent).filter((x): x is number => x !== null));
    const selSection = this.focus.level === 1 ? (this.focus as { section?: number | null }).section ?? null : null;

    // section arcs just outside the rim
    if (l.sections.length && p > 0.5) {
      const taken: [number, number][] = [];
      for (const s of [...l.sections].sort((a, b) => (b.a1 - b.a0) - (a.a1 - a.a0))) {
        const shade = mix(col, th.ink, (s.index % 3) * 0.2);
        const sel = selSection === s.index;
        ctx.globalAlpha = (p - 0.5) * 2 * dimL1 * (selSection === null || sel ? 1 : 0.35);
        ctx.strokeStyle = shade; ctx.lineWidth = sel ? 5 : 3;
        ctx.beginPath(); ctx.arc(cx, cy, R + 6, s.a0 - Math.PI / 2 - 0.02, s.a1 - Math.PI / 2 + 0.02); ctx.stroke();
        const fs = 10.5;
        const len = (s.a1 - s.a0 + 0.04) * (R + 18);
        ctx.font = `600 ${fs}px ${SANS}`;
        const full = s.name.toUpperCase();
        let label = full;
        while (label.length > 3 && ctx.measureText(label).width + label.length * 1.3 > len) label = label.slice(0, -1);
        if (label !== full) label = label.trimEnd() + "…";
        // labels of interleaved sections would collide: the wider section keeps its label
        const mid = (s.a0 + s.a1) / 2, half = (ctx.measureText(label).width + label.length * 1.3) / 2 / (R + 17) + 0.02;
        const clash = taken.some(([a, b]) => mid - half < b && mid + half > a);
        if (label.length > 4 && !clash) { taken.push([mid - half, mid + half]); ctx.fillStyle = shade; arcText(ctx, label, cx, cy, R + 17, mid, 1.3); }
      }
    }

    ctx.lineCap = "round";
    const curveTo = (a: L1Page, b: L1Page) => {
      const [x0, y0] = pos(a), [x1, y1] = pos(b);
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx + (cx - mx) * 0.3, my + (cy - my) * 0.3, x1, y1);
    };
    // cross links (a page linked from more than one place): faint dashed chords
    ctx.globalAlpha = p * dimL1 * 0.6 * Math.min(1, 24 / Math.max(1, l.cross.length));
    ctx.strokeStyle = th.faint; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath();
    for (const [a, b] of l.cross) curveTo(l.pages[a], l.pages[b]);
    ctx.stroke(); ctx.setLineDash([]);
    // tree links: out along the parent's radius, then round to the child
    ctx.strokeStyle = th.strong; ctx.lineWidth = 1.3; ctx.globalAlpha = p * dimL1;
    ctx.beginPath();
    for (const q of l.pages) {
      const [x1, y1] = pos(q);
      if (q.parent === null) { ctx.moveTo(cx, cy); ctx.lineTo(x1, y1); continue; }
      const [x0, y0] = pos(l.pages[q.parent]);
      const rm = (Math.hypot(x0 - cx, y0 - cy) + Math.hypot(x1 - cx, y1 - cy)) / 2;
      const a0 = Math.atan2(y0 - cy, x0 - cx), a1 = Math.atan2(y1 - cy, x1 - cx);
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(cx + Math.cos(a0) * rm, cy + Math.sin(a0) * rm, cx + Math.cos(a1) * rm, cy + Math.sin(a1) * rm, x1, y1);
    }
    ctx.stroke();
    if (hovIdx >= 0) {
      ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.globalAlpha = p;
      ctx.beginPath();
      for (const [a, b] of g.links) if (a === hovIdx || b === hovIdx) curveTo(l.pages[a], l.pages[b]);
      ctx.stroke();
    }

    // the patient's route through the pages, drawn on, then travelled by particles
    if (route && route.pages.length) {
      const seq = route.pages.map((id) => l.pages.find((q) => q.p.id === id)).filter((q): q is L1Page => !!q);
      const flat = flattenRoute([[cx, cy], ...seq.map(pos)], cx, cy);
      ctx.globalAlpha = p * (level2 ? 0.35 : 1);
      ctx.strokeStyle = th.accent; ctx.lineWidth = 3.2;
      ctx.beginPath();
      flat.slice(0, Math.max(2, Math.floor(flat.length * rp))).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      if (!this.reduced && rp > 0.98 && flat.length > 2) {
        const len = polyLength(flat);
        ctx.fillStyle = th.accent;
        const n = Math.max(2, Math.round(len / 90));
        for (let i = 0; i < n; i++) {
          const t = ((this.time * 70) / len + i / n) % 1;
          for (let j = 0; j < 4; j++) {
            const [x, y] = pointAt(flat, Math.max(0, t - (j * 5) / len), len);
            ctx.globalAlpha = p * (level2 ? 0.35 : 0.95) * (1 - j * 0.24);
            ctx.beginPath(); ctx.arc(x, y, 3.2 - j * 0.55, 0, TAU); ctx.fill();
          }
        }
      }
    }

    // citations of other guidelines, outside the rim, on the side where they lie on the map
    if (!level2 && p > 0.6) {
      for (const s of this.citeStubs(g, l)) {
        const [sx, sy] = this.S(s.x, s.y);
        const on = this.hover?.kind === "cite" && this.hover.to === s.to;
        ctx.globalAlpha = (p - 0.6) * 2.5 * (on ? 1 : 0.9);
        ctx.strokeStyle = rgba(s.color, on ? 0.9 : 0.35); ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath();
        for (const f of s.from) { const [fx, fy] = pos(f); ctx.moveTo(fx, fy); ctx.lineTo(sx, sy); }
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = on ? s.color : th.surface; ctx.strokeStyle = s.color; ctx.lineWidth = 1;
        ctx.beginPath(); roundRect(ctx, sx - s.wpx / 2, sy - 10, s.wpx, 20, 10); ctx.fill(); ctx.stroke();
        ctx.fillStyle = on ? th.surface : th.ink2; ctx.font = `500 11px ${SANS}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(s.label, sx, sy + 0.5);
      }
    }

    // page nodes and labels
    const fs = clamp(10 + k * 0.4, 11, 13);
    const space = (TAU * l.R * k) / Math.max(1, l.pages.length - parents.size);
    const room = this.labelRoom();
    for (const q of l.pages) {
      const pr = prog(q);
      if (pr <= 0) continue;
      const [x, y] = pos(q);
      const on = hov === q.p.id;
      const inRoute = routeSet.has(q.p.id) && rp > 0.2;
      const isFocusPage = level2 && (this.focus as { page: string }).page === q.p.id;
      const inSel = selSection === null || q.p.section === selSection;
      const r = this.pageR(q) * (on ? 1.25 : 1) * Math.min(1, backOut(pr));
      const fade = (hovIdx >= 0 && !on && !near.has(q.p.index) ? 0.45 : 1) * (inSel ? 1 : 0.3);
      ctx.globalAlpha = Math.min(1, pr * 2) * fade * (isFocusPage ? 1 : dimL1);
      if (inRoute) { ctx.fillStyle = rgba(th.accent, 0.18); ctx.beginPath(); ctx.arc(x, y, r + 7, 0, TAU); ctx.fill(); }
      ctx.fillStyle = th.surface;
      ctx.strokeStyle = inRoute ? th.accent : col;
      ctx.lineWidth = q.p.start ? 2.4 : 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
      if (q.p.start) { ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, TAU); ctx.stroke(); }
      if (q.p.boxes) {
        // filled wedge: share of the page's boxes that carry an encoded condition
        const share = q.p.decisions / Math.max(1, q.p.boxes);
        ctx.fillStyle = rgba(inRoute ? th.accent : col, 0.85);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r * 0.62, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(share, 0.06, 1)); ctx.closePath(); ctx.fill();
      }
      if (this.kbd?.kind === "page" && this.kbd.page === q.p.id && this.kbd.slug === g.slug) {
        ctx.strokeStyle = th.accent; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, r + 6, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
      // label: outer pages get their title, inner pages only their code (unless pointed at)
      const leaf = !parents.has(q.p.index);
      const showT = (leaf && space > 13) || on || inRoute || (near.has(q.p.index) && hovIdx >= 0);
      if (pr > 0.6 && !isFocusPage) {
        ctx.globalAlpha = Math.min(1, (pr - 0.6) * 2.5) * fade * dimL1;
        const ang = Math.atan2(y - cy, x - cx);
        const left = Math.cos(ang) < 0;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(left ? ang + Math.PI : ang);
        ctx.textBaseline = "middle"; ctx.textAlign = left ? "right" : "left";
        const dir = left ? -1 : 1;
        const off = (r + (q.p.start ? 7 : 5)) * dir;
        if (!leaf && !on && !inRoute && space > 22) {
          // inner pages: code set inward of the node so it does not cross the children's links
          ctx.font = `500 ${fs - 2}px ${MONO}`;
          ctx.fillStyle = th.muted;
          ctx.textAlign = left ? "left" : "right";
          ctx.fillText(q.p.id, -off, -r - 3);
        } else if (leaf || on || inRoute) {
          ctx.font = `500 ${fs - 1.5}px ${MONO}`;
          ctx.fillStyle = on ? th.ink : th.muted;
          ctx.fillText(q.p.id, off, 0.5);
          if (showT) {
            const iw = ctx.measureText(q.p.id + "  ").width;
            ctx.font = `${on || inRoute ? 600 : 400} ${fs}px ${SANS}`;
            ctx.fillStyle = on || inRoute ? th.ink : th.ink2;
            const max = leaf ? room - iw - 12 + (l.R * k - Math.hypot(x - cx, y - cy)) : 220;
            ctx.fillText(ellipsize(ctx, q.p.title, Math.max(40, max)), off + dir * iw, 0.5);
          }
        }
        ctx.restore();
      }
    }

    // the guideline itself at the centre
    ctx.globalAlpha = p * dimL1;
    this.glyph(g, cx, cy, 8, col, true);
    ctx.restore();

    if (level2) this.drawCard(g, l, cardOpen);
  }

  /* ----- level 2 ----- */

  private drawCard(g: GNode, l: L1Layout, p: number) {
    if (p < 0.002) return;
    const f = this.focus as { slug: string; page: string };
    const q = l.pages.find((x) => x.p.id === f.page);
    if (!q) return;
    const { ctx, theme: th } = this;
    const c = this.card(g.slug, f.page);
    const k = this.t.k;
    const [px, py] = this.S(q.x, q.y);
    const ph = c?.ph ?? CARD_W * 0.66;
    const e = ease(p);
    const r0 = this.pageR(q);
    const W = CARD_W * k, H = (ph + CARD_HEAD) * k;
    const w = r0 * 2 + (W - r0 * 2) * e, h = r0 * 2 + (H - r0 * 2) * e;
    const x0 = px - w / 2, y0 = py - h / 2;
    const col = this.color(g.site);
    ctx.save();
    ctx.globalAlpha = Math.min(1, p * 2);
    ctx.shadowColor = th.dark ? "rgba(0,0,0,.55)" : "rgba(30,28,22,.2)";
    ctx.shadowBlur = 30 * e; ctx.shadowOffsetY = 10 * e;
    ctx.fillStyle = th.surface;
    ctx.beginPath(); roundRect(ctx, x0, y0, w, h, Math.max(r0 * (1 - e), 8 * e)); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = th.strong; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = col; ctx.fillRect(x0, y0 + 8 * e, 3 * e, Math.max(0, h - 16 * e));
    if (p < 0.35) { ctx.restore(); return; }
    const inner = clamp((p - 0.35) / 0.65, 0, 1);
    const s = c ? W / c.pw : W / PAGE_W;    // screen px per PDF point
    const head = CARD_HEAD * k;
    ctx.globalAlpha = inner;
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    // the title first, its code after it in quiet type
    const codeFont = `500 ${clamp(head * 0.3, 9, 14)}px ${MONO}`;
    ctx.font = codeFont;
    const iw = ctx.measureText(`  ${f.page}`).width;
    ctx.fillStyle = th.ink; ctx.font = `600 ${clamp(head * 0.4, 11, 20)}px ${SERIF}`;
    const titleText = ellipsize(ctx, c?.title ?? q.p.title, w - iw - 50);
    const tx = x0 + clamp(s * 16, 10, 24);
    ctx.fillText(titleText, tx, y0 + head * 0.55);
    const tw = ctx.measureText(titleText).width;
    ctx.fillStyle = th.muted; ctx.font = codeFont;
    ctx.fillText(f.page, tx + tw + ctx.measureText("  ").width, y0 + head * 0.55);
    if (!c) {
      ctx.fillStyle = th.muted; ctx.font = `13px ${SANS}`; ctx.textAlign = "center";
      ctx.fillText(this.bundles.has(g.slug) ? "This page has no steps." : "Reading the page…", px, py);
      ctx.restore(); return;
    }
    if (!c.boxes.length) {
      ctx.fillStyle = th.muted; ctx.font = `italic 14px ${SERIF}`; ctx.textAlign = "center";
      ctx.fillText("No steps could be read from this page.", px, py);
      ctx.restore(); return;
    }
    const [owx, owy] = this.cardOrigin(q, c);
    const [ox, oy] = this.S(owx, owy);
    const B = (b: BoxGeom) => [ox + b.x0 * k, oy + b.y0 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k] as const;
    const route = this.route?.slug === g.slug ? this.route : null;
    const rp = this.springs.get("route");
    const hovId = this.hover?.kind === "box" ? this.hover.node : this.kbd?.kind === "box" ? this.kbd.node : null;
    // the original PDF page, when connected: printed exactly as NCCN laid it out
    const pimg = this.showOriginal ? this.pageImages.get(`${g.slug}/${f.page}`) : undefined;
    const orig = pimg ? this.springs.get(`img:${g.slug}/${f.page}`) * inner : 0;
    if (pimg && orig > 0.01) {
      const sy = (c.top / pimg.h), sh = ((c.ph / CARD_W) * c.pw) / pimg.h;
      const iw = (pimg.img as HTMLImageElement).naturalWidth || (pimg.img as HTMLCanvasElement).width;
      const ih = (pimg.img as HTMLImageElement).naturalHeight || (pimg.img as HTMLCanvasElement).height;
      ctx.save();
      ctx.globalAlpha = orig;
      ctx.beginPath(); ctx.rect(ox, oy, W, c.ph * k); ctx.clip();
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(pimg.img, 0, Math.max(0, sy * ih), iw, Math.min(ih, sh * ih), ox, oy, W, c.ph * k);
      ctx.restore();
    }
    const extracted = 1 - orig;
    // edges draw on left to right, the way the page is read
    if (extracted > 0.01) for (const ed of c.edges) {
      const t = clamp(inner * 1.6 - (ed.a.x0 / CARD_W) * 0.6, 0, 1);
      if (t <= 0) continue;
      const onRoute = !!route && route.nodes.has(`${f.page}:${ed.a.n.id}`) && route.nodes.has(`${f.page}:${ed.b.n.id}`) && rp > 0.1;
      ctx.globalAlpha = t * extracted;
      ctx.strokeStyle = onRoute ? th.accent : ed.cls === "unsure" ? th.faint : th.muted;
      ctx.lineWidth = onRoute ? clamp(s * 2.4, 2, 3.5) : clamp(s * 1.1, 1, 2);
      if (ed.cls === "unsure") ctx.setLineDash([3, 3]);
      if (onRoute && !this.reduced) { ctx.setLineDash([7, 5]); ctx.lineDashOffset = -this.time * 24; }
      const [ax, ay, aw, ah] = B(ed.a), [bx, by, bw, bh] = B(ed.b);
      ctx.beginPath();
      if (bx >= ax + aw - 4) {
        const x1 = ax + aw, y1 = ay + ah / 2, x2 = bx, y2 = by + bh / 2, mx = (x1 + x2) / 2;
        ctx.moveTo(x1, y1); ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2); ctx.stroke();
        ctx.setLineDash([]); arrow(ctx, x2, y2, 0, clamp(s * 4, 3, 6));
      } else {
        const down = by > ay;
        const x1 = ax + aw / 2, y1 = down ? ay + ah : ay, x2 = bx + bw / 2, y2 = down ? by : by + bh, my = (y1 + y2) / 2;
        ctx.moveTo(x1, y1); ctx.bezierCurveTo(x1, my, x2, my, x2, y2); ctx.stroke();
        ctx.setLineDash([]); arrow(ctx, x2, y2, down ? Math.PI / 2 : -Math.PI / 2, clamp(s * 4, 3, 6));
      }
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    // boxes; their text is set at the printed size, or drawn as grey bars when too small to read
    const font = s * 7.4;
    for (const b of c.boxes) {
      const t = clamp(inner * 1.7 - (b.x0 / CARD_W) * 0.7, 0, 1);
      if (t <= 0) continue;
      const [bx, by0, bw, bh] = B(b);
      const header = b.n.kind === "header";
      const full = `${f.page}:${b.n.id}`;
      const onRoute = !!route?.nodes.has(full) && rp > 0.1;
      const hovered = hovId === full;
      const by = by0 - (hovered ? 2 : 0) * extracted + (1 - ease(t)) * 6 * extracted;
      if (orig > 0.01 && !header && (onRoute || hovered)) {
        // over the original page only the route and the box under the pointer are marked
        ctx.globalAlpha = t * orig;
        ctx.fillStyle = rgba(onRoute ? th.accent : th.hl, onRoute ? 0.12 : 0.18);
        ctx.strokeStyle = onRoute ? th.accent : th.ink2; ctx.lineWidth = 2;
        ctx.beginPath(); roundRect(ctx, bx - 2, by0 - 2, bw + 4, bh + 4, 4); ctx.fill(); ctx.stroke();
      }
      ctx.globalAlpha = t * extracted;
      if (extracted <= 0.01) { /* original page shown: no extracted boxes */ }
      else if (!header) {
        if (hovered) { ctx.shadowColor = th.dark ? "rgba(0,0,0,.5)" : "rgba(30,28,22,.18)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4; }
        ctx.fillStyle = onRoute ? mix(th.surface, th.accent, th.dark ? 0.22 : 0.1) : th.surface;
        ctx.beginPath(); roundRect(ctx, bx, by, bw, bh, clamp(s * 3, 2, 6)); ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.strokeStyle = onRoute ? th.accent : hovered ? th.ink2 : th.strong;
        ctx.lineWidth = onRoute || hovered ? 1.8 : 1;
        ctx.stroke();
        if (b.n.pred) { ctx.fillStyle = onRoute ? th.accent : col; ctx.fillRect(bx + 1, by + 3, clamp(s * 2.5, 2, 4), Math.max(0, bh - 6)); }
      }
      const pad = clamp(s * 6, 2, 9);
      if (extracted <= 0.01) { this.drawJumps(b, t, ox, oy, k); continue; }
      ctx.save();
      ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
      if (font < 5.6) {
        ctx.fillStyle = rgba(th.ink2, 0.25);
        const lh = font * 1.22;
        b.lines.forEach((ln, i) => {
          const yy = by + pad * 0.6 + i * lh;
          if (yy > by + bh - 2) return;
          ctx.fillRect(bx + pad, yy + lh * 0.3, Math.max(4, Math.min(bw - pad * 2, ln.length * font * 0.48)), Math.max(1, lh * 0.42));
        });
      } else {
        ctx.translate(bx + pad, by + pad * 0.6);
        const sc = font / REF_FONT;
        ctx.scale(sc, sc);
        ctx.fillStyle = header ? th.muted : th.ink;
        ctx.font = `${header ? 600 : 400} ${REF_FONT}px ${SANS}`;
        ctx.textBaseline = "top"; ctx.textAlign = "left";
        b.lines.forEach((ln, i) => ctx.fillText(ln, 0, i * REF_FONT * 1.22));
      }
      ctx.restore();
      this.drawJumps(b, t, ox, oy, k);
    }
    ctx.restore();
  }

  /** Links to other pages: chips in the box's corner that fly there. */
  private drawJumps(b: BoxGeom, t: number, ox: number, oy: number, k: number) {
    if (!b.jumps.length || t <= 0.8 || k * 0.44 < 7) return;
    const { ctx, theme: th } = this;
    b.jumps.forEach((to, j) => {
      const qd = chip(b, j);
      const cx = ox + qd.x * k, cy = oy + qd.y * k, cw = qd.w * k, chh = qd.h * k;
      const on = this.hover?.kind === "jump" && this.hover.to === to;
      ctx.globalAlpha = t;
      ctx.fillStyle = on ? th.accent : th.surface; ctx.strokeStyle = th.accent; ctx.lineWidth = 1;
      ctx.beginPath(); roundRect(ctx, cx, cy, cw, chh, chh / 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = on ? th.surface : th.accent; ctx.font = `500 ${clamp(chh * 0.6, 8, 12)}px ${MONO}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(ellipsize(ctx, `→ ${to}`, cw - 6), cx + cw / 2, cy + chh / 2 + 0.5);
    });
  }
}

/** Jump chips sit inside the bottom-right corner of a box (world units, card frame). */
function chip(b: BoxGeom, j: number) {
  const w = 1.7, h = 0.44;
  return { x: b.x1 - w - 0.12, y: b.y1 - h - 0.12 - j * (h + 0.08), w, h };
}

/* ---------------- canvas helpers ---------------- */

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > width && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
const ellCache = new Map<string, string>();
/** Text cut to fit `max` pixels (cached: labels are fitted every frame while things move). */
function ellipsize(ctx: CanvasRenderingContext2D, s: string, max: number) {
  const key = `${ctx.font}|${Math.round(max / 2)}|${s}`;
  let hit = ellCache.get(key);
  if (hit === undefined) {
    hit = fit(ctx, s, Math.round(max / 2) * 2);
    if (ellCache.size > 4000) ellCache.clear();
    ellCache.set(key, hit);
  }
  return hit;
}
function fit(ctx: CanvasRenderingContext2D, s: string, max: number) {
  if (ctx.measureText(s).width <= max) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(s.slice(0, m) + "…").width <= max) lo = m; else hi = m - 1; }
  return s.slice(0, Math.max(1, lo)).trimEnd() + "…";
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
}
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, s: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-s, -s * 0.6); ctx.lineTo(-s, s * 0.6); ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle; ctx.fill(); ctx.restore();
}
/** Text set along a circle, centred on `at` (0 = up, clockwise); flipped on the lower half so it
 * always reads left to right. */
function arcText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, at: number, spacing: number) {
  const ws = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  const total = ws.reduce((a, b) => a + b, 0) - spacing;
  let a = ((at % TAU) + TAU) % TAU;
  const bottom = a > Math.PI / 2 && a < (3 * Math.PI) / 2;
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  let cur = bottom ? a + total / 2 / r : a - total / 2 / r;
  [...text].forEach((ch, i) => {
    const half = ws[i] / 2 / r;
    cur += bottom ? -half : half;
    ctx.save();
    ctx.translate(cx + Math.sin(cur) * r, cy - Math.cos(cur) * r);
    ctx.rotate(bottom ? cur + Math.PI : cur);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    cur += bottom ? -half : half;
  });
  ctx.restore();
  void a;
}
/** Route through page positions: each hop curves slightly toward the lens centre. */
function flattenRoute(pts: Pt[], cx: number, cy: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const qx = mx + (cx - mx) * 0.18, qy = my + (cy - my) * 0.18;
    for (let j = i === 1 ? 0 : 1; j <= 12; j++) {
      const t = j / 12, u = 1 - t;
      out.push([u * u * x0 + 2 * u * t * qx + t * t * x1, u * u * y0 + 2 * u * t * qy + t * t * y1]);
    }
  }
  return out;
}
