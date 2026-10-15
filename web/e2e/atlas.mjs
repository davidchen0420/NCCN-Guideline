// Atlas home page: serves the repository over http and drives built/oncocarta.html.
//   node e2e/atlas.mjs            (from web/, after `python -m nccn_nav.dashboard --library`)
import { chromium } from "playwright-core";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TYPES = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
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
  assert.match(await page.locator(".hub-meta").innerText(), /91 guidelines · [\d,]+ algorithm pages · \d+ cross-references/);
});
await step("search finds a guideline and opens its map", async () => {
  await page.getByRole("combobox").fill("prostate");
  const first = page.getByRole("option").first();
  assert.match(await first.innerText(), /Prostate Cancer/);
  await page.keyboard.press("Enter");
  await waitHash("#atlas/prostate");
  assert.equal(await page.locator(".atlas-panel .panel-title").innerText(), "Prostate Cancer");
  assert.ok(await page.locator(".hub.docked").count(), "search docks at the top");
});
await step("search by abbreviation and by page", async () => {
  await page.getByRole("combobox").fill("CLL");
  assert.match(await page.getByRole("option").first().innerText(), /Chronic Lymphocytic Leukemia/);
  await page.getByRole("combobox").fill("PROS-3");
  assert.match(await page.getByRole("option").first().innerText(), /Low-Risk Group[\s\S]*PROS-3/);
  await page.getByRole("combobox").fill("");
});
await step("an example patient's route is shown and opens in the reader", async () => {
  await page.locator(".pchip").first().click();
  await page.locator(".route-card").waitFor();
  assert.match(await page.locator(".route-card").innerText(), /criteria met/);
  await page.getByRole("button", { name: /Open in the reader with this patient/ }).click();
  await page.locator("[data-testid=card]").first().waitFor();
  assert.match(await hash(), /^#prostate\/flow\/PROS-1/);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("oc-patient:prostate")));
  assert.ok(Object.keys(saved.facts).length > 0, "patient carried into the reader");
  assert.equal(await page.getByRole("dialog", { name: /Find where a patient sits/ }).count(), 0, "no welcome when a patient is loaded");
});
await step("the reader returns to the atlas at its page", async () => {
  await page.getByTestId("rail-library").click();
  await waitHash("#atlas/prostate/PROS-1");
  await page.locator(".atlas-panel .panel-title", { hasText: "PROS-1" }).waitFor();
});
await step("a page shows its boxes; a box opens in the reader at that box", async () => {
  await page.locator(".box-list button").first().waitFor();
  assert.ok(await page.locator(".box-list button").count() >= 3);
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
  await page.waitForTimeout(1500);
  // find the Survivorship marker by hovering along its spoke until the tooltip names it
  const box = await page.locator(".atlas-canvas").boundingBox();
  let hit = null;
  for (let a = -0.6; a <= -0.05 && !hit; a += 0.01) {
    for (const r of [0.33, 0.34, 0.35, 0.36, 0.37]) {
      const x = box.width / 2 + Math.sin(a) * r * Math.min(box.width, box.height - 60), y = 30 + box.height / 2 - Math.cos(a) * r * Math.min(box.width, box.height - 60);
      await page.mouse.move(x, y);
      const t = await page.locator(".tip .tip-title").textContent({ timeout: 50 }).catch(() => null);
      if (t === "Survivorship") { hit = [x, y]; break; }
    }
  }
  assert.ok(hit, "found Survivorship on the ring");
  await page.mouse.click(...hit);
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
  await m.close();
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
