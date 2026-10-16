// Atlas home page: serves the repository over http and drives built/oncocarta.html.
//   node e2e/atlas.mjs            (from web/, after `python -m nccn_nav.dashboard --library`)
import { chromium } from "playwright-core";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGuidelinePdf } from "./testpdf.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TYPES = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  if (/^[/\\]Guideline[/\\]/.test(path)) { res.writeHead(404); res.end(); return; }   // the tests run without the licensed PDFs
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/built/oncocarta.html`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });   // optional examples.json 404s
let n = 0;
const step = async (name, fn) => { await fn(); console.log(`ok ${++n} ${name}`); };
const hash = () => page.evaluate(() => location.hash);
const waitHash = (h) => page.waitForFunction((x) => location.hash === x, h);
/** Turn Advanced tools on or off in a running page (what the Settings switch does). */
const setAdvanced = (pg, on) => pg.evaluate((on) => {
  if (on) localStorage.setItem("oc-advanced", "1"); else localStorage.removeItem("oc-advanced");
  window.dispatchEvent(new CustomEvent("oc-advanced-changed", { detail: on }));
}, on);
/** How much ink there is in a region of the canvas (0 = blank paper). */
const ink = (x, y, w, h) => page.evaluate(([x, y, w, h]) => {
  const c = document.querySelector(".atlas-canvas");
  const d = c.getContext("2d").getImageData(x * devicePixelRatio, y * devicePixelRatio, w * devicePixelRatio, h * devicePixelRatio).data;
  const ref = [d[0], d[1], d[2]];
  let diff = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - ref[0]) + Math.abs(d[i + 1] - ref[1]) + Math.abs(d[i + 2] - ref[2]) > 30) diff++;
  return diff / (d.length / 4);
}, [x, y, w, h]);

await page.goto(base);
await step("the atlas is the home page and draws the map", async () => {
  await page.locator(".atlas-canvas").waitFor();
  await page.getByRole("combobox", { name: /Search guidelines/ }).waitFor();
  await page.waitForTimeout(3000);   // intro
  assert.ok(await ink(300, 100, 840, 700) > 0.02, "map is drawn");
  assert.equal(await page.getByRole("combobox").getAttribute("placeholder"), "Which cancer or topic?");
  assert.match(await page.locator(".proto-note").innerText(), /Research prototype, not an official NCCN tool/);
  assert.equal(await page.locator(".hub-meta").count(), 0, "encoding counts are for Advanced tools");
  assert.doesNotMatch(await page.locator(".atlas-hint").innerText(), /\bboxes?\b|encoded|\barcs?\b/i);
  assert.match(await page.locator(".atlas-hint").innerText(), /Click a cancer site or guideline to open it[\s\S]*Scroll to zoom[\s\S]*Esc to go back[\s\S]*\/ to search/);
  await setAdvanced(page, true);
  assert.match(await page.locator(".hub-meta").innerText(), /91 guidelines · [\d,]+ pages\s+\d+ cross-references/);
  await setAdvanced(page, false);
  assert.equal(await page.locator(".hub-meta").count(), 0);
});
await step("every organ site is named on the home page, at every screen size", async () => {
  for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
    await p.goto(base + "#atlas");
    await p.waitForFunction(() => (document.querySelector(".atlas-canvas")?.dataset.siteLabels ?? "").split(" ").length >= 15);
    const named = await p.evaluate(() => document.querySelector(".atlas-canvas").dataset.siteLabels.split(" ").map((x) => x.split(":")[0]));
    assert.equal(new Set(named).size, 15, `${w}x${h}: ${named.join(", ")}`);
    await p.close();
  }
  assert.ok(await page.locator(".atlas-hint").count(), "first visit: how to move around");
});
await step("clicking into a guideline is one smooth flight", async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(base + "#atlas/@gu");
  await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__f = []; let last = performance.now(); const loop = (t) => { window.__f.push(t - last); last = t; if (window.__f.length < 90) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
  await p.locator(".panel-list button", { hasText: "Prostate Cancer" }).first().click();
  await p.waitForTimeout(1800);
  const f = await p.evaluate(() => window.__f);
  const long = f.filter((x) => x > 70).length;
  assert.ok(long <= 1, `frames over 70 ms during the transition: ${long} (${f.map(Math.round).join(",")})`);
  await p.locator(".atlas-panel .panel-title", { hasText: "Prostate Cancer" }).waitFor();
  await p.close();
});
await step("search finds a guideline and opens its map", async () => {
  await page.getByRole("combobox").fill("prostate");
  const first = page.getByRole("option").first();
  assert.match(await first.innerText(), /Prostate Cancer/);
  await page.keyboard.press("Enter");
  await waitHash("#atlas/prostate");
  assert.equal(await page.locator(".atlas-panel .panel-title").innerText(), "Prostate Cancer");
  assert.ok(await page.locator(".hub.docked").count(), "search docks at the top");
  assert.ok(await page.getByTestId("enter-patient").isVisible());
  assert.match(await page.getByTestId("enter-patient").innerText(), /Find a recommendation for a patient/);
  await page.getByRole("button", { name: /Read the guideline/ }).waitFor();
  assert.doesNotMatch(await page.locator(".atlas-panel").innerText(), /Decision boxes encoded|share of boxes with a condition/, "encoding stats are for Advanced tools");
  await page.locator(".atlas-panel .about > summary").click();
  assert.doesNotMatch(await page.locator(".atlas-panel").innerText(), /Decision boxes encoded/);
  await setAdvanced(page, true);
  await page.locator(".atlas-panel .stats").waitFor();
  assert.match(await page.locator(".atlas-panel .about").innerText(), /Decision boxes encoded/);
  await setAdvanced(page, false);
});
await step("search by abbreviation and by page", async () => {
  await page.getByRole("combobox").fill("CLL");
  assert.match(await page.getByRole("option").first().innerText(), /Chronic Lymphocytic Leukemia/);
  await page.getByRole("combobox").fill("PROS-3");
  assert.match(await page.getByRole("option").first().innerText(), /Low-Risk Group[\s\S]*PROS-3/);
  await page.getByRole("combobox").fill("");
});
await step("an example patient's route is shown and opens in the reader", async () => {
  assert.match(await page.locator(".pchip").first().innerText(), /^Example: /);
  await page.locator(".pchip").first().click();
  await page.locator(".route-card").waitFor();
  const card = await page.locator(".route-card").innerText();
  assert.match(card, /(Best match|Also possible|Less likely|Unlikely)[\s\S]*(Matches your answers|Needs \d+ more answers?)[\s\S]*Recommendation:/);
  assert.match(card, /Verify on the NCCN page/);
  assert.match(card, /Research prototype, not an official NCCN tool/, "the route card carries the disclaimer");
  assert.doesNotMatch(card, /criteria met|of the weight/, "route statistics are for Advanced tools");
  await setAdvanced(page, true);
  assert.match(await page.locator(".route-card").innerText(), /criteria met/);
  await setAdvanced(page, false);
  // the verify link opens the NCCN page in its own window; Escape closes that window again
  const [nccn] = await Promise.all([page.context().waitForEvent("page"), page.getByRole("button", { name: "Verify on the NCCN page" }).click()]);
  await nccn.locator(".viewer-title").waitFor();
  await nccn.keyboard.press("Escape");
  await nccn.waitForEvent("close", { timeout: 5000 }).catch(() => {});
  assert.ok(nccn.isClosed(), "Escape closes the NCCN page window");
  await page.getByRole("button", { name: /Open in the reader with this patient/ }).click();
  await page.locator("[data-testid=card]").first().waitFor();
  assert.match(await hash(), /^#prostate\/flow\/PROS-1/);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("oc-patient:prostate")));
  assert.ok(Object.keys(saved.facts).length > 0, "patient carried into the reader");
  assert.equal(await page.getByRole("dialog", { name: /Find where a patient sits/ }).count(), 0, "no welcome when a patient is loaded");
});
await step("Enter a patient: the reader opens on the form, with steps saying what to do next", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push("enter: " + e.message));
  await p.goto(base + "#atlas/prostate");
  await p.getByTestId("enter-patient").click();
  await p.locator("[data-testid=card]").first().waitFor();
  assert.equal(await p.getByRole("dialog", { name: /Find where a patient sits/ }).count(), 0, "straight to the form");
  assert.equal(await p.getByRole("tab", { name: "Patient" }).getAttribute("aria-selected"), "true");
  const guide = p.getByRole("region", { name: "Steps" });
  assert.match(await guide.innerText(), /Start with/);
  // a suggested field is one click away and gets focus
  await guide.locator(".need").first().click();
  await p.waitForFunction(() => !!document.activeElement?.closest(".pf.flash"));
  await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => document.scrollingElement.scrollTop), 0, "only the panel scrolls");
  const hint = await p.locator(".canvas-hint").boundingBox(), view = await p.locator(".view").boundingBox();
  assert.ok(hint && view && hint.x >= view.x && hint.x + hint.width <= view.x + view.width + 1, "canvas hint stays over the canvas");
  // with an example loaded the steps move on: see the routes, then pick one
  await guide.getByRole("button", { name: /load an example patient/ }).click().catch(() => {});
  await p.waitForFunction(() => /recommendation is shown below|Best next question|enough to narrow it down/.test(document.querySelector(".guide")?.textContent ?? ""));
  await ctx.close();
});
await step("the reader returns to the atlas at its page", async () => {
  await page.getByTestId("rail-library").click();
  await waitHash("#atlas/prostate/PROS-1");
  await page.locator(".atlas-panel .panel-title", { hasText: "PROS-1" }).waitFor();
});
await step("a page shows its boxes; a box opens in the reader at that box", async () => {
  await page.locator(".box-list button").first().waitFor();
  assert.ok(await page.locator(".box-list button").count() >= 3);
  assert.equal(await page.getByRole("heading", { name: "Steps on this page" }).count(), 1);
  await page.getByRole("button", { name: "Read this page" }).waitFor();
  assert.equal(await page.getByTestId("open-pdf-page").innerText(), "Open NCCN page");
  assert.doesNotMatch(await page.locator(".atlas-panel .panel-meta").innerText(), /encoded|boxes/);
  await page.waitForTimeout(1200);
  assert.ok(await ink(100, 150, 800, 600) > 0.02, "the page card is drawn");
  await page.locator(".box-list button").nth(1).click();
  await page.waitForFunction(() => /^#prostate\/flow\/PROS-1\/.+/.test(location.hash));
  await page.locator("[data-testid=card]").first().waitFor();
  await page.getByTestId("rail-library").click();
  await waitHash("#atlas/prostate/PROS-1");
  await page.locator(".atlas-panel .panel-title", { hasText: "PROS-1" }).waitFor();
});
await step("Escape climbs back up: page, guideline, site, atlas", async () => {
  await page.keyboard.press("Escape");
  await waitHash("#atlas/prostate");
  await page.keyboard.press("Escape");
  await waitHash("#atlas/@gu");
  assert.equal(await page.locator(".atlas-panel .panel-title").innerText(), "Genitourinary");
  await page.keyboard.press("Escape");
  await waitHash("#atlas");
});
await step("browser Back retraces the levels", async () => {
  await page.goBack();
  await waitHash("#atlas/@gu");
  await page.goForward();
  await waitHash("#atlas");
});
await step("the keyboard tree walks sites, guidelines and pages", async () => {
  await page.locator("[role=tree]").focus();
  await page.keyboard.press("ArrowRight");   // open Breast
  await page.keyboard.press("ArrowDown");    // Breast Cancer
  assert.match(await page.locator(".tree-hint b").innerText(), /^Breast Cancer/);
  await page.keyboard.press("Enter");
  await waitHash("#atlas/breast");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await waitHash("#atlas/breast/DCIS-2");
});
await step("clicking a guideline on the ring opens its map", async () => {
  await page.goto(base + "#atlas");
  await page.waitForTimeout(3000);
  // find the Survivorship marker by hovering along its spoke until the tooltip names it
  const box = await page.locator(".atlas-canvas").boundingBox();
  let hit = null;
  for (let a = -0.6; a <= -0.05 && !hit; a += 0.01) {
    for (const r of [0.30, 0.31, 0.32, 0.33, 0.34, 0.35]) {
      const x = box.width / 2 + Math.sin(a) * r * Math.min(box.width, box.height - 60), y = 30 + box.height / 2 - Math.cos(a) * r * Math.min(box.width, box.height - 60);
      await page.mouse.move(x, y);
      const t = await page.locator(".tip .tip-title").textContent({ timeout: 120 }).catch(() => null);
      if (t === "Survivorship") { hit = [x, y]; break; }
    }
  }
  assert.ok(hit, "found Survivorship on the ring");
  await page.mouse.click(...hit);
  await page.waitForFunction((h) => location.hash === h, "#atlas/survivorship", { timeout: 4000 }).catch(() => page.mouse.click(...hit));   // a busy machine can swallow the first click
  await waitHash("#atlas/survivorship");
  await page.waitForTimeout(1400);
  assert.ok(await ink(200, 150, 600, 600) > 0.02, "pages bloom out");
});
await step("the list view is one click away and back", async () => {
  await page.getByTestId("to-list").click();
  await page.locator(".lib-row").first().waitFor();
  assert.ok(await page.locator(".lib-row").count() >= 91);   // plus "Recently opened"
  await page.getByTestId("to-atlas").click();
  await page.locator(".atlas-canvas").waitFor();
});
await step("small screens: search docked, details as a bottom sheet", async () => {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  m.on("pageerror", (e) => errors.push("mobile: " + e.message));
  await m.goto(base + "#atlas/prostate");
  await m.locator(".atlas-panel").waitFor();
  assert.ok(await m.locator(".hub.docked").count());
  const r = await m.locator(".atlas-panel").boundingBox();
  assert.ok(r.y > 844 * 0.45, "panel sits at the bottom");
  assert.equal((await m.locator(".crumbs").innerText()).trim(), "Prostate Cancer", "phone breadcrumb: the guideline name only");
  await m.close();
});
await step("Read the guideline and Read this page ask the reader to skip its welcome", async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { window.__intents = []; const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === "oc-intent") window.__intents.push(v); return set.call(this, k, v); }; });
  await p.goto(base + "#atlas/prostate");
  await p.getByRole("button", { name: /Read the guideline/ }).click();
  await p.locator("[data-testid=card]").first().waitFor({ timeout: 15000 });
  assert.ok((await p.evaluate(() => window.__intents)).includes("read"), "reading intent set");
  await p.goto(base + "#atlas/prostate/PROS-2");
  await p.getByRole("button", { name: "Read this page" }).click();
  await p.locator("[data-testid=card]").first().waitFor({ timeout: 15000 });
  assert.equal((await p.evaluate(() => window.__intents)).filter((x) => x === "read").length >= 2, true);
  await p.close();
});
await step("example patients: two shown, the rest behind More examples", async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(base + "#atlas/prostate");
  await p.locator(".pchip").first().waitFor();
  assert.equal(await p.locator(".pchips[aria-label='Example patients'] .pchip:not(.more-ex)").count(), 2);
  assert.match(await p.locator(".more-ex").innerText(), /More examples \(\d+\)/);
  await p.locator(".more-ex").click();
  assert.ok(await p.locator(".pchips[aria-label='Example patients'] .pchip:not(.more-ex)").count() >= 3);
  assert.equal(await p.locator(".more-ex").count(), 0);
  await p.close();
});
await step("phone: the first visit opens the list, the map is one tap away", async () => {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  m.on("pageerror", (e) => errors.push("phone home: " + e.message));
  await m.goto(base);
  await m.locator(".lib-row").first().waitFor();
  assert.equal(await m.locator(".atlas-canvas").count(), 0, "no radial map on the phone's first screen");
  await m.getByTestId("to-atlas").click();
  await m.locator(".atlas-canvas").waitFor();
  await m.close();
});
await step("a preview needs a real pointer move and never opens right after a click", async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(base);
  await p.waitForTimeout(500);
  await p.mouse.move(1250, 620);   // rests where the step list is about to appear
  await p.evaluate(() => { location.hash = "#atlas/prostate/PROS-2"; });
  await p.locator(".box-list .bl-main").first().waitFor();
  await p.waitForTimeout(1800);
  assert.equal(await p.locator(".peek").count(), 0, "no preview for a pointer that did not move");
  await p.mouse.move(1253, 624);
  await p.locator(".peek").waitFor({ timeout: 5000 });
  await p.close();
});
await step("Open NCCN page says it opens a new window; a blocked pop-up shows the page here, with a note", async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { window.open = () => null; });
  await p.goto(base + "#atlas/prostate/PROS-2");
  const btn = p.getByTestId("open-pdf-page");
  await btn.waitFor();
  assert.equal(await btn.getAttribute("title"), "Opens in a new window");
  await p.waitForFunction(() => !document.querySelector("[data-testid=open-pdf-page]")?.disabled);
  await btn.click();
  await p.locator(".viewer").waitFor({ timeout: 10000 });
  assert.match(await p.locator(".viewer").innerText(), /Your browser blocked the new window; showing the page here\./);
  await p.close();
});
await step("reduced motion: no intro, the map is drawn at once", async () => {
  const p = await browser.newPage({ viewport: { width: 1200, height: 800 }, reducedMotion: "reduce" });
  await p.goto(base);
  await p.locator(".atlas-canvas").waitFor();
  await p.waitForTimeout(300);
  const v = await p.evaluate(() => {
    const c = document.querySelector(".atlas-canvas"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let k = 0; for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - d[0]) > 30) k++; return k / (d.length / 16);
  });
  assert.ok(v > 0.02, "drawn without waiting for the intro");
  await p.close();
});
await step("source PDF: found next to the data, shown on hover, opened on click", async () => {
  const pdf = await makeGuidelinePdf(join(ROOT, "data/prostate/guideline.json"));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push("pdf: " + e.message));
  let served = 0;
  await p.route("**/data/prostate/pdf/prostate.pdf", (r) => { served++; r.fulfill({ status: 200, contentType: "application/pdf", body: pdf }); });
  await p.goto(base + "#atlas/prostate/PROS-3");
  await p.getByRole("button", { name: "NCCN page", exact: true }).waitFor({ timeout: 20000 });   // the PDF loaded by itself
  assert.ok(served >= 1, "the served copy was fetched");
  assert.equal(await p.getByTestId("pdf-btn").count(), 0, "PDFs ship with the app: nothing to connect, nothing shown");
  // the page card is the diagram; "Original page" draws the PDF page instead (its blue box outlines show)
  await p.waitForTimeout(1500);
  const bluePx = () => p.evaluate(() => {
    const c = document.querySelector(".atlas-canvas"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 150 && d[i] < 90 && d[i + 1] < 90) n++; return n;
  });
  assert.ok((await bluePx()) < 200, "the card is the diagram, not the PDF page");
  assert.equal(await p.getByRole("button", { name: "Diagram", exact: true }).getAttribute("aria-pressed"), "true");
  await p.getByRole("button", { name: "NCCN page", exact: true }).click();
  await p.waitForTimeout(1500);
  const blue = await p.evaluate(() => {
    const c = document.querySelector(".atlas-canvas"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 150 && d[i] < 90 && d[i + 1] < 90) n++; return n;
  });
  assert.ok(blue > 500, `card shows the original page (${blue} blue pixels)`);
  // hover a box in the panel: the preview is the rendered PDF page with the box outlined
  const row = p.locator(".box-list .bl-main").nth(2);
  await row.hover();
  await p.locator(".peek .page-img img").waitFor();
  const hl = await p.locator(".peek .hl").boundingBox(), img = await p.locator(".peek .page-img img").boundingBox();
  const peekBox = await p.locator(".peek").boundingBox(), rowBox = await row.boundingBox();
  assert.ok(peekBox.width >= 440, `the preview is large enough to read on desktop (${Math.round(peekBox.width)}px)`);
  assert.ok(peekBox.x + peekBox.width <= rowBox.x, "the preview sits to the left of the panel row, not over the panel");
  assert.match(await p.locator(".peek .edition-note").innerText(), /different edition/, "the synthetic PDF is another edition: default users are warned");
  assert.ok(hl && img && hl.x >= img.x && hl.y >= img.y && hl.x + hl.width <= img.x + img.width + 1, "box outlined inside the page");
  assert.equal(await p.locator(".peek .recon").count(), 0, "not the reconstruction");
  await p.getByRole("button", { name: "Diagram", exact: true }).click();
  // click: the original page opens in its own window, one click from the reader
  const [win] = await Promise.all([ctx.waitForEvent("page"), row.click()]);
  await win.locator(".viewer .page-img img").waitFor();
  assert.match(await win.locator(".viewer-title").innerText(), /PROS-3[\s\S]*PDF p\.\d+ of 222/);
  assert.match(await win.title(), /PROS-3/);
  assert.equal(await p.locator(".viewer").count(), 0, "not over the diagram");
  await win.locator(".viewer-act").click();
  await p.waitForFunction(() => /^#prostate\/flow\/PROS-3\/.+/.test(location.hash));
  // the reader finds the same PDF: its card previews are original pages too (Advanced shows the PDF control)
  await p.evaluate(() => localStorage.setItem("oc-advanced", "1"));
  await p.goto(base + "#prostate/flow/PROS-3");
  await p.reload();
  if (await p.getByRole("dialog", { name: /Find where a patient sits/ }).count()) await p.getByRole("button", { name: /Read the guideline/ }).click();
  await p.locator(".pdf-btn.ready").first().waitFor({ timeout: 20000 });
  await ctx.close();
});
await step("hosted copy: the PDF published next to the page; clicking a box shows its original page", async () => {
  const pdf = await makeGuidelinePdf(join(ROOT, "data/prostate/guideline.json"));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push("hosted pdf: " + e.message));
  await p.addInitScript(() => { try { localStorage.setItem("nav-help", "1"); localStorage.setItem("oc-canvas-hint", "1"); localStorage.setItem("oc-advanced", "1"); } catch { /* */ } });
  await p.route("**/built/pdfs/prostate.pdf", (r) => r.fulfill({ status: 200, contentType: "application/pdf", body: pdf }));
  await p.goto(base + "#prostate/flow/PROS-2");
  if (await p.getByRole("dialog", { name: /Find where a patient sits/ }).count()) await p.getByRole("button", { name: /Read the guideline/ }).click();
  await p.locator(".pdf-btn.ready").first().waitFor({ timeout: 20000 });
  const card = p.locator(".canvas [data-testid=card]:visible").filter({ hasText: "Intermediate" }).first();
  // hover: the page with the box highlighted
  await card.hover({ position: { x: 10, y: 10 } });
  await p.locator(".peek .page-img img").waitFor();
  assert.equal(await p.locator(".peek .hl").count(), 1, "box highlighted");
  // click: the page in its own window, reused for the next box
  const [win] = await Promise.all([ctx.waitForEvent("page"), card.click({ position: { x: 10, y: 10 } })]);
  await win.locator(".viewer .page-img img").waitFor();
  assert.match(await win.locator(".viewer-title").innerText(), /PROS-2[\s\S]*PDF p\.\d+ of 222/);
  await p.locator(".canvas [data-testid=card]:visible").filter({ hasText: "High" }).first().click({ position: { x: 10, y: 10 } });
  await p.waitForTimeout(500);
  assert.equal(ctx.pages().length, 2, "one window for the pages");
  await ctx.close();
});
await step("source PDF: a folder is matched to guidelines and kept in the browser", async () => {
  const pdf = await makeGuidelinePdf(join(ROOT, "data/prostate/guideline.json"));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push("folder: " + e.message));
  await p.addInitScript(() => { try { localStorage.setItem("oc-advanced", "1"); } catch { /* */ } });   // the folder menu is an Advanced tool
  await p.goto(base + "#atlas");
  await p.getByTestId("pdf-btn").click();
  const dir = await mkdtemp(join(tmpdir(), "oc-pdfs-"));
  await writeFile(join(dir, "prostate.pdf"), pdf);
  await writeFile(join(dir, "notes.pdf"), "%PDF-1.4\n%%EOF\n");
  await p.getByTestId("pdf-folder-input").setInputFiles(dir);
  await p.locator(".pdf-menu .pm-note", { hasText: /Connected 1 guideline PDF/ }).waitFor();
  assert.match(await p.locator(".pdf-menu").innerText(), /1 by file name[\s\S]*1 file matched no guideline: notes\.pdf/);
  assert.match(await p.getByTestId("pdf-btn").innerText(), /Source PDFs · 1 of 91/);
  // kept: a fresh visit (nothing served) still shows the original page
  await p.goto(base + "#atlas/prostate/PROS-1");
  await p.reload();
  await p.locator(".atlas .pdf-btn.ready").waitFor({ timeout: 20000 });
  await p.locator(".box-list .bl-main").first().hover();
  await p.locator(".peek .page-img img").waitFor();
  await ctx.close();
  await rm(dir, { recursive: true, force: true });
});
await step("opened from disk (file://): guidelines, Enter a patient and the list all open", async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.on("pageerror", (e) => errors.push("file: " + e.message));
  const url = new URL("built/oncocarta.html", "file://" + ROOT).href;
  await p.goto(url + "#atlas/prostate");
  await p.getByTestId("enter-patient").click();
  await p.locator("[data-testid=card]").first().waitFor({ timeout: 15000 });
  await p.getByTestId("patient-more").click();
  assert.ok(await p.locator('select[aria-label="Load an example"] option').count() > 1, "example patients come with the guideline");
  await p.goto(url + "#atlas/prostate/PROS-3");
  await p.locator(".box-list .bl-main").first().waitFor({ timeout: 15000 });
  await p.getByRole("button", { name: "Connect the NCCN PDF" }).first().waitFor({ timeout: 8000 });   // no PDF next to a file:// page
  await p.goto(url + "#list");
  await p.locator(".lib-row").nth(3).click();
  await p.locator("[data-testid=card]").first().waitFor({ timeout: 15000 });
  await p.close();
});
await step("a guideline that cannot be read says which file and offers Try again", async () => {
  const p = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  let block = true;
  await p.route(/guidelines\/kidney\.js|kidney\/guideline\.json/, (r) => (block ? r.abort("connectionreset") : r.continue()));
  await p.goto(base + "#kidney/");
  const box = p.locator(".load-error");
  await box.waitFor({ timeout: 15000 });
  assert.match(await box.innerText(), /This guideline couldn't open[\s\S]*Try again, or go back to all guidelines/);
  assert.doesNotMatch(await box.innerText(), /kidney\.js/, "the file names are behind Details");
  await box.getByText("Details", { exact: true }).click();
  assert.match(await box.innerText(), /guidelines\/kidney\.js[\s\S]*kidney\/guideline\.json/);
  block = false;
  await p.getByRole("button", { name: "Try again" }).click();
  await p.locator("[data-testid=card]").first().waitFor({ timeout: 15000 });
  await p.close();
});
await step("served on 0.0.0.0 (as python's server prints), the page moves to localhost", async () => {
  const p = await browser.newPage();
  await p.goto(base.replace("127.0.0.1", "0.0.0.0") + "#atlas");
  await p.waitForFunction(() => location.hostname === "localhost");
  await p.locator(".atlas-canvas").waitFor();
  await p.close();
});
if (process.argv.includes("--all")) {
  // Every guideline: its map opens, and its first start page unfolds with its boxes.
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const raw = await p.goto(base).then(() => p.evaluate(() => window.__ATLAS__));
  const fails = [];
  for (const g of raw.guidelines) {
    const errs = [];
    const onErr = (e) => errs.push(String(e.message ?? e));
    p.on("pageerror", onErr);
    try {
      const first = g.pages.find((x) => x.e) ?? g.pages[0];
      await p.evaluate((h) => { location.hash = h; }, `#atlas/${g.slug}/${encodeURIComponent(first.id)}`);
      await p.locator(".atlas-panel .box-list button, .atlas-panel .no-boxes").first().waitFor({ timeout: 15000 });
    } catch (e) { errs.push(String(e.message ?? e).split("\n")[0]); }
    p.off("pageerror", onErr);
    if (errs.length) fails.push(`${g.slug}: ${errs.join("; ")}`);
  }
  console.log(`ok ${++n} all ${raw.guidelines.length} guideline maps and first pages open${fails.length ? "" : " without errors"}`);
  assert.deepEqual(fails, [], fails.join("\n"));
}
await browser.close();
server.close();
assert.deepEqual(errors, [], "console errors: " + errors.join("; "));
console.log(`\nall ${n} atlas checks passed`);
