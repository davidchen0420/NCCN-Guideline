// AI decision support, end to end: serves the repository over http with a MOCK of the local
// server's /api/decide/status and /api/decide (deterministic probabilities, no network, no key),
// and drives built/oncocarta.html.
//   node e2e/ai.mjs [screenshot-dir]   (from web/, after `python -m nccn_nav.dashboard --library`)
import { chromium } from "playwright-core";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHOTS = process.argv[2] ?? null;
if (SHOTS) await mkdir(SHOTS, { recursive: true });
const TYPES = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript" };

// ---------------------------------------------------------------- the mock server

/** What the mock answers; the test changes it between steps. */
const mock = {
  status: { enabled: true, model: "mock-model" },
  /** confident: the first option is sure; split: two options share the probability; none: "not enough information"; error: the server fails */
  mode: "confident",
  requests: [],
};

/** The probabilities for one request, by question name (n:<node> choice, o:<child> predicate). */
function answer(questions) {
  // option questions of one branch share the "Guideline step:" part of their instructions: the first of a branch is the likely one
  const seen = new Map();
  return questions.map((q) => {
    if (q.type === "choice") {
      const values = q.choices.map((c) => c.value);
      const real = values.filter((v) => v !== "none");
      const p = Object.fromEntries(values.map((v) => [v, 0.01]));
      if (mock.mode === "confident") p[real[0]] = 0.93;
      else if (mock.mode === "split") { p[real[0]] = 0.45; if (real[1]) p[real[1]] = 0.4; }
      else if (mock.mode === "none") p.none = 0.8;
      return { type: "choice", name: q.name, choice: Object.entries(p).sort((a, b) => b[1] - a[1])[0][0], confidence: 0.9, probabilities: values.map((v) => ({ value: v, probability: p[v] })) };
    }
    const step = /Guideline step: (.*?)\. Page:/s.exec(q.instructions)?.[1] ?? q.name;
    const first = !seen.has(step);
    seen.set(step, true);
    const probability = mock.mode === "confident" ? (first ? 0.93 : 0.05) : mock.mode === "split" ? (first ? 0.45 : 0.4) : 0.1;
    return { type: "predicate", name: q.name, probability };
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path === "/api/decide/status") {
    if (!mock.status) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(mock.status)); return;
  }
  if (path === "/api/decide" && req.method === "POST") {
    let raw = ""; for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    mock.requests.push(body);
    if (mock.mode === "error") { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "mock failure" })); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ answers: answer(body.questions) })); return;
  }
  if (/^[/\\]Guideline[/\\]/.test(path)) { res.writeHead(404); res.end(); return; }   // the tests run without the licensed PDFs
  try { const file = await readFile(join(ROOT, path)); res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }); res.end(file); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/built/oncocarta.html`;

// ---------------------------------------------------------------- the driver

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const errors = [];
let n = 0;
const step = async (name, fn) => { await fn(); console.log(`ok ${++n} ${name}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };

/** A fresh browser context (storage cleared) on the library page for one guideline, welcome screen closed. */
async function open(slug, { width = 1440, height = 900, scheme = "light", facts = null, hash = "flow" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|502/.test(m.text())) errors.push(m.text()); });
  await ctx.addInitScript(() => { try { sessionStorage.setItem("oc-intro", "1"); localStorage.setItem("nav-help", "1"); } catch { /* */ } });
  if (facts) await ctx.addInitScript(([k, v]) => { try { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, JSON.stringify({ facts: v, age: null })); } catch { /* */ } }, [`oc-patient:${slug}`, facts]);
  await page.goto(`${base}#${slug}/${hash}`);
  await page.locator("[data-testid=card]").first().waitFor();
  return page;
}
const settings = async (page) => { await page.getByTestId("rail-settings").click(); return page.getByRole("dialog", { name: "Settings" }); };
const closeSettings = (page) => page.keyboard.press("Escape");
const tab = (page, name) => page.getByRole("tab", { name }).click();
const loadExample = async (page, id) => {
  await page.getByTestId("rail-settings").waitFor();
  await tab(page, /Patient/);
  await page.getByTestId("patient-more").click();
  await page.locator('select[aria-label="Load an example"]').selectOption(id);
  await tab(page, /Pathways|Recommendation/);
  await page.locator(".reco-card, .empty").first().waitFor();
};
/** A prostate patient (a shipped example without the life expectancy) whose recommendation needs the AI at one branch. */
const PATIENT = { risk_group: "low", definitive_treatment_received: "radical_prostatectomy", psa_status: "persistence", psa_ng_ml: 0.3, n_category: "N0", m_category: "M0" };
const showReco = async (page) => { await tab(page, /Pathways|Recommendation/); await page.locator(".reco-card, .empty").first().waitFor(); };
const trailHead = (page) => page.locator("#rc-trail .tr-head");
const openTrail = async (page) => { await trailHead(page).waitFor(); if ((await trailHead(page).getAttribute("aria-expanded")) !== "true") await trailHead(page).click(); };
const recText = (page) => page.locator(".reco-card .reco-box").first().innerText();

