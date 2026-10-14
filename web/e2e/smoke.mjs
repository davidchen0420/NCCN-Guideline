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
await step("first visit shows help, then closes", async () => {
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Got it" }).click();
  assert.equal(await page.getByRole("dialog").count(), 0);
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
  await page.getByText("Non-active paths").click();
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
await step("patient facts drive a walk across pages", async () => {
  await page.getByRole("tab", { name: "Patient facts" }).click();
  for (const d of await page.locator(".facts details").all()) await d.evaluate((e) => (e.open = true));
  await page.locator(".frow", { hasText: "score" }).locator("input").fill("12");
  await page.locator(".frow", { hasText: "age" }).locator("input").fill("70");
  await page.getByRole("button", { name: "Walk with these facts" }).click();
  assert.equal(await page.locator(".steps li").count(), 6);
  assert.match(await page.getByTestId("title").innerText(), /SAMPLE-2/);
});
await page.close();

// ------------------------------------------------------------------ phone
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
watch(phone);
await phone.goto(url);
await phone.getByRole("button", { name: "Got it" }).click();
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
  assert.match(await phone.getByTestId("title").innerText(), /SAMPLE-2/);
  assert.equal(await phone.locator(".left").isVisible(), false);
});
await browser.close();
assert.deepEqual(errors, [], "console errors: " + errors.join("; "));
console.log(`\nall ${n} checks passed`);
