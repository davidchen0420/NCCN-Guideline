// The patient panel: one question at a time on a first visit, the full form, paste from the note,
// previews, checks, the More menu with saved patients, moments. Serves the repo and drives built/oncocarta.html.
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
const more = panel.getByTestId("patient-more");
/** Open the More menu and click one of its buttons. */
const fromMore = async (name) => { await more.click(); await panel.getByRole("button", { name, exact: true }).click(); };

await page.goto(base + "#prostate/");
await page.locator("[data-testid=card]").first().waitFor();
await step("first visit: one question at a time, saying which page it decides; the form is one link away", async () => {
  const dec = panel.locator(".fgroup.deciders");
  assert.match(await dec.locator("legend").innerText(), /Questions that decide the first steps/);
  assert.equal(await panel.locator(".interview").count(), 1, "one question at a time is the default");
  assert.match(await panel.locator(".interview .decides").innerText(), /Decides: .+ \(PROS-\d+\)/);
  assert.match(await panel.locator(".iv-n").innerText(), /^Question 1/);
  assert.equal(await panel.locator('select[aria-label="Which page"]').count(), 0, "page choice is an Advanced tool");
  assert.match(await panel.getByTestId("moment").innerText(), /Where is the patient now\?/);
  await panel.getByTestId("mode-form").click();
  assert.equal(await panel.locator(".interview").count(), 0);
  assert.ok(await dec.locator(".pf.decider").count() >= 1);
  assert.match(await dec.locator(".decides").first().innerText(), /Decides: .+ \(PROS-\d+\)/);
  assert.equal(await panel.locator(".more-details").getAttribute("open"), null, "the rest is folded away");
  assert.equal(await panel.locator(".more-details").getByText("Stated in the record").count(), 0, "stated values are an Advanced tool");
  assert.equal(await panel.locator(".computed .ovr").count(), 0);
});
await step("the More menu holds saving, loading and starting over, and closes with Escape or a click outside", async () => {
  await more.click();
  const menu = panel.getByRole("dialog", { name: "More patient options" });
  for (const b of ["Save this patient", "Start over"]) assert.ok(await menu.getByRole("button", { name: b, exact: true }).isVisible(), b);
  assert.ok(await menu.getByLabel("Load an example").isVisible(), "examples");
  await page.keyboard.press("Escape");
  assert.equal(await menu.count(), 0);
  await more.click();
  await panel.locator(".fgroup.deciders legend").click();
  assert.equal(await menu.count(), 0);
});
await step("paste the record: details found, shown with their evidence, applied after review", async () => {
  await panel.getByText("Paste from the note").click();
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
  assert.match(await first.locator(".previews").first().innerText(), /Leads to: .+|doesn't change the result yet|no recommendation fits/);
  assert.doesNotMatch(await first.locator(".previews").first().innerText(), /route|settles nothing/);
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
  await fromMore("Save this patient");
  await panel.getByLabel("Name for this patient").fill("Test patient A");
  await panel.locator(".save-row button[type=submit]").click();
  await fromMore("Start over");
  assert.equal(await panel.locator(".chips-strip").count(), 0);
  await more.click();
  await panel.getByRole("button", { name: /Test patient A/ }).first().click();
  assert.match(await panel.locator(".chips-strip").innerText(), /cT: T1c/);
  assert.equal(await panel.getByRole("dialog", { name: "More patient options" }).count(), 0, "loading closes the menu");
});
await step("one question at a time: the next question, answered with a number key, Back undoes", async () => {
  await fromMore("Start over");
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
});
await step("the interview ends with the number of recommendations and a way to see them", async () => {
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  if (await panel.getByTestId("mode-interview").count()) await panel.getByTestId("mode-interview").click();
  // answer with the first choice until every question that changes the recommendation is asked
  for (let i = 0; i < 12 && !(await panel.locator(".interview.done").count()); i++) {
    const opt = panel.locator(".iv-options button").first();
    if (await opt.count()) await opt.click(); else await panel.getByRole("button", { name: /Don't know/ }).click();
    await page.waitForTimeout(150);
  }
  await panel.locator(".interview.done").waitFor();
  assert.match(await panel.locator(".interview.done").innerText(), /That's every question that changes the recommendation\.[\s\S]*possible recommendation/);
  await panel.getByRole("button", { name: "See the recommendation" }).click();
  assert.equal(await page.locator("#tab-paths").getAttribute("aria-selected"), "true");
  await page.locator("#tab-patient").click();
});
await step("where is the patient now: a later moment starts there, holds details that may have changed, and leads with the current situation", async () => {
  await page.goto(base + "#prostate/");
  await page.locator("[data-testid=card]").first().waitFor();
  await more.click();
  const over = panel.getByRole("button", { name: "Start over", exact: true });
  if (await over.isEnabled()) await over.click(); else await page.keyboard.press("Escape");
  // the full form for the checks below (the choice is remembered)
  if (await panel.getByTestId("mode-form").count()) await panel.getByTestId("mode-form").click();
  const moment = panel.getByTestId("moment");
  assert.equal(await moment.getByRole("button", { name: "Not sure" }).getAttribute("aria-pressed"), "true");
  // details at diagnosis: life expectancy describes the patient then; the T category is recorded at diagnosis
  await panel.getByText("Paste from the note").click();
  await panel.locator(".paste textarea").fill("64-year-old man, cT2a, Gleason 3+4, PSA 8 ng/mL, life expectancy 15 years.");
  await panel.getByRole("button", { name: "Find details" }).click();
  await panel.getByTestId("apply-found").click();
  await moment.getByRole("button", { name: "Recurrence or relapse" }).click();
  assert.match(await moment.innerText(), /Starting at [^\n]*\(PROS-8\)/);
  await page.locator("#tab-paths").click();
  await page.locator(".reco-card, .empty").first().waitFor();   // the start-from picker is an Advanced tool; the moment above already chose PROS-8
  await page.locator("#tab-patient").click();
  const carried = panel.getByTestId("carried");
  assert.match(await carried.innerText(), /Life Expectancy/);
  assert.doesNotMatch(await carried.innerText(), /T Category/, "a detail recorded at diagnosis stays as it is");
  assert.equal(await panel.locator(".chips-strip li.held").count(), 1);
  // the rest of the form: now, treatment so far, and the original diagnosis folded away
  await panel.locator(".more-details > summary").click();
  const heads = (await panel.locator(".more-details legend, .more-details > details > summary").allInnerTexts()).join(" | ");
  assert.match(heads, /CURRENT SITUATION[\s\S]*TREATMENT SO FAR[\s\S]*ORIGINAL DIAGNOSIS/i, heads);
  assert.match(await panel.locator(".scope-note").innerText(), /details that apply from .+ \(PROS-8\)/);
  const before = await panel.locator(".more-details .pf").count();
  await panel.getByTestId("show-all").click();
  assert.ok(await panel.locator(".more-details .pf").count() > before, "show all widens the form");
  await panel.getByTestId("show-all").click();
  // confirming releases the hold
  await carried.getByRole("button", { name: "Still true", exact: true }).click();
  assert.equal(await panel.getByTestId("carried").count(), 0);
  assert.equal(await panel.locator(".chips-strip li.held").count(), 0);
  // a later moment held again, then back to diagnosis: nothing is held
  await moment.getByRole("button", { name: "New diagnosis" }).click();
  await moment.getByRole("button", { name: "Advanced or metastatic" }).click();
  assert.equal(await panel.getByTestId("carried").count(), 1);
  await moment.getByRole("button", { name: "New diagnosis" }).click();
  assert.equal(await panel.getByTestId("carried").count(), 0);
  assert.match(await moment.innerText(), /Starting at .+ \(PROS-1\)/);
  // kept across a reload
  await moment.getByRole("button", { name: "Recurrence or relapse" }).click();
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  assert.match(await panel.getByTestId("moment").innerText(), /Starting at .+ \(PROS-8\)/);
  assert.equal(await panel.getByTestId("carried").count(), 1);
  await panel.getByTestId("moment").getByRole("button", { name: "Not sure" }).click();
});
await step("Advanced tools add the page choice, stated values and override links", async () => {
  await page.evaluate(() => localStorage.setItem("oc-advanced", "1"));
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  await panel.locator(".more-details > summary").click();
  assert.equal(await panel.locator(".more-details").getByText("Stated in the record").count(), 1);
  await page.evaluate(() => localStorage.removeItem("oc-advanced"));
});
await step("works across guidelines: multi-disease guideline asks the disease first", async () => {
  await page.goto(base + "#b_cell_lymphomas/");
  await page.locator("[data-testid=card]").first().waitFor();
  await page.locator("#fact-guideline_section").waitFor();
  await page.locator("#fact-guideline_section").selectOption({ index: 1 });
  await page.waitForFunction(() => document.querySelector(".fgroup.deciders legend")?.textContent?.includes("Questions that change the recommendation"));
});
await browser.close();
server.close();
assert.deepEqual(errors, [], "console errors: " + errors.join("; "));
console.log(`\nall ${n} form checks passed`);