// ================================================================ the AI is offered by the local server
let page = await open("prostate", { facts: PATIENT });

await step("Settings shows an AI decision support section with the threshold in plain words and the privacy note", async () => {
  const dlg = await settings(page);
  const sec = dlg.getByRole("group", { name: "AI decision support" });
  await sec.waitFor();
  assert.equal(await sec.getByTestId("ai-toggle").isChecked(), true, "on by default when the server offers it");
  const text = await sec.innerText();
  assert.match(text, /Follow the AI automatically when it is at least 85% confident/);
  assert.match(text, /With AI on, the patient's structured answers and the guideline page text are sent to OpenAI to score branches\. No names or free text are sent\./);
  const range = sec.getByTestId("ai-threshold");
  assert.equal(await range.getAttribute("min"), "50");
  assert.equal(await range.getAttribute("max"), "99");
  await range.fill("90");
  assert.match(await sec.innerText(), /at least 90% confident/);
  await range.fill("85");
  await shot(page, "settings-ai");
  await closeSettings(page);
});

await step("the trail lists decisions with rule and AI badges, bars and links to the NCCN page", async () => {
  await showReco(page);
  await openTrail(page);
  await page.locator(".tr-wait").waitFor({ state: "detached" });
  const sum = await page.getByTestId("trail-summary").innerText();
  assert.match(sum, /^\d+ decisions? · \d+ by the guideline rules? · 1 by AI \(lowest 93%\) · 0 by you$/);
  const trail = page.locator("#rc-trail");
  const text = await trail.innerText();
  assert.match(text, /Rule ✓/);
  assert.match(text, /Rule ✗/);
  assert.match(text, /AI 93%/);
  assert.match(text, /AI 1%/, "every option of a decision is listed with its probability");
  assert.ok((await trail.locator(".tr-bar").count()) >= 4, "confidence bars");
  const steps = trail.locator(".tr-steps");
  const opts = await steps.locator(".tr-opt").count();
  assert.equal(await steps.getByRole("button", { name: "Show on NCCN page" }).count(), opts, "every option links to its NCCN page");
  assert.equal(await trail.locator(".tr-opt.chosen").count(), await trail.locator(".tr-step").count(), "one chosen option per decision");
  await trail.scrollIntoViewIfNeeded();
  await shot(page, "trail-prostate");
});

await step("the card says the AI helped, and links to the trail", async () => {
  const line = (await page.getByTestId("ai-assisted").innerText()).replace(/\s+/g, " ");
  assert.match(line, /AI-assisted: 1 of \d+ decisions chosen by the AI \(lowest 93%\)\. Review in How we got here\./);
});

await step("what was sent to the server is structured answers and page text only, in the shape the client expects", async () => {
  assert.ok(mock.requests.length > 0);
  for (const r of mock.requests) {
    assert.deepEqual(Object.keys(r).sort(), ["input", "questions"]);
    assert.match(r.input, /^Patient \(structured answers\):\n/);
    assert.match(r.input, /\n\nGuideline page text:\n/);
    for (const q of r.questions) assert.match(q.name, /^(n|o):/);
  }
});

await step("the diagram's arrows on the route say who chose them", async () => {
  let tags = [];
  const pages = await page.locator("#rc-trail .tr-step").evaluateAll((els) => [...new Set(els.map((e) => e.dataset.page))]);
  for (const code of pages) {
    await page.evaluate((c) => { location.hash = `#prostate/flow/${c}`; }, code);
    await page.locator("[data-testid=title]", { hasText: code }).waitFor();
    await page.locator("[data-testid=card]").first().waitFor();
    await page.waitForTimeout(500);
    tags = await page.locator("[data-testid=edge-tag]").allTextContents();
    if (tags.length) { await shot(page, "diagram-edge-tags"); break; }
  }
  assert.ok(tags.length >= 1 && tags.every((t) => /^(Rule|You|\d+%)$/.test(t)), `labels: ${tags.join(",")} on pages ${pages.join(",")}; svg ${await page.locator("svg.edge-tags").count()}, walk edges ${await page.locator("path.edge.walk").count()}, ai.on? ${await page.locator("#rc-trail .tr-wait").count()}`);
  await page.evaluate(() => { location.hash = "#prostate/flow/PROS-1"; });
  await page.locator("[data-testid=card]").first().waitFor();
});

let before;
await step("Choose this instead changes the recommendation", async () => {
  before = await recText(page);
  const last = page.locator("#rc-trail .tr-step").last();
  await last.locator(".tr-opt:not(.chosen)").first().getByRole("button", { name: "Choose this instead" }).click();
  await page.waitForFunction((b) => document.querySelector(".reco-card .reco-box")?.innerText !== b, before);
  assert.notEqual(await recText(page), before);
  await openTrail(page);
  assert.match(await page.locator("#rc-trail").innerText(), /You chose/);
  assert.match(await page.getByTestId("trail-summary").innerText(), /· 1 by you$/);
  await page.locator("#rc-trail").scrollIntoViewIfNeeded();
  await shot(page, "trail-override");
});

await step("the choice is kept with the patient (and survives a reload), and can be taken back", async () => {
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("oc-patient:prostate")));
  assert.equal(Object.keys(stored.overrides).length, 1);
  await page.reload();
  await page.locator("[data-testid=card]").first().waitFor();
  await tab(page, /Pathways|Recommendation/);
  await openTrail(page);
  assert.match(await page.locator("#rc-trail").innerText(), /You chose/);
  await page.getByRole("button", { name: "Take back my choice" }).click();
  await page.waitForFunction(() => !/You chose/.test(document.getElementById("rc-trail")?.textContent ?? ""));
  await page.waitForFunction((b) => document.querySelector(".reco-card .reco-box")?.innerText === b, before);
});

