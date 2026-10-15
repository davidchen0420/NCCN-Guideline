// Library smoke test: serves the repository over http and drives built/oncocarta.html.
//   node e2e/library.mjs            (from web/, after `python -m nccn_nav.dashboard --library`)
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
const closeWelcome = async () => { if (await page.getByRole("dialog", { name: /Find where a patient sits/ }).count()) await page.getByRole("button", { name: /Browse the guideline/ }).click(); };

await page.goto(base + "#list");
await step("library lists every guideline by category", async () => {
  await page.locator(".lib-row").first().waitFor();
  assert.equal(await page.locator(".lib-row").count(), 91);
});
await step("search narrows the list and opens a guideline", async () => {
  await page.getByLabel("Find a guideline").fill("prostate cancer");
  await page.locator(".lib-row", { hasText: /^Prostate Cancer/ }).first().click();
  await page.locator("[data-testid=card]").first().waitFor();
  assert.match(await page.evaluate(() => location.hash), /^#prostate\//);
  await closeWelcome();
});
await step("an example patient is routed with the data's option conditions", async () => {
  await page.getByTestId("patient-more").click();
  await page.locator('select[aria-label="Load an example"]').selectOption("V1");
  await page.getByRole("tab", { name: /Recommendation/ }).click();
  assert.match(await page.locator(".pcard").first().innerText(), /Most likely/);
  assert.match(await page.locator(".trail").innerText(), /Matches treatment received/);
});
await step("multi-disease guidelines ask for the disease first", async () => {
  await page.goto(base + "#aml/");
  await page.locator("[data-testid=card]").first().waitFor();
  await closeWelcome();
  await page.getByRole("tab", { name: "Patient" }).click();
  await page.locator("#fact-guideline_section").selectOption({ index: 1 });
  await page.getByRole("tab", { name: /Recommendation/ }).click();
  assert.ok(await page.locator(".pcard").count() >= 1);
});
await step("a reference to another guideline opens it at that page", async () => {
  await page.goto(base + "#nsclc/flow/NSCL-12");
  const ref = page.locator('[data-testid=card] [data-ref="LCS-11"]');
  await ref.first().waitFor({ state: "attached" });
  await ref.first().evaluate((e) => e.click());
  await page.waitForFunction(() => location.hash.startsWith("#lung_screening/"));
  assert.match(await page.getByTestId("title").textContent(), /LCS-11/);
});
await step("the rail returns to the atlas at the page being read", async () => {
  await closeWelcome();
  await page.getByTestId("rail-library").click();
  await page.waitForFunction(() => location.hash === "#atlas/lung_screening/LCS-11");
  await page.locator(".atlas-panel .panel-title", { hasText: "LCS-11" }).waitFor();
});
await step("clicking a box opens its page from the guideline PDF in its own window", async () => {
  await page.goto(base + "#prostate/flow/PROS-2");
  await closeWelcome();
  const card = page.locator(".canvas [data-testid=card]:visible").filter({ hasText: "Intermediate" }).first();
  const [win] = await Promise.all([page.context().waitForEvent("page"), card.click({ position: { x: 20, y: 40 } })]);
  await win.locator(".viewer-bar", { hasText: "PROS-2" }).waitFor();
  await win.getByRole("button", { name: "Close page viewer" }).click();
  await page.waitForTimeout(300);
  assert.ok(win.isClosed(), "Close shuts the window");
});
if (process.argv.includes("--all")) {
  // Every guideline: opens, renders its first algorithm page, the patient form and the pathways tab.
  const slugs = JSON.parse(await readFile(join(ROOT, "data/index.json"), "utf8")).guidelines.map((g) => g.slug);
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const fails = [];
  await p.addInitScript(() => { try { localStorage.setItem("oc-form-mode", "form"); } catch { /* */ } });   // the full form lists every field
  for (const slug of slugs) {
    const errs = [];
    const onErr = (e) => errs.push(String(e.message ?? e));
    p.on("pageerror", onErr);
    try {
      await p.goto(`${base}#${slug}/`);
      await p.locator("[data-testid=card]").first().waitFor({ timeout: 15000 });
      if (await p.getByRole("dialog", { name: /Find where a patient sits/ }).count()) await p.getByRole("button", { name: /Enter a patient/ }).click();
      await p.getByRole("tab", { name: "Patient" }).click();
      const labels = await p.locator(".patient .flabel > span:first-child").allTextContents();
      const lower = labels.filter((l) => /\b(Ecog|Psa|Mri|Pet|Hiv|Covid|Ldh|Egfr|Her2)\b/.test(l) || /_/.test(l));
      if (lower.length) errs.push("labels: " + lower.slice(0, 3).join(", "));
      if (!labels.length) errs.push("no patient fields");
      await p.getByRole("tab", { name: /Recommendation/ }).click();
      const start = p.locator("#start");
      const opts = await start.locator("option").count();
      if (opts > 1) { await start.selectOption({ index: 1 }); await p.locator(".pcard, .empty").first().waitFor({ timeout: 10000 }); }
    } catch (e) { errs.push(String(e.message ?? e).split("\n")[0]); }
    p.off("pageerror", onErr);
    if (errs.length) fails.push(`${slug}: ${errs.join("; ")}`);
  }
  console.log(`ok ${++n} all ${slugs.length} guidelines open, list patient details and rank pathways${fails.length ? "" : " without errors"}`);
  assert.deepEqual(fails, [], fails.join("\n"));
}
await browser.close();
server.close();
assert.deepEqual(errors, [], "console errors: " + errors.join("; "));
console.log(`\nall ${n} library checks passed`);
