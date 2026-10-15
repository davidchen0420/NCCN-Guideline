// Browser smoke test: node e2e/smoke.mjs <path/to/dashboard.html>
// Uses the synthetic sample guideline (SAMPLE-1, SAMPLE-2). Set CHROMIUM_PATH to use a specific browser.
import { chromium } from "playwright-core";
import { strict as assert } from "node:assert";

const file = process.argv[2];
if (!file) { console.error("usage: node e2e/smoke.mjs <dashboard.html>"); process.exit(2); }
const url = "file://" + new URL(file, "file://" + process.cwd() + "/").pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const errors = [];
const watch = (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); };
const cards = (p) => p.locator("[data-testid=card]");
let n = 0;
const step = async (name, fn) => { await fn(); console.log(`ok ${++n} ${name}`); };

// ------------------------------------------------------------------ desktop
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(page);
await page.goto(url);
await step("first visit shows the start screen; browsing closes it and opens contents", async () => {
  await page.getByRole("dialog", { name: /Find where a patient sits/ }).waitFor();
  assert.ok(await page.getByRole("button", { name: /Enter a patient/ }).isVisible());
  await page.getByRole("button", { name: /Browse the guideline/ }).click();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("button", { name: "Got it" }).click();
});
await step("contents list pages and groups documents", async () => {
  await page.locator(".toc-item.alg").first().waitFor();
  assert.equal(await page.locator(".toc-item.alg").count(), 2);
  assert.ok(await page.locator(".toc-item.principles").count() >= 1);
});
await step("cards render with structured text", async () => {
  await cards(page).first().waitFor();
  assert.equal(await cards(page).count(), 5);
  assert.ok(await page.locator(".card .tier").count() >= 1, "tier headings");
  assert.ok(await page.locator(".card .tag-cat").count() >= 1, "category tags");
  assert.ok(await page.locator(".card ul li").count() >= 3, "bullet lists");
  assert.ok(await page.locator(".card .or-divider").count() >= 1, "or divider");
});
await step("selecting an answer highlights its path and hides the rest", async () => {
  await page.locator('[data-id="SAMPLE-1:n3"]').click();
  assert.equal(await page.locator(".card.answer").count(), 1);
  assert.ok(await page.locator(".card.hide").count() >= 1);
  await page.locator("label:has([data-testid=non-active])").click();
  assert.equal(await page.locator(".card.hide").count(), 0);
  assert.ok(await page.locator(".card.dim").count() >= 1);
  await page.getByTestId("clear").click();
  assert.equal(await page.locator(".card.answer").count(), 0);
});
await step("footnote badge opens the dock and steps instances", async () => {
  await page.locator('[data-id="SAMPLE-1:n3"] .fb').first().click();
  assert.match(await page.locator(".dock-body").innerText(), /1 of 1 instance/);
  await page.getByRole("tab", { name: "Evidence" }).click();
  assert.match(await page.locator(".dock-body").innerText(), /Category 1/);
  await page.getByRole("tab", { name: "Preference" }).click();
  assert.match(await page.locator(".dock-body").innerText(), /Preferred/);
  await page.getByRole("button", { name: "Close panel" }).click();
});
await step("linked titles open the principles page, which lists where it is cited", async () => {
  await page.locator('[data-id="SAMPLE-1:n4"] .xlink').first().click();
  assert.equal(await page.locator(".doc h1").innerText(), "Principles of Scoring");
  assert.ok(await page.locator(".cited .xref").count() >= 1);
  await page.getByLabel("Back").click();
  assert.match(await page.getByTestId("title").innerText(), /SAMPLE-1/);
});
await step("search: quotes, filters and graying", async () => {
  await page.getByTestId("rail-search").click();
  await page.getByRole("searchbox", { name: "Search" }).fill('"Category 1"');
  assert.ok(await page.locator(".res").count() >= 1);
  await page.getByRole("button", { name: "Preferred", exact: true }).click();
  assert.ok(await page.locator(".card.hit").count() >= 1);
  assert.ok(await page.locator(".card.gray").count() >= 1);
  await page.getByRole("searchbox", { name: "Search" }).fill("");
  await page.getByRole("button", { name: "Preferred", exact: true }).click();
});
await step("whole-guideline overview links to pages", async () => {
  await page.getByTestId("rail-map").click();
  await page.locator(".tile-main").first().click();
  assert.match(await page.getByTestId("title").innerText(), /SAMPLE-1/);
});
await step("patient details rank pathways across pages", async () => {
  await page.getByRole("tab", { name: "Patient" }).click();
  // the details that decide the first branches come first; the rest sit under More details
  if (!(await page.locator("#fact-score").isVisible())) await page.locator(".more-details > summary").click();
  await page.locator("#fact-score").fill("12");
  await page.locator("#fact-score").press("Tab");
  await page.getByRole("tab", { name: /Pathways/ }).click();
  assert.equal(await page.locator(".pcard").count(), 2, "age unknown: two routes");
  assert.match(await page.locator(".nudge").innerText(), /Age/);
  await page.locator(".nudge .need").click();
  await page.locator("#fact-age").fill("70");
  await page.locator("#fact-age").press("Tab");
  await page.getByRole("tab", { name: /Pathways/ }).click();
  assert.equal(await page.locator(".pcard").count(), 1);
  assert.match(await page.locator(".pcard").innerText(), /100%/);
  assert.equal(await page.locator(".trail .step").count(), 6);
  assert.ok(await page.locator(".trail .step.compact").count() >= 1, "pass-through steps collapse");
  assert.match(await page.locator(".reco").innerText(), /Recommended at this point/i);
  assert.match(await page.locator(".scores").innerText(), /Most likely[\s\S]*Complete/);
  assert.ok(await page.locator(".card.walk").count() >= 1, "route lit on the canvas");
});
await step("route summary lists details, recommendation and source pages", async () => {
  await page.getByRole("button", { name: /Summary to copy or print/ }).click();
  const doc = await page.locator(".sum-doc").innerText();
  assert.match(doc, /Recommended at this point/i);
  assert.match(doc, /Score/i);
  assert.match(doc, /SAMPLE-2, PDF p\.7/);
  await page.getByRole("button", { name: "Close summary" }).click();
});
await step("hovering a step previews its source page; clicking opens the page viewer", async () => {
  await page.locator(".trail .step.met .st-text").first().hover();
  await page.locator(".peek").waitFor();
  assert.match(await page.locator(".peek").innerText(), /SAMPLE-1/);
  await page.mouse.move(2, 2);
  await page.locator(".reco .src-chip").first().click();
  await page.getByRole("dialog", { name: /Guideline page/ }).waitFor();
  await page.getByRole("button", { name: "Close page viewer" }).click();
  assert.equal(await page.locator(".viewer").count(), 0);
});
await page.close();