await step("a threshold above the AI's confidence stops the walk: Your decision needed, sorted, one click to choose", async () => {
  await (await settings(page)).getByTestId("ai-threshold").fill("99");
  await closeSettings(page);
  const stop = page.getByRole("group", { name: "Your decision needed" });
  await stop.waitFor();
  assert.match(await stop.locator(".tr-stop-h").innerText(), /^Your decision needed: /);
  const pcts = (await stop.locator(".tr-badge.ai").allInnerTexts()).map((t) => Number(t.replace(/\D/g, "")));
  assert.ok(pcts.length >= 2 && pcts.every((p, i) => !i || pcts[i - 1] >= p), `sorted by confidence: ${pcts}`);
  await stop.scrollIntoViewIfNeeded();
  await shot(page, "your-decision-needed");
  await stop.getByRole("button", { name: /^Choose/ }).nth(1).click();
  await page.waitForFunction(() => !document.querySelector("[aria-label='Your decision needed']"));
  await openTrail(page);
  assert.match(await page.locator("#rc-trail").innerText(), /You chose/);
  await (await settings(page)).getByTestId("ai-threshold").fill("85");
  await closeSettings(page);
});

await step("turning AI off removes the AI from the trail, the card and the diagram; the rules stay", async () => {
  const dlg = await settings(page);
  await dlg.getByTestId("ai-toggle").uncheck();
  assert.equal(await dlg.getByTestId("ai-threshold").count(), 0);
  await closeSettings(page);
  await page.locator(".tr-wait").waitFor({ state: "detached" });
  const t = await page.locator("#rc-trail").innerText();
  assert.doesNotMatch(t, /by AI|AI \d+%|AI checking/);
  assert.equal(await page.getByTestId("ai-assisted").count(), 0);
  assert.equal(await page.locator("[data-testid=edge-tag]").count(), 0);
  assert.match(t, /You chose/, "the choice you made stays");
  await (await settings(page)).getByTestId("ai-toggle").check();
  await closeSettings(page);
});

await step("starting over clears the choices with the patient", async () => {
  await tab(page, /Patient/);
  await page.getByTestId("patient-more").click();
  await page.getByRole("button", { name: /Start over/ }).click();
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("oc-patient:prostate")));
  assert.deepEqual(stored.overrides, {});
  assert.deepEqual(stored.facts, {});
});
await page.context().close();

