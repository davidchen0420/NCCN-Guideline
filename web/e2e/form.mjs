// The patient form: paste the record, deciding details with previews, checks, saved patients,
// one question at a time. Serves the repo and drives built/oncocarta.html.
//   node e2e/form.mjs   (from web/, after `python -m nccn_nav.dashboard --library`)
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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem("nav-help", "1"); localStorage.setItem("oc-canvas-hint", "1"); } catch { /* */ } });
let n = 0;
const step = async (name, fn) => { await fn(); console.log(`ok ${++n} ${name}`); };
const panel = page.locator(".rp-body");

await page.goto(base + "#prostate/");
await page.locator("[data-testid=card]").first().waitFor();
await step("before any entry: the details that decide the first branches, each saying which box", async () => {
  const dec = panel.locator(".fgroup.deciders");
  assert.match(await dec.locator("legend").innerText(), /Start with these/i);
  assert.ok(await dec.locator(".pf.decider").count() >= 1);
  assert.match(await dec.locator(".decides").first().innerText(), /Decides\s+PROS-\d+/);
  assert.equal(await panel.locator(".more-details").getAttribute("open"), null, "the rest is folded away");
});
await step("paste the record: details found, shown with their evidence, applied after review", async () => {
  await panel.getByText("Paste from the record").click();
  await panel.locator(".paste textarea").fill("64-year-old man with low-risk prostate cancer (cT1c, Gleason 3+3, PSA 5 ng/mL), life expectancy about 18 years. PSA nadir was 0.2.");
  await panel.getByRole("button", { name: "Find details" }).click();
  const found = await panel.locator(".found li").allInnerTexts();
  assert.ok(found.some((t) => /Clinical T Category\s+T1c/.test(t)), found.join(" | "));
  assert.ok(found.some((t) => /Grade Group\s+1[\s\S]*Gleason 3\+3/.test(t)));
  assert.ok(found.some((t) => /PSA\s+5 ng\/mL/.test(t)), "the nadir is not the PSA");
  // untick one before applying
  await panel.locator(".found li", { hasText: "Life Expectancy" }).locator("input").uncheck();
  await panel.getByTestId("apply-found").click();
  const chips = await panel.locator(".chips-strip").innerText();
  assert.match(chips, /Age 64/); assert.match(chips, /cT: T1c/); assert.match(chips, /PSA: 5 ng\/mL/);
  assert.doesNotMatch(chips, /Life Expectancy/);
});
await step("deciding details preview where each answer leads; choosing one from the preview sets it", async () => {
  await panel.locator(".chips-strip li", { hasText: "Risk Group" }).locator(".chip-x").click().catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll(".fgroup.deciders .previews li").length > 0, null, { timeout: 10000 });
  const first = panel.locator(".fgroup.deciders .pf.decider").first();
  const name = (await first.locator(".flabel span").first().innerText()).trim();
  await first.locator(".previews button").first().click();
  await page.waitForTimeout(300);
  await page.waitForFunction((nm) => [...document.querySelectorAll(".chips-strip li")].some((li) => li.textContent.includes(nm.split(" ")[0])), name);
});
await step("implausible numbers and contradictions are flagged", async () => {
  await panel.locator(".chips-strip li", { hasText: "PSA" }).first().locator("button").first().click();
  await page.locator("#fact-psa_ng_ml").fill("8200");
  await page.locator("#fact-psa_ng_ml").press("Tab");
  assert.match(await panel.locator(".check.warn").first().innerText(), /unusually high/);
  await page.locator("#fact-psa_ng_ml").fill("5"); await page.locator("#fact-psa_ng_ml").press("Tab");
  if (!(await page.locator("#fact-visceral_metastases_present").isVisible())) await panel.locator(".more-details > summary").click();
  const m0 = page.locator("#fact-m_category button", { hasText: "M0" });
  if (await m0.getAttribute("aria-checked") !== "true") await m0.click();   // a second click would clear it
  await page.locator("#fact-visceral_metastases_present button", { hasText: "Yes" }).click();
  assert.match(await panel.locator(".conflicts").innerText(), /M0, but visceral metastases is recorded/);
});
await step("number keys choose an answer", async () => {
  await page.locator("#fact-visceral_metastases_present button", { hasText: "Yes" }).focus();
  await page.keyboard.press("2");
  assert.equal(await page.locator("#fact-visceral_metastases_present button", { hasText: "No" }).getAttribute("aria-checked"), "true");
});
await step("patients are saved in the browser and loaded back", async () => {
  await panel.getByRole("button", { name: "Save", exact: true }).first().click();
  await panel.getByLabel("Name for this patient").fill("Test patient A");
  await panel.locator(".save-row button[type=submit]").click();
  await panel.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(await panel.locator(".chips-strip").count(), 0);
  await panel.locator('select[aria-label="Load a patient"]').selectOption({ label: "Test patient A" });
  assert.match(await panel.locator(".chips-strip").innerText(), /cT: T1c/);
});
await step("one question at a time: the next deciding detail, answered with a number key, Back undoes", async () => {
  await panel.getByRole("button", { name: "Clear", exact: true }).click();
  await panel.getByTestId("mode-interview").click();
  const q1 = await panel.locator(".iv-q").innerText();
  await page.locator("body").click({ position: { x: 700, y: 500 } }).catch(() => {});
  await page.keyboard.press("1");
  await page.waitForFunction((q) => document.querySelector(".iv-q")?.textContent !== q || document.querySelector(".interview.done"), q1);
  assert.equal(await panel.locator(".chips-strip li").count(), 1);
  await panel.getByRole("button", { name: "Back" }).click();
  assert.equal(await panel.locator(".chips-strip").count(), 0);
  // a jump to a field from elsewhere returns to the full form
  await panel.getByRole("button", { name: /Don't know/ }).click();
  await page.evaluate(() => document.querySelector(".guide .need")?.click());
  await page.waitForFunction(() => !document.querySelector(".interview"));
  await panel.locator(".mode-switch button").first().click();
});
await step("works across guidelines: multi-disease guideline asks the disease first", async () => {
  await page.goto(base + "#b_cell_lymphomas/");
  await page.locator("[data-testid=card]").first().waitFor();
  await page.locator("#fact-guideline_section").waitFor();
  await page.locator("#fact-guideline_section").selectOption({ index: 1 });
  await page.waitForFunction(() => document.querySelector(".fgroup.deciders legend")?.textContent?.includes("Decides your routes"));
});
await browser.close();
server.close();
assert.deepEqual(errors, [], "console errors: " + errors.join("; "));
console.log(`\nall ${n} form checks passed`);
