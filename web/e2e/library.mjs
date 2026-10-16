// Library smoke test: serves the repository over http and drives built/oncocarta.html.
//   node e2e/library.mjs            (from web/, after `python -m nccn_nav.dashboard --library`)
import { chromium } from "playwright-core";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });   // optional examples.json 404s
let n = 0;
const step = async (name, fn) => { await fn(); console.log(`ok ${++n} ${name}`); };
const closeWelcome = async () => { if (await page.getByRole("dialog", { name: /Find where a patient sits/ }).count()) await page.getByRole("button", { name: /Read the guideline/ }).click(); };

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
const recoTab = () => page.getByRole("tab", { name: /Pathways|Recommendation/ }).click();
await step("an example patient gets one recommendation to verify on the NCCN page", async () => {
  await page.getByTestId("patient-more").click();
  await page.locator('select[aria-label="Load an example"]').selectOption("V1");
  await recoTab();
  const card = page.locator(".reco-card");
  await card.waitFor();
  const text = await card.innerText();
  assert.match(text, /Best match|Also possible|One of \d+ possible recommendations|Possible starting point|Where the guideline starts for this patient/);
  // the support line is honest: "Matches your answers" only when answers were used and none are missing
  if (/Possible starting point/.test(text)) assert.match(text, /Not based on your answers yet/);
  else assert.doesNotMatch(text, /Not based on your answers yet/);
  assert.match(text, /NCCN (recommends|also lists|lists)/i);
  assert.doesNotMatch(text, /Matches your answers[\s\S]*Less likely|Less likely[\s\S]*Matches your answers/);
  if (/Notes \(/.test(text)) assert.match(text, /Notes \(\d+\)/);
  assert.doesNotMatch(await page.locator(".paths").innerText(), /imagingg|CSPCh\b|ADTaa/, "no footnote letters glued to words");
  assert.equal(await card.getByRole("button", { name: "Verify on the NCCN page" }).getAttribute("title"), "Opens the NCCN page in a new window");
  assert.equal(await card.getByRole("button", { name: /Show this page in the diagram/ }).count(), 1);
  assert.equal(await page.getByRole("button", { name: /other possible recommendations? below/ }).count(), 1);
  // alternatives never claim "Matches your answers": that is the top card's phrase
  assert.doesNotMatch(await page.locator(".rc-others").innerText(), /Matches your answers/);
  assert.match(text, /Why/i);
  assert.match(text, /Research prototype/i);
  assert.match(text, /Shown on[\s\S]*NCCN page, PDF p\.\d+/i);
  assert.equal(await card.locator(".reco-box a, .reco-box button").count(), 0, "the headline is plain text, not a link");
  assert.doesNotMatch(await page.locator(".paths").innerText(), /possible recommendations? for this patient/, "the count lives in the other-recommendations heading");
  assert.match(await page.locator(".rc-others h3").innerText(), /^Other possible recommendations \(\d+\)/);
  const more = card.getByRole("button", { name: /^Show all \d+$/ });
  if (await more.count()) assert.ok((await more.boundingBox()).height >= 32, "Show all is a 32px target");
  assert.equal(await card.getByRole("button", { name: "Verify on the NCCN page" }).count(), 1);
  assert.equal(await card.getByRole("button", { name: /Summary to copy or print/ }).count(), 1);
  // the reviewer views stay behind Advanced tools
  for (const sel of [".scores", ".trail", "#start", ".nudge"]) assert.equal(await page.locator(sel).count(), 0, `${sel} is Advanced-only`);
  assert.doesNotMatch(await page.locator(".paths").innerText(), /extraction|judgment call|arms ruled out|routes fit/i);
});
await step("Verify on the NCCN page opens the recommended box's page in its own window", async () => {
  const [win] = await Promise.all([page.context().waitForEvent("page"), page.locator(".reco-card").getByRole("button", { name: "Verify on the NCCN page" }).click()]);
  await win.locator(".viewer-bar").waitFor();
  await win.getByRole("button", { name: "Close page viewer" }).click();
  await page.waitForTimeout(300);
  assert.ok(win.isClosed(), "Close shuts the window");
});
await step("Advanced tools show the scores, the full trail and the start-from picker", async () => {
  await page.evaluate(() => localStorage.setItem("oc-advanced", "1"));
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  await closeWelcome();
  await recoTab();
  assert.match(await page.locator(".pcard").first().innerText(), /Most likely/);
  assert.match(await page.locator(".reco").innerText(), /Recommended at this point/i);
  assert.match(await page.locator(".scores").innerText(), /Most likely/);
  assert.match(await page.locator(".trail").innerText(), /Matches treatment received/);
  assert.ok(await page.locator("#start option").count() > 1, "start-from picker");
  await page.evaluate(() => localStorage.removeItem("oc-advanced"));
});
await step("multi-disease guidelines ask for the disease first", async () => {
  await page.goto(base + "#aml/");
  await page.locator("[data-testid=card]").first().waitFor();
  await closeWelcome();
  await recoTab();
  assert.match(await page.locator(".empty").innerText(), /Answer a few questions to see the recommendation/);
  await page.locator(".empty").getByRole("button").click();
  await page.locator("#fact-guideline_section").waitFor();
  await page.locator("#fact-guideline_section").selectOption({ index: 1 });
  await recoTab();
  assert.ok(await page.locator(".reco-card").count() === 1, "one recommendation card");
  const eyebrow = await page.locator(".reco-card .rc-match").innerText();
  assert.doesNotMatch(eyebrow, /^Best match$/, "no 'Best match' without answers");
  if (/Possible starting point/.test(eyebrow)) {
    assert.match(await page.locator(".reco-card").innerText(), /Not based on your answers yet/);
    assert.equal(await page.locator(".reco-card").getByRole("button", { name: /patient questions/ }).count(), 1);
  }
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
  const [win] = await Promise.all([page.context().waitForEvent("page"), card.click({ position: { x: 10, y: 10 } })]);
  await win.locator(".viewer-bar", { hasText: "PROS-2" }).waitFor();
  await win.getByRole("button", { name: "Close page viewer" }).click();
  await page.waitForTimeout(300);
  assert.ok(win.isClosed(), "Close shuts the window");
});
await step("a page opens fitted to its width (never below 55%), and the reading size is one click away", async () => {
  await page.goto(base + "#prostate/flow/PROS-3");
  await closeWelcome();
  await page.locator(".canvas [data-testid=card]:visible").first().waitFor();
  await page.waitForTimeout(400);
  const zoom = () => page.evaluate(() => { const m = /matrix\(([^,]+)/.exec(getComputedStyle(document.querySelector(".canvas .plane").parentElement).transform); return m ? Number(m[1]) : 1; });
  const fitted = await zoom();
  assert.ok(fitted >= 0.55 - 0.01 && fitted <= 1.001, `opened at ${fitted}`);
  const inView = () => page.evaluate(() => { const c = document.querySelector(".canvas").getBoundingClientRect(); return [...document.querySelectorAll(".canvas .plane [data-testid=card]")].filter((e) => { const r = e.getBoundingClientRect(); return r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom; }).length; });
  const opened = await inView();
  await page.getByRole("button", { name: "Back to reading size" }).click();
  await page.waitForTimeout(200);
  const reading = await zoom();
  assert.ok(reading >= fitted - 0.001, `reading size ${reading} is not smaller than the fitted ${fitted}`);
  if (fitted < reading - 0.05) assert.ok(opened >= await inView(), "fitting shows at least as many cards as the reading size");
});
if (process.argv.includes("--all")) {
  // Every guideline: opens, renders its first algorithm page, the patient form and the pathways tab.
  const slugs = JSON.parse(await readFile(join(ROOT, "data/index.json"), "utf8")).guidelines.map((g) => g.slug);
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem("oc-advanced", "1"); } catch { /* blocked */ } });   // the start-from picker is an Advanced tool
  const fails = [];
  await p.addInitScript(() => { try { localStorage.setItem("oc-form-mode", "form"); } catch { /* */ } });   // the full form lists every field
  for (const slug of slugs.filter((s) => !process.env.SLUGS || process.env.SLUGS.split(",").includes(s))) {
    const errs = [];
    const onErr = (e) => errs.push(String(e.message ?? e));
    p.on("pageerror", onErr);
    try {
      await p.goto(`${base}#${slug}/`);
      await p.locator("[data-testid=card]").first().waitFor({ timeout: 15000 });
      if (await p.getByRole("dialog", { name: /Find where a patient sits/ }).count()) await p.getByRole("button", { name: /Find a recommendation for a patient/ }).click();
      await p.getByRole("tab", { name: "Patient" }).click();
      const labels = await p.locator(".patient .flabel > span:first-child").allTextContents();
      const lower = labels.filter((l) => /\b(Ecog|Psa|Mri|Pet|Hiv|Covid|Ldh|Egfr|Her2)\b/.test(l) || /_/.test(l));
      if (lower.length) errs.push("labels: " + lower.slice(0, 3).join(", "));
      if (!labels.length) errs.push("no patient fields");
      await p.getByRole("tab", { name: /Pathways|Recommendation/ }).click();
      const start = p.locator("#start");
      const opts = await start.locator("option").count();
      if (opts > 1) { await start.selectOption({ index: 1 }); await p.locator(".pcard, .reco-card, .empty").first().waitFor({ timeout: 10000 }); }
    } catch (e) { errs.push(String(e.message ?? e).split("\n")[0]); }
    p.off("pageerror", onErr);
    if (errs.length) fails.push(`${slug}: ${errs.join("; ")}`);
  }
  console.log(`ok ${++n} all ${slugs.length} guidelines open, list patient details and rank pathways${fails.length ? "" : " without errors"}`);
  assert.deepEqual(fails, [], fails.join("\n"));

  // The clinician's path through every guideline: open, find a recommendation, say what is needed
  // (the first need and setting), and always see the way on; the Recommendation tab then shows a
  // recommendation, an honest next step on another page, or what to answer: never a heading as
  // "NCCN recommends", never a dead end without a button.
  const sw = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const states = {};
  const slugState = {};
  const bad = [];
  for (const slug of slugs.filter((s) => !process.env.SLUGS || process.env.SLUGS.split(",").includes(s))) {
    const errs = [];
    const onErr = (e) => errs.push(String(e.message ?? e));
    sw.on("pageerror", onErr);
    try {
      await sw.goto(`${base}#${slug}/`);
      await sw.locator("[data-testid=card]").first().waitFor({ timeout: 15000 });
      if (await sw.getByRole("dialog", { name: /Find where a patient sits/ }).count()) await sw.getByRole("button", { name: /Find a recommendation for a patient/ }).click();
      await sw.getByRole("tab", { name: "Patient" }).click();
      // a guideline of several diseases: the first one
      const dis = sw.getByTestId("disease");
      if (await dis.count()) {
        if (await dis.locator("select").count()) await dis.locator("select").selectOption({ index: 1 });
        else await dis.locator("[role=radio]").first().click();
      }
      const moment = sw.getByTestId("moment");
      if (await moment.count()) {
        const chips = moment.locator(".moment-chips button");
        if (await chips.count() > 1) await chips.nth(1).click();
        const sit = moment.getByTestId("situations");
        if (await sit.count()) await sit.getByRole("radio").first().click();
      }
      const footer = sw.getByTestId("next-step");
      // no need to choose (or nothing ranked yet): answer the first question
      for (let i = 0; i < 3 && !(await footer.count()); i++) {
        const opt = sw.locator(".rp-body .iv-options button").first();
        if (await opt.count()) await opt.click(); else if (await sw.getByRole("button", { name: /Don't know/ }).count()) await sw.getByRole("button", { name: /Don't know/ }).click(); else break;
        await sw.waitForTimeout(150);
      }
      let state;
      if (await sw.getByRole("tab", { name: /Recommendation/ }).getAttribute("aria-selected") !== "true") {
        await footer.waitFor({ timeout: 5000 });
        const see = footer.getByRole("button", { name: /^See the recommendation/ }), fix = footer.getByRole("button", { name: "Fix this" });
        assert.ok((await see.count()) + (await fix.count()) === 1, "the footer offers See the recommendation or Fix this");
        if (await see.count()) await see.click(); else await sw.getByRole("tab", { name: /Recommendation/ }).click();
      }
      const paths = sw.locator(".paths");
      await paths.locator(".reco-card, .empty, .needs").first().waitFor({ timeout: 8000 });
      const text = await paths.innerText();
      const card = paths.locator(".reco-card").first();
      if (await paths.locator(".continues").count()) { state = "next step on another page"; assert.match(text, /The next step is on .+/); assert.doesNotMatch(text, /NCCN (recommends|lists|also lists)/i); }
      else if (await paths.locator(".needs").count()) { state = "answer these"; assert.match(text, /Answer these to reach a recommendation/); assert.doesNotMatch(text, /NCCN (recommends|lists|also lists)/i); }
      else if (await paths.locator(".empty").count()) { state = "nothing fits"; assert.ok(await paths.locator(".empty button").count() >= 1, "a way back from the dead end"); }
      else {
        state = "recommendation";
        const box = (await card.locator(".reco-box").innerText()).replace(/\s+/g, " ").trim();
        assert.ok(box.length > 3, "the recommendation has text");
        assert.ok(!/^[A-Z0-9 \-/,&.:'’()]+$/.test(box) && !/^[A-Z]{2,8}-\d+[A-Z]?(\s|$)/.test(box), `a heading or page reference is not a recommendation: "${box.slice(0, 60)}"`);
        assert.match(text, /NCCN (recommends|lists|also lists)/i);
      }
      states[state] = (states[state] ?? 0) + 1;
      slugState[slug] = state;
    } catch (e) { errs.push(String(e.message ?? e).split("\n")[0]); }
    sw.off("pageerror", onErr);
    if (errs.length) bad.push(`${slug}: ${errs.join("; ")}`);
  }
  console.log(`ok ${++n} the clinician's path ends in a way on in all ${slugs.length - bad.length} of ${slugs.length} guidelines: ${Object.entries(states).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  if (process.env.SWEEP_OUT) await writeFile(process.env.SWEEP_OUT, Object.entries(slugState).map(([k, v]) => `${k}\t${v}`).join("\n"));
  assert.deepEqual(bad, [], bad.join("\n"));
}
await browser.close();
server.close();
assert.deepEqual(errors, [], "console errors: " + errors.join("; "));
console.log(`\nall ${n} library checks passed`);