// ================================================================ the AI is not sure, or fails
mock.mode = "none";
page = await open("prostate", { facts: PATIENT });
await step("'not enough information' names the details that would decide, as buttons that open the question", async () => {
  await showReco(page);
  const card = page.getByRole("group", { name: "Not enough information" });
  await card.waitFor();
  assert.match(await card.locator(".tr-stop-h").innerText(), /^Not enough information to decide /);
  await card.scrollIntoViewIfNeeded();
  await shot(page, "not-enough");
  const asks = card.locator(".rc-q");
  if (await asks.count()) {
    await asks.first().click();
    assert.equal(await page.getByRole("tab", { name: /Patient/ }).getAttribute("aria-selected"), "true");
  } else assert.ok((await card.getByRole("button", { name: /^Choose/ }).count()) > 0, "no missing detail named: the options can be chosen");
});
await page.context().close();

mock.mode = "error";
page = await open("prostate", { facts: PATIENT });
await step("when the AI fails, one muted line says so and the guideline rules still show", async () => {
  await showReco(page);
  await page.getByText("AI scoring unavailable — showing the guideline rules only.").waitFor();
  assert.equal(await page.locator(".reco-card").count(), 1);
  await openTrail(page);
  // the pending choice sits inside the card (provisional), not below the fold
  assert.match(await page.locator(".reco-card").innerText(), /Provisional: this depends on the decision below[\s\S]*Still open: /, "the rules stop where they cannot decide, and the choice is the clinician's");
  assert.equal(await page.getByRole("group", { name: "Your decision needed" }).count(), 0);
});
await page.context().close();

// ================================================================ the trail on other guidelines
mock.mode = "confident";
const seeds = {
  rectal: { guideline_section: "pMMR/MSS Rectal Cancer" },
  colon: { guideline_section: "pMMR/MSS Colon Cancer", primary_diagnosis: "colon_adenocarcinoma", m_category: "M0" },
  b_cell_lymphomas: { guideline_section: "Diffuse Large B-Cell Lymphoma", histologic_transformation: false, ann_arbor_stage: "III", extensive_mesenteric_disease: false },
};
for (const [slug, facts] of Object.entries(seeds)) {
  page = await open(slug, { facts });
  await step(`the trail renders on ${slug}`, async () => {
    await tab(page, /Pathways|Recommendation/);
    await page.locator("#rc-trail").waitFor();
    await page.locator(".tr-wait").waitFor({ state: "detached" });
    await openTrail(page);
    const summary = await page.getByTestId("trail-summary").innerText();
    console.log(`   ${slug}: ${summary}`);
    assert.match(summary, /\d+ decisions? · \d+ by the guideline rules? · \d+ by AI|No decisions made yet/);
    assert.ok((await page.locator("#rc-trail .tr-step").count()) + (await page.getByRole("group", { name: /Your decision needed|Not enough information/ }).count()) > 0);
    assert.ok((await page.locator(".paths .tr-opt").count()) > 0 || (await page.locator(".paths .rc-q").count()) > 0, "options, or the details that are missing");
    await page.locator("#rc-trail").scrollIntoViewIfNeeded();
    await shot(page, `trail-${slug}`);
  });
  await page.context().close();
}

// ================================================================ no AI where the server does not offer it
for (const status of [null, { enabled: false, model: "mock-model" }]) {
  mock.status = status;
  mock.requests.length = 0;
  page = await open("prostate", { facts: PATIENT });
  await step(`with ${status ? "the server's key missing" : "no local server"}, nothing about AI appears`, async () => {
    const dlg = await settings(page);
    assert.equal(await dlg.getByRole("group", { name: "AI decision support" }).count(), 0);
    assert.doesNotMatch(await dlg.innerText(), /\bAI\b|OpenAI/);
    await closeSettings(page);
    await showReco(page);
    await page.locator("#rc-trail").waitFor();
    await openTrail(page);
    assert.doesNotMatch(await page.locator("#rp-panel").innerText(), /\bAI\b|OpenAI/);
    assert.equal(await page.getByTestId("ai-assisted").count(), 0);
    assert.equal(await page.locator("[data-testid=edge-tag]").count(), 0);
    assert.match(await page.locator(".reco-card").innerText(), /Still open: /);
    assert.equal(mock.requests.length, 0, "no request to /api/decide");
  });
  await page.context().close();
}

await browser.close();
server.close();
if (errors.length) { console.error("console errors:", errors); process.exit(1); }
console.log(`ai e2e: ${n} checks passed`);
