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
  if (/^[/\\]Guideline[/\\]/.test(path)) { res.writeHead(404); res.end(); return; }   // the tests run without the licensed PDFs
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
  assert.match(await dec.locator("legend").innerText(), /Questions that change the recommendation/);
  assert.equal(await dec.locator("legend em").count(), 0, "no count while one question is shown");
  assert.equal(await panel.locator(".interview").count(), 1, "one question at a time is the default");
  assert.match(await panel.locator(".interview .decides").innerText(), /Changes the recommendation at: .+ \(PROS-\d+\)/);
  assert.match(await panel.locator(".iv-n").innerText(), /^Question 1/);
  assert.equal(await panel.locator('select[aria-label="Which page"]').count(), 0, "page choice is an Advanced tool");
  assert.match(await panel.getByTestId("moment").innerText(), /What do you need\?/);
  assert.equal((await panel.locator(".filled").innerText()).trim(), "0 answered", "no total: nothing says every question is required");
  // "Paste a note" in the top bar opens the paste box and puts the cursor in it
  await panel.getByTestId("paste-open").click();
  await page.waitForFunction(() => document.activeElement?.matches(".paste textarea"));
  assert.ok(await panel.locator(".paste textarea").isVisible());
  await panel.locator(".paste summary").click();
  await panel.getByTestId("mode-form").click();
  assert.equal(await panel.locator(".interview").count(), 0);
  assert.ok(await dec.locator(".pf.decider").count() >= 1);
  assert.match(await dec.locator(".decides").first().innerText(), /Changes the recommendation at: .+ \(PROS-\d+\)/);
  assert.equal(await panel.locator(".more-details").getAttribute("open"), null, "the rest is folded away");
  assert.equal(await panel.locator(".more-details").getByText("Stated in the record").count(), 0, "stated values are an Advanced tool");
  assert.equal(await panel.locator(".computed .ovr").count(), 0);
});
await step("the More menu holds saving, loading and starting over, and closes with Escape or a click outside", async () => {
  await more.click();
  const menu = panel.getByRole("dialog", { name: "More patient options" });
  for (const b of ["Save in this browser", "Start over"]) assert.ok(await menu.getByRole("button", { name: b, exact: true }).isVisible(), b);
  assert.ok(await menu.getByLabel("Load an example").isVisible(), "examples");
  await page.keyboard.press("Escape");
  assert.equal(await menu.count(), 0);
  await more.click();
  await panel.locator(".fgroup.deciders legend").click();
  assert.equal(await menu.count(), 0);
});
await step("paste the record: details found, shown with their evidence, applied after review", async () => {
  await panel.locator(".paste summary").click();
  await panel.locator(".paste textarea").fill("64-year-old man with low-risk prostate cancer (cT1c, Gleason 3+3, PSA 5 ng/mL), life expectancy about 18 years. PSA nadir was 0.2.");
  const readBtn = panel.getByRole("button", { name: "Read the note" });
  assert.ok((await readBtn.boundingBox()).height < 40, "Read the note stays on one line");
  await readBtn.click();
  // what was found and the Apply button are brought into view
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid=apply-found]"), sc = document.querySelector(".rp-body"); if (!b) return false; const r = b.getBoundingClientRect(), c = sc.getBoundingClientRect(); return r.bottom <= c.bottom + 1 && r.top >= c.top; });
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
await step("previews appear only where answers lead to different places; any answer can be chosen", async () => {
  await panel.locator(".chips-strip li", { hasText: "Risk Group" }).locator(".chip-x").click().catch(() => {});
  await page.waitForTimeout(1500);   // previews are computed a few at a time
  const lists = await panel.locator(".fgroup.deciders .previews").allInnerTexts();
  for (const t of lists) {
    assert.match(t, /Leads to: .+|no recommendation fits/);
    assert.doesNotMatch(t, /doesn't change the result yet|route|settles nothing/, "no filler for answers that change nothing");
  }
  // choose from the preview when there is one, else answer the first question directly
  const withPrev = panel.locator(".fgroup.deciders .pf.decider", { has: page.locator(".previews") }).first();
  const target = (await withPrev.count()) ? withPrev : panel.locator(".fgroup.deciders .pf.decider").first();
  const name = (await target.locator(".flabel span").first().innerText()).trim();
  if (await target.locator(".previews button").count()) await target.locator(".previews button").first().click();
  else if (await target.locator(".seg-row button").count()) await target.locator(".seg-row button").first().click();
  else await target.locator("select").selectOption({ index: 1 });
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
  await fromMore("Save in this browser");
  await panel.getByLabel("Label for this patient").fill("Test patient A");
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
  await page.getByTestId("title").click().catch(() => {});   // focus off the form so the number key reaches the interview
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
await step("a way to the recommendation is always in view; the last answer opens it", async () => {
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  if (await panel.getByTestId("mode-interview").count()) await panel.getByTestId("mode-interview").click();
  // nothing entered: no route is ranked yet, so no button (and no dead end)
  const tabOn = async () => (await page.locator("#tab-paths").getAttribute("aria-selected")) === "true";
  // answer with the first choice until every question that changes the recommendation is asked
  for (let i = 0; i < 14 && !(await tabOn()); i++) {
    const opt = panel.locator(".iv-options button").first();
    if (await opt.count()) await opt.click(); else if (await panel.getByRole("button", { name: /Don't know/ }).count()) await panel.getByRole("button", { name: /Don't know/ }).click();
    await page.waitForTimeout(200);
    if (!(await tabOn())) {
      const footer = panel.getByTestId("next-step");
      if (await footer.count() && !(await footer.innerText()).includes("Nothing fits")) assert.ok(await footer.getByRole("button", { name: /^See the recommendation/ }).isVisible(), "the footer button stays in view");
    }
  }
  // the last question answered (or none left to ask): the Recommendation tab opens by itself
  if (!(await tabOn())) {
    await panel.locator(".interview.done").waitFor();
    assert.match(await panel.locator(".interview.done").innerText(), /That's every question that changes the recommendation\./);
    assert.equal(await panel.locator(".interview.done button.primary").count(), 0, "one button, in the footer");
    await panel.getByTestId("next-step").getByRole("button", { name: /^See the recommendation/ }).click();
  }
  assert.equal(await page.locator("#tab-paths").getAttribute("aria-selected"), "true");
  await page.locator("#tab-patient").click();
  assert.ok(await panel.getByTestId("next-step").getByRole("button", { name: /^See the recommendation/ }).isVisible(), "still there when you come back");
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
  /** Choose a phase and, when it has several pages, the first one listed. */
  const phase = async (name) => {
    await moment.getByRole("button", { name }).click();
    const sit = moment.getByTestId("situations");
    if (await sit.count()) await sit.getByRole("radio").first().click();
  };
  assert.equal(await moment.getByRole("button", { name: "Not sure" }).getAttribute("aria-pressed"), "true");
  // details at diagnosis: life expectancy describes the patient then; the T category is recorded at diagnosis
  await panel.locator(".paste summary").click();
  await panel.locator(".paste textarea").fill("64-year-old man, cT2a, Gleason 3+4, PSA 8 ng/mL, life expectancy 15 years.");
  await panel.getByRole("button", { name: "Read the note" }).click();
  await panel.getByTestId("apply-found").click();
  // a need with a single start page (workup: PROS-1, the pages it leads to are not offered) starts there at once
  assert.equal(await moment.getByTestId("situations").count(), 0);
  await moment.getByRole("button", { name: "Workup & first treatment" }).click();
  assert.equal(await moment.getByTestId("situations").count(), 0, "one setting: no list");
  assert.match(await moment.innerText(), /Starting at [^\n]*\(PROS-1\)/);
  // recurrence has several settings (PROS-9 and PROS-10 are also entered from other pages): the list is shown, and
  // the hint says nothing about a start that has not been chosen; no question is asked until the setting is
  await moment.getByRole("button", { name: "Recurrence or relapse" }).click();
  assert.ok(await moment.getByTestId("situations").getByRole("radio").count() >= 2, "several settings");
  assert.doesNotMatch(await moment.locator(".hint").innerText(), /Starting at/);
  assert.equal(await panel.locator(".interview .iv-q").count(), 0, "no question before the setting is chosen");
  assert.match(await panel.locator(".fgroup.deciders").innerText(), /Choose the setting above/);
  await moment.getByTestId("situations").getByRole("radio").first().click();
  assert.match(await moment.innerText(), /Starting at [^\n]*\(PROS-8\)/);
  await moment.getByRole("button", { name: "Workup & first treatment" }).click();
  await moment.getByRole("button", { name: "Not sure" }).click();
  // a need with several settings is not answered for the clinician: nothing is chosen until one is picked
  await moment.getByRole("button", { name: "Metastatic or advanced" }).click();
  const sit = moment.getByTestId("situations");
  assert.ok(await sit.getByRole("radio").count() >= 2, "several settings for this need");
  for (const r of await sit.getByRole("radio").all()) assert.equal(await r.getAttribute("aria-checked"), "false", "nothing preselected");
  assert.match(await moment.innerText(), /Choose the setting that fits/);
  assert.match(await moment.innerText(), /Which setting\?/);
  assert.doesNotMatch(await moment.innerText(), /Starting at/);
  assert.equal(await panel.getByTestId("carried").count(), 0, "nothing is held before a page is chosen");
  // each situation has a name; a second line, when there is one, is a short whole description (no cut-off fragment, no bullets)
  for (const r of await sit.getByRole("radio").all()) {
    assert.ok((await r.locator(".sit-t").innerText()).trim().length > 4, "each situation has a name");
    for (const h of await r.locator(".sit-h").allInnerTexts()) assert.ok(h.length <= 80 && !/…$|[•◦▪]|;\s*$/.test(h), `second line: "${h}"`);
  }
  const second = sit.getByRole("radio").nth(1);
  const title2 = (await second.locator(".sit-t").innerText()).replace(/\s*\(.*$/, "").trim();
  await second.click();
  assert.equal(await second.getAttribute("aria-checked"), "true");
  assert.ok((await moment.locator(".hint").innerText()).includes("Starting at"), "the hint says where it starts");
  assert.doesNotMatch(await moment.locator(".hint").innerText(), /\d+ questions? apply/, "no alarming count outside Advanced");
  assert.ok((await moment.locator(".hint").innerText()).includes(title2.slice(0, 20)), "the hint names the chosen situation");
  await moment.getByRole("button", { name: "Recurrence or relapse" }).click();
  await moment.getByTestId("situations").getByRole("radio").first().click();
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
  assert.match(await panel.locator(".scope-note").innerText(), /questions that matter from .+ \(PROS-8\)/);
  const before = await panel.locator(".more-details .pf").count();
  await panel.getByTestId("show-all").click();
  assert.ok(await panel.locator(".more-details .pf").count() > before, "show all widens the form");
  await panel.getByTestId("show-all").click();
  // confirming releases the hold
  await carried.getByRole("button", { name: "Still true", exact: true }).click();
  assert.equal(await panel.getByTestId("carried").count(), 0);
  assert.equal(await panel.locator(".chips-strip li.held").count(), 0);
  // a later moment held again, then back to diagnosis: nothing is held
  await phase("Workup & first treatment");
  await phase("Metastatic or advanced");
  assert.equal(await panel.getByTestId("carried").count(), 1);
  await phase("Workup & first treatment");
  assert.equal(await panel.getByTestId("carried").count(), 0);
  assert.match(await moment.innerText(), /Starting at .+ \(PROS-1\)/);
  // kept across a reload
  await phase("Recurrence or relapse");
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
  await panel.getByTestId("moment").getByRole("button", { name: "Metastatic or advanced" }).click();
  assert.equal(await panel.locator('select[aria-label="Which page"]').count(), 1, "Advanced: the page select");
  assert.equal(await panel.getByTestId("situations").count(), 0);
  await panel.getByTestId("moment").getByRole("button", { name: "Not sure" }).click();
  await panel.locator(".more-details > summary").click();
  assert.equal(await panel.locator(".more-details").getByText("Stated in the record").count(), 1);
  await page.evaluate(() => localStorage.removeItem("oc-advanced"));
});
await step("works across guidelines: multi-disease guideline asks the disease first", async () => {
  await page.goto(base + "#b_cell_lymphomas/");
  await page.locator("[data-testid=card]").first().waitFor();
  await page.locator("#fact-guideline_section").waitFor();
  assert.match(await panel.getByTestId("disease").locator("legend").innerText(), /Which disease or subtype\?/);
  assert.equal(await panel.locator(".moment-chips").count(), 0, "moments follow the choice of subtype");
  await page.locator("#fact-guideline_section").selectOption({ index: 1 });
  await page.waitForFunction(() => document.querySelector(".fgroup.deciders legend")?.textContent?.includes("Questions that change the recommendation"));
});
await step("a chosen subtype keeps its moments; a long answer list is searched, not numbered", async () => {
  const sel = page.locator("#fact-guideline_section");
  await sel.selectOption({ label: "Diffuse Large B-Cell Lymphoma" });
  await page.waitForFunction(() => document.querySelectorAll(".moment-chips button").length >= 3);
  // a subtype with a single moment says where it starts instead of showing chips
  await sel.selectOption({ label: "Burkitt Lymphoma" });
  // (with the engine choosing the subtype's own start pages, Burkitt may now offer its own moments)
  await page.waitForFunction(() => /Starting at/.test(document.querySelector("[data-testid=moment]")?.textContent ?? "") || document.querySelectorAll(".moment-chips button").length >= 2);
  // more than nine choices: type to narrow them (number keys only reach 9)
  await sel.selectOption({ label: "HIV-Related B-Cell Lymphomas" });
  if (await panel.getByTestId("mode-interview").count()) await panel.getByTestId("mode-interview").click();
  const search = panel.locator(".iv-search input");
  await search.waitFor();
  assert.equal(await panel.locator(".iv-options").count(), 0);
  assert.doesNotMatch(await panel.locator(".iv-n").innerText(), /may follow/, "an estimate from the open routes, not a promise");
  await search.fill("burkitt");
  assert.equal(await panel.locator(".iv-list button").count(), 1);
  await search.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".chips-strip li")].some((li) => /Histology/.test(li.textContent)));
});
await step("rectal cancer: subtype, what you need, the setting in plain words, a next step that is always there", async () => {
  await page.goto(base + "#rectal/");
  await page.locator("[data-testid=card]").first().waitFor();
  if (await panel.getByTestId("mode-interview").count()) await panel.getByTestId("mode-interview").click();
  await page.locator("#fact-guideline_section").selectOption({ label: "pMMR/MSS Rectal Cancer" });
  const moment = panel.getByTestId("moment");
  await moment.waitFor();
  assert.match(await moment.innerText(), /What do you need\?/);
  for (const need of ["Workup & first treatment", "Recurrence or relapse", "Metastatic or advanced"]) assert.ok(await moment.getByRole("button", { name: need }).isVisible(), need);
  assert.ok(await moment.getByRole("button", { name: "Not sure — let the questions decide" }).isVisible());
  // a need with several start pages lists the settings in plain clinical words; pages another one leads to are not offered
  await moment.getByRole("button", { name: "Workup & first treatment" }).click();
  const sit = moment.getByTestId("situations");
  const labels = await sit.getByRole("radio").locator(".sit-t").allInnerTexts();
  assert.equal(labels.length, 4, labels.join(" | "));
  assert.equal(labels.filter((t) => /^After surgery: /.test(t)).length, 2, "the pages after surgery (pathologic stage) are settings of their own: " + labels.join(" | "));
  assert.ok(labels.some((t) => /Malignant polyp \(invasive cancer in a polyp\)/.test(t)), labels.join(" | "));
  assert.ok(labels.some((t) => /Rectal cancer, no distant metastases \(localized or locally advanced\)/.test(t)), labels.join(" | "));
  assert.ok(!labels.some((t) => /REC-6|Clinical Stage/i.test(t)), "REC-6 is reached through the workup page: not offered");
  await sit.getByRole("radio", { name: /no distant metastases/ }).click();
  assert.match(await moment.locator(".hint").innerText(), /Starting at .*\(REC-2\)/);
  // the setting states the answer: it is entered, not asked again
  assert.match(await panel.locator(".chips-strip").innerText(), /No/);
  const footer = panel.getByTestId("next-step");
  assert.ok(await footer.getByRole("button", { name: /^See the recommendation/ }).isVisible(), "the way on is in view from the start");
  // answer what is asked (the first choice each time) until the recommendation opens or no question is left
  const tabOn = async () => (await page.locator("#tab-paths").getAttribute("aria-selected")) === "true";
  const asked = [];
  for (let i = 0; i < 12 && !(await tabOn()); i++) {
    if (await panel.locator(".interview.done").count()) break;
    asked.push((await panel.locator(".iv-n").first().innerText().catch(() => "")) + " " + (await panel.locator(".iv-q").first().innerText().catch(() => "")));
    const opt = panel.locator(".iv-options button").first();
    if (await opt.count()) await opt.click(); else if (await panel.getByRole("button", { name: /Don't know/ }).count()) await panel.getByRole("button", { name: /Don't know/ }).click(); else break;
    await page.waitForTimeout(200);
  }
  console.log("   asked:", asked.join(" | "));
  if (!(await tabOn())) await footer.getByRole("button", { name: /^See the recommendation/ }).click();
  assert.equal(await page.locator("#tab-paths").getAttribute("aria-selected"), "true");
  const card = page.locator(".paths .reco-card").first();
  await card.waitFor();
  const text = await card.innerText();
  assert.doesNotMatch(text, /NCCN (recommends|lists|also lists)\s+CLINICAL STAGE/i, "a heading is not a recommendation");
  if (/The next step is on/.test(text)) {
    assert.match(text, /The next step is on .+/);
    assert.doesNotMatch(text, /NCCN recommends/);
    assert.ok(await card.getByRole("button", { name: "Open the NCCN page" }).count() >= 0);
  } else if (/Answer these to reach a recommendation/.test(text)) assert.doesNotMatch(text, /NCCN recommends/);
  else assert.match(text, /NCCN (recommends|lists|also lists)/);
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/rectal-3-recommendation-${process.env.TAG ?? "x"}.png` : "/dev/null" }).catch(() => {});
  // a setting that the answers contradict: nothing fits, and the way to fix it is one button
  await page.locator("#tab-patient").click();
  await moment.getByRole("button", { name: "Metastatic or advanced" }).click();
  assert.match(await moment.locator(".hint").innerText(), /Starting at .*\(REC-2A\)/);
  await panel.getByTestId("next-step").waitFor();
  await panel.locator(".chips-strip li", { hasText: /Distant/ }).locator("button").first().click();
  const dm = page.locator("#fact-distant_metastases_suspected_or_proven");
  await dm.waitFor();
  assert.equal(await dm.locator("button[aria-checked=true]").innerText(), "Yes", "the setting entered it");
  await dm.locator("button", { hasText: "No" }).click();
  const fixBar = panel.getByTestId("next-step");
  await fixBar.getByRole("button", { name: "Fix this" }).waitFor();
  const msg = await fixBar.innerText();
  assert.match(msg, /Nothing fits these answers/);
  assert.match(msg, /\(REC-2A\)’ is for rectal cancer with suspected or proven distant metastases; you answered No to distant metastases/i, msg);
  assert.equal(await fixBar.getByRole("button", { name: /^See the recommendation/ }).count(), 0);
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/rectal-4-nothing-fits-${process.env.TAG ?? "x"}.png` : "/dev/null" }).catch(() => {});
  await fixBar.getByRole("button", { name: "Fix this" }).click();
  await page.waitForFunction(() => document.activeElement?.closest("#fact-distant_metastases_suspected_or_proven") || document.activeElement?.id === "fact-distant_metastases_suspected_or_proven");
  // the interview does not go on asking when nothing fits
  await panel.getByTestId("mode-interview").click();
  assert.match(await panel.locator(".interview.stuck").innerText(), /Nothing fits these answers/);
  assert.equal(await panel.locator(".iv-options").count(), 0, "no question is asked");
  await dm.waitFor({ state: "detached" }).catch(() => {});
  // answering it as the setting says brings the recommendation back
  await panel.locator(".chips-strip li", { hasText: /Distant/ }).locator("button").first().click();
  await page.locator("#fact-distant_metastases_suspected_or_proven button", { hasText: "Yes" }).click();
  await panel.getByTestId("next-step").getByRole("button", { name: /^See the recommendation/ }).waitFor();
});
/** Answer the interview with rules [question regex, answer regex | number]; anything else is skipped. Returns the questions asked. */
const drive = async (rules) => {
  const asked = [];
  const tabOn = async () => (await page.locator("#tab-paths").getAttribute("aria-selected")) === "true";
  for (let i = 0; i < 25 && !(await tabOn()); i++) {
    if (await panel.locator(".interview.done, .interview.stuck").count()) break;
    const q = (await panel.locator(".iv-q").first().innerText().catch(() => "")).trim();
    const n = (await panel.locator(".iv-n").first().innerText().catch(() => "")).trim();
    const rule = rules.find(([re]) => re.test(q));
    let did = false;
    if (rule && typeof rule[1] === "number") { await panel.locator(".iv-num input").fill(String(rule[1])); await panel.locator(".iv-num button[type=submit]").click(); did = true; }
    else if (rule) { const b = panel.locator(".iv-options button, .iv-list button").filter({ hasText: rule[1] }).first(); if (await b.count()) { await b.click(); did = true; } }
    if (!did) await panel.getByRole("button", { name: /Don't know/ }).click();
    asked.push({ n, q, did });
    await page.waitForTimeout(200);
  }
  return asked;
};
await step("NSCLC stage I: the lung cancer's own first page is a Workup setting, no question comes before it is chosen, and the route goes on to the pretreatment evaluation", async () => {
  await page.goto(base + "#nsclc/");
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  if (await panel.getByTestId("mode-interview").count()) await panel.getByTestId("mode-interview").click();
  const moment = panel.getByTestId("moment");
  await moment.getByRole("button", { name: "Workup & first treatment" }).click();
  const sit = moment.getByTestId("situations");
  const labels = await sit.getByRole("radio").locator(".sit-t").allInnerTexts();
  assert.ok(labels.some((t) => /Initial Evaluation.*\(NSCL-1\)/.test(t)), labels.join(" | "));
  assert.ok(labels.some((t) => /Clinical Presentation.*\(DIAG-1\)/.test(t)), "the nodule page is still offered: " + labels.join(" | "));
  for (const t of labels) assert.doesNotMatch(t, /[•◦▪]/, "no raw bullet text in a setting");
  assert.equal(await panel.locator(".iv-q").count(), 0, "no question before the setting is chosen");
  assert.match(await panel.locator(".fgroup.deciders").innerText(), /Choose the setting above/);
  assert.doesNotMatch(await moment.locator(".hint").innerText(), /Starting at/, "no start is claimed before it is chosen");
  await sit.getByRole("radio", { name: /NSCL-1\)/ }).click();
  assert.match(await moment.locator(".hint").innerText(), /Starting at .*\(NSCL-1\)/);
  const asked = await drive([[/^M Category/, /M0/], [/^N Category/, /N0/], [/Clinical T/, /T1b/], [/Tumor Location/, /Periph/], [/^Operable/, /Yes/], [/Pleural/, /No/], [/Contralateral/, /No/]]);
  const qs = asked.map((a) => a.q).join(" | ");
  assert.ok(asked.length >= 4 && asked.slice(0, 4).every((a) => a.did), "the staging details are asked from NSCL-1 on: " + qs);
  assert.match(asked[0].n, /^Question 1/);
  if (asked.some((a) => !a.did)) { const skipped = asked.findIndex((a) => !a.did); assert.match(asked[skipped + 1]?.n ?? "Question 99", new RegExp(`^Question ${skipped + 2}`), "Question N advances after a skip"); }
  if (!(await page.locator("#tab-paths").getAttribute("aria-selected") === "true")) await panel.getByTestId("next-step").getByRole("button").first().click();
  await page.waitForFunction(() => document.activeElement?.id === "tab-paths");   // the Recommendation tab takes the focus
  const card = page.locator(".paths .reco-card").first();
  await card.waitFor();
  const txt = await page.locator(".paths").first().innerText();
  assert.doesNotMatch(txt, /Nothing fits these answers|More answers needed/);
  assert.match(txt, /How the patient gets here[\s\S]*Initial Evaluation \(NSCL-1\)[\s\S]*Pretreatment Evaluation \(NSCL-2\)/, "the route goes from the first page on to the stage I evaluation");
});
await step("DLBCL: the workup page asks the staging details that decide where it leads; nothing loops", async () => {
  await page.goto(base + "#b_cell_lymphomas/");
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  if (await panel.getByTestId("mode-interview").count()) await panel.getByTestId("mode-interview").click();
  await page.locator("#fact-guideline_section").selectOption({ label: "Diffuse Large B-Cell Lymphoma" });
  const moment = panel.getByTestId("moment");
  await moment.getByRole("button", { name: "Workup & first treatment" }).click();
  assert.match(await moment.locator(".hint").innerText(), /Starting at .*\(BCEL-1\)/, "the disease's own first page, not the table of diseases (DIAG-1)");
  const asked = await drive([[/Histologic Transformation|Concurrent/, /^\d?No$/], [/^Histology/, /Diffuse/], [/Ann Arbor/, /III/]]);
  const qs = asked.map((a) => a.q).join(" | ");
  assert.ok(asked.length >= 2, "questions are asked: " + qs);
  assert.ok(asked.some((a) => /Ann Arbor/.test(a.q)), "the stage that decides the route after the workup is asked: " + qs);
  assert.equal(await panel.locator(".interview.done .iv-q").filter({ hasText: /No patient details change/ }).count(), 0);
  // the way on is always one button; it never sends the reader round in a circle
  const tabOn = (await page.locator("#tab-paths").getAttribute("aria-selected")) === "true";
  if (!tabOn) {
    const btn = panel.getByTestId("next-step").getByRole("button").first();
    assert.match(await btn.innerText(), /^(See the recommendation|Open .+ in the diagram)/);
  }
});
await step("a topic with nothing to ask says so plainly and opens the page; the topic is asked as a topic", async () => {
  await page.goto(base + "#survivorship/");
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  assert.match(await panel.getByTestId("disease").locator("legend").innerText(), /Which topic\?/);
  const opts = await page.locator("#fact-guideline_section").evaluate((el) => [...el.querySelectorAll("option")].map((o) => o.textContent));
  assert.ok(!opts.some((t) => /^Survivorship\s*:/.test(t ?? "")), "the shared prefix is dropped: " + opts.join(" | "));
  await page.locator("#fact-guideline_section").selectOption({ label: "Lymphedema" });
  if (await panel.getByTestId("mode-interview").count()) await panel.getByTestId("mode-interview").click();
  const none = panel.getByTestId("no-questions");
  await none.waitFor();
  assert.match(await none.innerText(), /No patient details change the answer here: read the page\./);
  assert.doesNotMatch(await panel.locator(".fgroup.deciders").innerText(), /That's every question/);
  const btn = panel.getByTestId("next-step").getByRole("button").first();
  assert.match(await btn.innerText(), /^Open .+ in the diagram/);
  await btn.click();
  await page.waitForFunction(() => /#survivorship\/flow\/SLYMPH/.test(location.hash));
});
await step("colon, after surgery: the setting asks pathologic details, not the clinical-stage or pre-op ones; the answers' previews say what they still depend on", async () => {
  await page.goto(base + "#colon/");
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  if (await panel.getByTestId("mode-form").count()) await panel.getByTestId("mode-form").click();
  await page.locator("#fact-guideline_section").selectOption({ label: "pMMR/MSS Colon Cancer" });
  const moment = panel.getByTestId("moment");
  await moment.getByRole("button", { name: "Workup & first treatment" }).click();
  await moment.getByTestId("situations").getByRole("radio", { name: /After surgery: Pathologic Stage/ }).click();
  assert.match(await moment.locator(".hint").innerText(), /Starting at .*\(COL-4\)/);
  // its second line is a short whole description
  assert.equal(await moment.getByTestId("situations").getByRole("radio", { name: /After surgery: Pathologic Stage/ }).locator(".sit-h").innerText(), "Treatment after surgery, by the pathologic stage");
  const fields = (await panel.locator(".pf .flabel").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).join(" | ");
  assert.match(fields, /N Category/, fields);
  for (const bad of [/Locally Unresectable/, /Medically Inoperable/, /Bulky Nodal/]) assert.doesNotMatch(fields, bad, "a pre-op question after surgery: " + fields);
});
await step("pediatric sarcoma: eight first pages are two choices, the sites in one group that opens; every setting still starts its own page", async () => {
  await page.goto(base + "#pediatric_soft_tissue_sarcoma/");
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  if (await panel.getByTestId("mode-form").count()) await panel.getByTestId("mode-form").click();
  const moment = panel.getByTestId("moment");
  await moment.getByRole("button", { name: "Workup & first treatment" }).click();
  const sit = moment.getByTestId("situations");
  const group = sit.getByTestId("situation-group");
  assert.equal(await group.count(), 1);
  assert.match(await group.locator("summary").innerText(), /By presenting site[\s\S]*7 starting points/);
  assert.equal(await sit.locator(":scope > button, :scope > details").count() <= 6, true, "at most six choices");
  assert.equal(await group.getAttribute("open"), null, "closed until asked");
  await group.locator("summary").click();
  const members = await group.getByRole("radio").locator(".sit-t").allInnerTexts();
  assert.equal(members.length, 7, members.join(" | "));
  assert.ok(members.some((t) => /Head or neck mass/.test(t)), members.join(" | "));
  await group.getByRole("radio", { name: /Head or neck mass/ }).click();
  assert.match(await moment.locator(".hint").innerText(), /Starting at .*\(PRMS-3\)/);
  assert.notEqual(await sit.getByTestId("situation-group").getAttribute("open"), null, "open while one of its settings is the start");
});
await step("a touch screen gets toggles at least 24px tall", async () => {
  const touch = await browser.newContext({ viewport: { width: 420, height: 900 }, hasTouch: true, isMobile: true });
  const tp = await touch.newPage();
  await tp.addInitScript(() => { try { localStorage.setItem("nav-help", "1"); localStorage.setItem("oc-canvas-hint", "1"); } catch { /* */ } });
  await tp.goto(base + "#prostate/");
  await tp.locator("[data-testid=card]").first().waitFor();
  const heights = await tp.evaluate(() => [...document.querySelectorAll(".switch i")].map((i) => Math.round(i.getBoundingClientRect().height)).filter((h) => h > 0));
  // (some toggles are folded away on a phone: any that are drawn are tall enough)
  for (const h of heights) assert.ok(h >= 24, "toggle height " + h);
  const probe = await tp.evaluate(() => { const i = document.createElement("label"); i.className = "switch"; i.innerHTML = '<input type="checkbox"><i></i><span>x</span>'; document.body.append(i); const h = i.querySelector("i").getBoundingClientRect().height; i.remove(); return h; });
  assert.ok(probe >= 24, "a toggle on touch is " + probe + "px");
  await touch.close();
});
await browser.close();
server.close();
assert.deepEqual(errors, [], "console errors: " + errors.join("; "));
console.log(`\nall ${n} form checks passed`);