// ------------------------------------------------------------------ phone
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
watch(phone);
await phone.goto(url);
await phone.getByRole("button", { name: /Browse the guideline/ }).tap();
await phone.getByRole("button", { name: "Close panel" }).first().tap();
await step("phone: no sideways scroll, drawer closed, readable card text", async () => {
  await cards(phone).first().waitFor();
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await phone.locator(".left").isVisible(), false);
  const size = await phone.locator("[data-testid=card] .card-body").first().evaluate((e) => {
    const t = e.closest(".plane");
    return parseFloat(getComputedStyle(e).fontSize) * (new DOMMatrix(getComputedStyle(t.parentElement).transform).a || 1);
  });
  assert.ok(size >= 10, `card text renders at ${size}px`);
});
await step("phone: selecting a card opens the details sheet", async () => {
  await phone.locator("[data-testid=card]").nth(2).tap();
  await phone.locator(".app.sheet-open").waitFor();
  assert.match(await phone.locator(".rp-body").innerText(), /SAMPLE-1/);
  await phone.getByRole("button", { name: "Close panel" }).first().tap();
});
await step("phone: contents drawer opens and navigates", async () => {
  await phone.getByTestId("rail-toc").tap();
  await phone.locator(".toc-item.alg").nth(1).tap();
  assert.match(await phone.getByTestId("title").textContent(), /SAMPLE-2/);
  assert.equal(await phone.locator(".left").isVisible(), false);
});
await browser.close();
assert.deepEqual(errors, [], "console errors: " + errors.join("; "));
console.log(`\nall ${n} checks passed`);
