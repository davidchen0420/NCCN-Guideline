// Readability and accessibility audit of the main screens of the built library page, in light and dark:
//   text size (<11px must be 0, <12px reported), contrast (WCAG AA), target size (<24px must be 0,
//   <32px tall reported), a keyboard smoke (Tab reaches the rail / toolbar / panel and every stop shows a focus
//   indicator) and, on the phone, no horizontal overflow.
//   node e2e/a11y.mjs [--verbose]   (from web/, after `python -m nccn_nav.dashboard --library ../data ../built/oncocarta.html`)
// Exempt from the contrast and size checks: canvas, images, disabled controls, the rebuilt-page twin (.recon*), placeholder
// text, the hidden measuring twin, and the deliberately dimmed off-route cards of the diagram (inactive components).
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VERBOSE = process.argv.includes("--verbose");
const TYPES = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".pdf": "application/pdf" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/built/oncocarta.html`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });

/** Runs in the page: collects text, contrast, target and overflow findings. */
function audit({ phone }) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const parse = (s) => {
    if (cache.has(s)) return cache.get(s);
    let m, out;
    if ((m = s.match(/^rgba?\(([^)]+)\)$/))) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); out = [p[0], p[1], p[2], p[3] ?? 1]; }
    else if ((m = s.match(/^color\(srgb ([^)]+)\)$/))) { const p = m[1].split(/[ /]+/).filter(Boolean).map(parseFloat); out = [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    else { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; out = [d[0], d[1], d[2], d[3] / 255]; }
    cache.set(s, out); return out;
  };
  const over = (f, b) => { const a = f[3]; return [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a), 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const sig = (el) => {
    const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 3).map((c) => "." + c).join("");
    const par = el.parentElement; const pc = par && typeof par.className === "string" ? par.className.trim().split(/\s+/).filter(Boolean)[0] : "";
    return `${pc ? "." + pc + " > " : ""}${el.tagName.toLowerCase()}${cls}`;
  };
  const SKIP = ".measure, .sr, canvas, [class*=recon], select, option, script, style, noscript, .card.dim, .card.gray, .card.hide, .res.gray, .choice.off, [aria-hidden=true]";
  const disabled = (el) => !!el.closest(":disabled, [aria-disabled=true], fieldset:disabled");
  const offSheet = (el) => { const r = el.closest(".right"); return !!r && innerWidth <= 820 && r.getBoundingClientRect().top >= innerHeight - 2; };

  /** Effective background and opacity-adjusted text colour of an element. */
  const colours = (el) => {
    const fg = parse(getComputedStyle(el).color);
    const layers = []; let unknown = false; let opaque = false; let bright = 1;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/gradient/.test(s.backgroundImage)) unknown = true;
      const c = parse(s.backgroundColor);
      layers.push({ c, o: parseFloat(s.opacity) });
      const bm = /brightness\(([\d.]+)\)/.exec(s.filter);
      if (bm && c[3] < 1) bright *= parseFloat(bm[1]);
      if (c[3] >= 1) { opaque = true; break; }
    }
    // an opaque layer's own opacity fades it together with the text; opacity of the layers above it fades the text only
    let op = 1; const upto = opaque ? layers.length - 1 : layers.length;
    for (let i = 0; i < upto; i++) op *= layers[i].o;
    let base = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i].c, base);
    const eff = over([Math.min(255, fg[0] * bright), Math.min(255, fg[1] * bright), Math.min(255, fg[2] * bright), fg[3] * op], base);
    return { fg: eff, bg: base, unknown, transparentText: fg[3] === 0 };
  };

  const out = { text: { n: 0, lt11: [], lt12: [] }, contrast: [], small24: [], small32: [], overflow: [], skippedGradient: 0, longLines: [] };
  const push = (arr, item) => { arr.push(item); };

  // ---- text nodes ----
  const checkText = (el, label) => {
    if (!el || el.closest(SKIP) || disabled(el)) return;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs <= 0) return; // the "font-size: 0" icon-button trick: the visible label comes from ::after
    out.text.n++;
    const info = { sig: sig(el), text: label.slice(0, 40), fs: Math.round(fs * 10) / 10 };
    if (fs < 11) push(out.text.lt11, info); else if (fs < 12) push(out.text.lt12, info);
    const c = colours(el);
    if (c.transparentText) return;
    if (c.unknown) { out.skippedGradient++; return; }
    const cr = ratio(c.fg, c.bg);
    const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    const need = large ? 3 : 4.5;
    if (cr < need - 0.005) push(out.contrast, { ...info, ratio: Math.round(cr * 100) / 100, need, fg: `rgb(${c.fg.slice(0, 3).map(Math.round)})`, bg: `rgb(${c.bg.slice(0, 3).map(Math.round)})` });
  };
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = n.nodeValue.trim(); if (!t) continue;
    if (offSheet(n.parentElement)) continue;
    checkText(n.parentElement, t);
  }
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), select")) {
    if (!el.closest(SKIP.replace("select, option, ", "")) && !offSheet(el) && ((el.value && el.value.length) || el.tagName === "SELECT")) checkText(el, el.value || "select");
  }

  // ---- targets ----
  const INTER = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=checkbox], [role=switch], [role=radio], [role=menuitem], [tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  for (const el of document.querySelectorAll(INTER)) {
    if (el.closest(".measure, canvas, [class*=recon], .map-tree") || disabled(el) || offSheet(el)) continue;
    if (!el.checkVisibility({ checkVisibilityCSS: true })) continue;
    if (el.tagName === "CANVAS") continue;
    let t = el;
    if (el.matches("input[type=checkbox], input[type=radio]")) t = el.closest("label") ?? (el.id && document.querySelector(`label[for="${el.id}"]`)) ?? el;
    if (t.closest(".measure")) continue;
    let w = t.offsetWidth || t.getBoundingClientRect().width, h = t.offsetHeight || t.getBoundingClientRect().height;
    if (t instanceof SVGElement) { const b = t.getBoundingClientRect(); w = b.width; h = b.height; }
    if (w < 2 || h < 2) continue;
    // inline text links inside a sentence are exempt
    const inSentence = (() => {
      if (!/^(inline|inline-block)$/.test(getComputedStyle(t).display) || t.tagName === "SUMMARY" || t.matches(".chip, .pchip, .gchip")) return false;
      for (let a = t.parentElement; a; a = a.parentElement) {
        const d = getComputedStyle(a).display;
        if (/flex|grid/.test(d)) return false;
        if (/^(block|list-item|flow-root|table-cell)$/.test(d)) return (a.textContent ?? "").trim().length > (t.textContent ?? "").trim().length + 3;
      }
      return false;
    })();
    if (inSentence) continue;
    const key = sig(t); const info = { sig: key, text: (t.getAttribute("aria-label") || t.textContent || "").trim().slice(0, 30), w: Math.round(w), h: Math.round(h) };
    if (w < 24 || h < 24) push(out.small24, info); else if (h < 32 && !seen.has(key)) { seen.add(key); push(out.small32, info); }
  }

  // ---- phone overflow ----
  if (phone) {
    const de = document.documentElement;
    if (de.scrollWidth > innerWidth + 1) out.overflow.push({ sig: "html", w: de.scrollWidth });
    for (const el of document.body.querySelectorAll("*")) {
      if (el.closest(".canvas, .atlas-canvas, .measure, .map-tree, .sr, svg, [class*=recon], .viewer")) continue;
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.right <= innerWidth + 1) continue;
      if (!el.checkVisibility({ checkVisibilityCSS: true }) || offSheet(el)) continue;
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(hidden|auto|scroll|clip)/.test(s.overflowX) && a.getBoundingClientRect().right <= innerWidth + 1) { clipped = true; break; } if (s.position === "fixed" && false) break; }
      const st = getComputedStyle(el);
      if (!clipped && r.left < innerWidth) out.overflow.push({ sig: sig(el), right: Math.round(r.right), pos: st.position });
    }
  }

  // ---- line length of prose in panels (report) ----
  for (const el of document.querySelectorAll(".rp-body p, .rp-body li, .atlas-panel p, .atlas-panel li, .atlas-panel .panel-meta")) {
    if ((el.textContent ?? "").length < 140 || !el.checkVisibility() || el.closest(".measure")) continue;
    const cs = getComputedStyle(el); cx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const ch = cx.measureText("0").width || parseFloat(cs.fontSize) * 0.55;
    const cols = (el.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / ch;
    if (cols > 75) out.longLines.push({ sig: sig(el), ch: Math.round(cols) });
  }
  return out;
}

/** Tab through the page; report stops and whether each shows a focus indicator. */
async function keyboard(page, maxTabs) {
  await page.evaluate(() => { document.activeElement instanceof HTMLElement && document.activeElement.blur(); });
  const stops = []; const bad = []; const regions = new Set();
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const ringOf = (e) => { const s = getComputedStyle(e); const out = parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== "none" && !/rgba\(\d+, \d+, \d+, 0\)/.test(s.outlineColor); return out || (s.boxShadow && s.boxShadow !== "none"); };
      let ring = ringOf(el) || (el.matches(".map-tree") && !!el.querySelector(".tree-hint"));
      if (!ring && el.nextElementSibling) ring = ringOf(el.nextElementSibling);
      if (!ring) { for (let a = el.parentElement, k = 0; a && k < 3; a = a.parentElement, k++) if (a.matches(":focus-within") && ringOf(a)) { ring = true; break; } }
      const region = el.closest(".rail") ? "rail" : el.closest(".titlebar, .atlas-top") ? "toolbar" : el.closest(".rp, .atlas-panel") ? "panel" : el.closest(".stage") ? "stage" : el.closest(".hub") ? "hub" : "other";
      const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/)[0];
      return { sig: `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`, label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24), ring: !!ring, region, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, visible: r.width > 0 && r.height > 0 };
    });
    if (!info) continue;
    regions.add(info.region); stops.push(info);
    if (!info.ring && info.visible) {
      // fall back to a pixel comparison with and without focus
      const clip = { x: Math.max(0, info.rect.x - 6), y: Math.max(0, info.rect.y - 6), width: Math.max(8, info.rect.width + 12), height: Math.max(8, info.rect.height + 12) };
      let differs = false;
      try {
        const a = await page.screenshot({ clip, animations: "disabled" });
        await page.evaluate(() => document.activeElement?.blur());
        const b = await page.screenshot({ clip, animations: "disabled" });
        differs = !a.equals(b);
      } catch { differs = true; }
      if (!differs) bad.push(`${info.sig} "${info.label}"`);
      // put focus back on that element's successor chain: re-focus via shift-tab is unreliable, so Tab continues from body
    }
  }
  return { stops, bad, regions: [...regions] };
}

const uniq = (arr, k = (x) => x.sig) => { const m = new Map(); for (const x of arr) { const key = k(x); const e = m.get(key); if (e) e.count++; else m.set(key, { ...x, count: 1 }); } return [...m.values()]; };
const rows = []; const details = [];
let musts = 0;

for (const scheme of ["light", "dark"]) {
  for (const [dev, w, h] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { try { sessionStorage.setItem("oc-intro", "1"); if (!sessionStorage.getItem("a11y-welcome")) localStorage.setItem("nav-help", "1"); localStorage.setItem("oc-canvas-hint", "1"); } catch { /* */ } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const phone = dev === "phone";
    const screens = [];
    screens.push(["home", async () => { await page.goto(base + "#atlas"); await page.waitForTimeout(3200); }]);
    screens.push(["home-search", async () => { await page.goto(base + "#atlas"); await page.waitForTimeout(2500); await page.locator(".hub-field input").fill("prostate"); await page.waitForTimeout(600); }]);
    screens.push(["guideline", async () => { await page.goto(base + "#atlas/prostate"); await page.waitForTimeout(3200); }]);
    const openReader = async (adv = false) => {
      await page.goto(base + "#prostate/");
      await page.evaluate((a) => { try { if (a) localStorage.setItem("oc-advanced", "1"); else localStorage.removeItem("oc-advanced"); } catch { /* */ } }, adv);
      await page.reload();
      await page.locator("[data-testid=card]").first().waitFor({ timeout: 30000 });
      const dlg = page.getByRole("dialog", { name: /Find where a patient sits/ });
      if (await dlg.count()) await page.getByRole("button", { name: /Browse the guideline/ }).click();
      await page.waitForTimeout(500);
    };
    screens.push(["welcome", async () => {
      await page.goto(base + "#prostate/");
      await page.evaluate(() => { try { sessionStorage.setItem("a11y-welcome", "1"); localStorage.removeItem("nav-help"); } catch { /* */ } });
      await page.reload();
      await page.getByRole("dialog", { name: /Find where a patient sits/ }).waitFor({ timeout: 30000 });
      await page.evaluate(() => { try { sessionStorage.removeItem("a11y-welcome"); } catch { /* */ } });
    }]);
    screens.push(["reader", async () => { await openReader(); }]);
    screens.push(["patient", async () => {
      await openReader();
      if (phone) await page.locator(".sheet-open-btn").click().catch(() => {});
      const enter = page.getByRole("button", { name: /Enter a patient/ });
      if (await enter.count()) await enter.first().click().catch(() => {});
      await page.waitForTimeout(700);
    }]);
    screens.push(["recommendation", async () => {
      await openReader();
      if (phone) await page.locator(".sheet-open-btn").click().catch(() => {});
      await page.getByTestId("patient-more").click();
      await page.locator('select[aria-label="Load an example"]').selectOption("V1");
      await page.keyboard.press("Escape").catch(() => {});
      await page.locator("#tab-paths").click();
      await page.waitForTimeout(1200);
    }]);
    screens.push(["patient-form", async () => {
      await openReader(true);
      if (phone) await page.locator(".sheet-open-btn").click().catch(() => {});
      await page.getByTestId("mode-form").click().catch(() => {});
      await page.evaluate(() => document.querySelectorAll(".rp-body details").forEach((d) => { d.open = true; }));
      await page.waitForTimeout(500);
    }]);
    screens.push(["route-detail", async () => {
      await openReader(true);
      if (phone) await page.locator(".sheet-open-btn").click().catch(() => {});
      await page.getByTestId("patient-more").click();
      await page.locator('select[aria-label="Load an example"]').selectOption("V1");
      await page.keyboard.press("Escape").catch(() => {});
      await page.locator("#tab-paths").click();
      await page.locator(".pcard").first().click().catch(() => {});
      await page.evaluate(() => document.querySelectorAll(".rp-body details").forEach((d) => { d.open = true; }));
      await page.waitForTimeout(900);
    }]);

    for (const [name, go] of screens) {
      const label = `${scheme}/${dev}/${name}`;
      try { await go(); } catch (e) { rows.push({ screen: label, error: String(e.message).split("\n")[0] }); musts++; continue; }
      await page.waitForTimeout(700); // let entrance animations settle before measuring
      const a = await page.evaluate(audit, { phone });
      const kb = await keyboard(page, name === "home" || name === "guideline" ? 14 : phone ? 45 : 150);
      const needRegions = /^(reader|patient|recommendation)$/.test(name) && !phone ? ["rail", "toolbar", "panel"] : [];
      const missingRegions = needRegions.filter((r) => !kb.regions.includes(r));
      const r = {
        screen: label, text: a.text.n, lt11: a.text.lt11.length, lt12: a.text.lt12.length, contrast: a.contrast.length,
        sm24: a.small24.length, sm32: a.small32.length, tabs: kb.stops.length, noRing: kb.bad.length, overflow: phone ? a.overflow.length : "-",
        long: a.longLines.length,
      };
      rows.push(r);
      musts += r.lt11 + r.contrast + r.sm24 + r.noRing + (phone ? a.overflow.length : 0) + (kb.stops.length < 3 ? 1 : 0) + missingRegions.length;
      const d = [];
      const show = (title, arr, fmt) => { if (arr.length) d.push(`  ${title}:`, ...uniq(arr).slice(0, VERBOSE ? 60 : 10).map((x) => `    ${x.count > 1 ? `${x.count}x ` : ""}${fmt(x)}`)); };
      show("font < 11px (MUST)", a.text.lt11, (x) => `${x.sig} ${x.fs}px "${x.text}"`);
      show("contrast < AA (MUST)", a.contrast, (x) => `${x.sig} ${x.ratio}:1 (need ${x.need}) ${x.fg} on ${x.bg} "${x.text}"`);
      show("target < 24px (MUST)", a.small24, (x) => `${x.sig} ${x.w}x${x.h} "${x.text}"`);
      show("no focus indicator (MUST)", kb.bad.map((s) => ({ sig: s })), (x) => x.sig);
      if (phone) show("horizontal overflow (MUST)", a.overflow, (x) => `${x.sig} right=${x.right ?? x.w} ${x.pos ?? ""}`);
      if (missingRegions.length) d.push(`  Tab never reached: ${missingRegions.join(", ")} (reached ${kb.regions.join(", ")}) (MUST)`);
      if (kb.stops.length < 3) d.push(`  Tab reached only ${kb.stops.length} stops (MUST)`);
      show("font 11-12px (report)", a.text.lt12, (x) => `${x.sig} ${x.fs}px "${x.text}"`);
      show("target < 32px tall (report)", a.small32, (x) => `${x.sig} ${x.w}x${x.h} "${x.text}"`);
      show("line > 75ch (report)", a.longLines, (x) => `${x.sig} ${x.ch}ch`);
      if (errors.length) d.push(`  page errors: ${errors.slice(0, 3).join(" | ")}`);
      if (d.length) details.push(`${label}\n${d.join("\n")}`);
    }
    await ctx.close().catch(() => {});
  }
}
await browser.close();
server.close();

console.log("\nscreen".padEnd(36) + "text  <11 <12 contrast <24 <32  tabs noRing overflow longLn");
for (const r of rows) {
  if (r.error) { console.log(`${r.screen.padEnd(35)} ERROR ${r.error}`); continue; }
  console.log(`${r.screen.padEnd(35)} ${String(r.text).padStart(4)} ${String(r.lt11).padStart(3)} ${String(r.lt12).padStart(3)} ${String(r.contrast).padStart(8)} ${String(r.sm24).padStart(3)} ${String(r.sm32).padStart(3)} ${String(r.tabs).padStart(5)} ${String(r.noRing).padStart(6)} ${String(r.overflow).padStart(8)} ${String(r.long).padStart(6)}`);
}
if (details.length) console.log("\n" + details.join("\n"));
console.log(musts ? `\nFAIL: ${musts} violation(s) of the required rules` : "\nok: no violations of the required rules");
process.exit(musts ? 1 : 0);
