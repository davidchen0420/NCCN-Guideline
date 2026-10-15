// Browser smoke test for the reader, against the synthetic sample guideline (SAMPLE-1, SAMPLE-2).
//
//   cd web && npm run build                                  # writes src/nccn_nav/dashboard.html
//   cd src && python -m nccn_nav.dashboard --sample ../sample_out    # builds sample_out/dashboard.html
//   cd web && node e2e/smoke.mjs ../sample_out/dashboard.html
//
// Most checks exercise Advanced tools (scores, trail, summary), so the first browser context turns
// them on through localStorage ("oc-advanced"). The last section runs in default mode and checks
// that the reviewer controls stay out of the way. Set CHROMIUM_PATH to use a specific browser.
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
const advancedCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await advancedCtx.addInitScript(() => { try { localStorage.setItem("oc-advanced", "1"); } catch { /* blocked */ } });
const page = await advancedCtx.newPage();
watch(page);
await page.addInitScript(() => { try { localStorage.setItem("oc-form-mode", "form"); } catch { /* */ } });   // the full form, not one question at a time
await page.goto(url);
await step("first visit shows the start screen; browsing closes it and opens contents", async () => {
  await page.getByRole("dialog", { name: /Find where a patient sits/ }).waitFor();
  assert.ok(await page.getByRole("button", { name: /Find a recommendation for a patient/ }).isVisible());
  await page.getByRole("button", { name: /Read the guideline/ }).click();
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
await step("every click on a step opens its NCCN page, whether the highlight turns on or off", async () => {
  for (const w of advancedCtx.pages()) if (w !== page) await w.close();
  await page.waitForTimeout(200);
  const card = page.locator('[data-id="SAMPLE-1:n3"]');
  const [on] = await Promise.all([advancedCtx.waitForEvent("page"), card.click()]);
  assert.equal(await page.locator(".card.answer").count(), 1);
  await on.close();
  await page.waitForTimeout(200);
  const [off] = await Promise.all([advancedCtx.waitForEvent("page"), card.click()]);
  assert.equal(await page.locator(".card.answer").count(), 0, "second click turns the highlight off");
  await off.close();
  await page.waitForTimeout(200);
});
await step("footnote badge opens the dock and steps instances", async () => {
  await page.locator('[data-id="SAMPLE-1:n3"] .fb').first().click();
  assert.match(await page.locator(".dock-body").innerText(), /1 of 1 place on this page/);
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
  assert.equal(await page.getByRole("button", { name: "Preferred", exact: true }).count(), 0, "filters start closed");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("button", { name: "Preferred", exact: true }).click();
  assert.ok(await page.locator(".card.hit").count() >= 1);
  assert.ok(await page.locator(".card.gray").count() >= 1);
  await page.getByRole("searchbox", { name: "Search" }).fill("");
  await page.getByRole("button", { name: "Preferred", exact: true }).click();
});
await step("overview (in Contents) links to pages", async () => {
  await page.getByTestId("rail-toc").click();
  if (!(await page.getByTestId("rail-map").isVisible())) await page.getByTestId("rail-toc").click();
  await page.getByTestId("rail-map").click();
  await page.locator(".map").waitFor();
  await page.locator(".tile-main").first().click();
  assert.match(await page.getByTestId("title").innerText(), /SAMPLE-1/);
});
await step("patient details rank pathways across pages", async () => {
  await page.getByRole("tab", { name: "Patient" }).click();
  // the details that decide the first branches come first; the rest sit under More details
  if (!(await page.locator("#fact-score").isVisible())) await page.locator(".more-details > summary").click();
  await page.locator("#fact-score").fill("12");
  await page.locator("#fact-score").press("Tab");
  await page.getByRole("tab", { name: /Recommendation/ }).click();
  assert.equal(await page.locator(".pcard").count(), 2, "age unknown: two routes");
  assert.match(await page.locator(".nudge").innerText(), /Age/);
  await page.locator(".nudge .need").click();
  await page.locator("#fact-age").fill("70");
  await page.locator("#fact-age").press("Tab");
  await page.getByRole("tab", { name: /Recommendation/ }).click();
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
await step("hovering a step previews its source page; clicking opens the page in its own window", async () => {
  await page.locator(".trail .step.met .st-text").first().hover();
  await page.locator(".peek").waitFor();
  assert.match(await page.locator(".peek").innerText(), /SAMPLE-1/);
  await page.mouse.move(2, 2);
  // earlier steps may have opened the page window already (it is reused), so take any window besides the reader
  const known = advancedCtx.pages().find((w) => w !== page && !w.isClosed());
  const [opened] = await Promise.all([known ? Promise.resolve(known) : advancedCtx.waitForEvent("page"), page.locator(".reco .src-chip").first().click()]);
  const win = opened;
  await win.locator(".viewer-bar").waitFor();
  assert.equal(await page.locator(".viewer").count(), 0, "not over the diagram");
  await win.getByRole("button", { name: "Close page viewer" }).click().catch(() => { /* the window closes under the click */ });
  await page.waitForTimeout(300);
  assert.ok(win.isClosed(), "Close shuts the window");
});
await page.close();

// ------------------------------------------------------------------ default mode (Advanced tools off)
const plain = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
watch(plain);
await plain.goto(url);
await plain.getByRole("button", { name: /Read the guideline/ }).click();
await step("default mode: help is a 5-step list without the technical section", async () => {
  await plain.getByRole("button", { name: "Help" }).click();
  const help = plain.getByRole("dialog", { name: "How to use OncoCarta" });
  assert.equal(await help.locator("ol.help-steps > li").count(), 5);
  assert.equal(await help.locator(".help-data").count(), 0, "About the data is an Advanced section");
  await plain.getByRole("button", { name: "Got it" }).click();
});
await step("default mode: reviewer controls are hidden", async () => {
  await cards(plain).first().waitFor();
  assert.equal(await plain.getByLabel("Arrow certainty").count(), 0, "arrow certainty switch hidden");
  assert.equal(await plain.getByTestId("non-active").count(), 0, "other paths switch hidden");
  assert.equal(await plain.locator("#tab-walk").count(), 0, "walk tab hidden");
  assert.equal(await plain.locator("#tab-details").count(), 0, "step tab hidden until a step is chosen");
  assert.equal(await plain.locator("#tab-patient").innerText(), "Patient");
  assert.match(await plain.locator("#tab-paths").innerText(), /Recommendation/);
  assert.equal(await plain.getByTestId("rail-map").count(), 1, "overview lives in Contents");
  assert.equal(await plain.getByTestId("rail-hist").count(), 0, "history is an Advanced view");
  assert.equal(await plain.getByTestId("clear").count(), 0, "nothing to clear yet");
});
await step("default mode: choosing a step shows the Step tab and a Show whole diagram chip", async () => {
  const plane = () => plain.locator(".react-transform-component").first().evaluate((e) => getComputedStyle(e).transform);
  const before = await plane();
  await plain.locator('[data-id="SAMPLE-1:n3"]').click();
  await plain.locator("#tab-details").waitFor();
  assert.equal(await plain.locator("#tab-patient").getAttribute("aria-selected"), "true", "the panel stays on the tab the reader was on");
  assert.equal(await plane(), before, "the diagram keeps its pan and zoom");
  assert.match(await plain.getByTestId("clear").innerText(), /Show whole diagram/);
  await plain.getByTestId("clear").click();
  assert.equal(await plain.getByTestId("clear").count(), 0);
});
await step("default mode: search has no AI segment, filters start closed, no other-paths switch", async () => {
  await plain.getByTestId("rail-search").click();
  assert.equal(await plain.getByRole("button", { name: "AI search" }).count(), 0);
  assert.equal(await plain.getByText("Include results on other paths").count(), 0);
  assert.equal(await plain.getByRole("button", { name: "Preferred", exact: true }).count(), 0);
  await plain.getByRole("button", { name: /^Filters/ }).click();
  assert.equal(await plain.getByRole("button", { name: "Preferred", exact: true }).count(), 1);
});
await step("default mode: the dock names its tabs in full", async () => {
  for (const name of ["Footnotes", "Evidence", "Preference"]) assert.ok(await plain.getByRole("tab", { name }).isVisible(), name);
});
await step("Settings: Advanced tools reveals the reviewer views, and the guide can be hidden", async () => {
  await plain.getByTestId("rail-settings").click();
  await plain.getByTestId("advanced-toggle").check();
  await plain.keyboard.press("Escape");
  assert.equal(await plain.getByLabel("Arrow certainty").count(), 1);
  assert.equal(await plain.getByTestId("non-active").count(), 1);
  assert.equal(await plain.locator("#tab-walk").count(), 1);
  assert.equal(await plain.getByTestId("rail-hist").count(), 0, "History shows with the Contents panel");
  await plain.getByTestId("rail-toc").click();
  await plain.getByTestId("rail-hist").waitFor();
  await plain.getByTestId("rail-settings").click();
  await plain.getByTestId("advanced-toggle").uncheck();
  await plain.keyboard.press("Escape");
  assert.equal(await plain.getByLabel("Arrow certainty").count(), 0);
});
await step("the 3-step strip is off by default (one-line hint only) and Settings turns it on", async () => {
  assert.equal(await plain.locator(".guide").count(), 1, "one-line hint");
  assert.equal(await plain.locator(".guide-steps").count(), 0, "no stepper row");
  await plain.getByTestId("rail-settings").click();
  assert.equal(await plain.getByTestId("guide-toggle").isChecked(), false);
  await plain.getByTestId("guide-toggle").check();
  await plain.keyboard.press("Escape");
  assert.equal(await plain.locator(".guide-steps li").count(), 3);
  await plain.getByTestId("rail-settings").click();
  await plain.getByTestId("guide-toggle").uncheck();
  await plain.keyboard.press("Escape");
  assert.equal(await plain.locator(".guide-steps").count(), 0);
  await plain.getByRole("button", { name: "Hide this hint" }).click();
  assert.equal(await plain.locator(".guide").count(), 0, "hint dismissed");
});
await plain.close();

// ------------------------------------------------------------------ default layout on a wide screen
const wide = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
watch(wide);
await wide.addInitScript(() => { try { localStorage.setItem("nav-help", "1"); } catch { /* blocked */ } });
await wide.goto(url);
await step("wide screen, default mode: Contents starts closed, remembers the last choice, zoom controls sit bottom right", async () => {
  await cards(wide).first().waitFor();
  assert.equal(await wide.locator(".app.left-open").count(), 0, "Contents closed");
  assert.equal(await wide.locator(".zbox input[type=range]").isVisible(), false, "no zoom slider outside Advanced");
  const z = await wide.locator(".zoomctl").boundingBox(), v = await wide.locator(".canvas").boundingBox();
  assert.ok(z && v && z.x > v.x + v.width / 2 && z.y > v.y + v.height / 2, "zoom group in the bottom-right quarter");
  assert.ok(await wide.getByRole("button", { name: "Zoom in" }).isVisible() && await wide.getByRole("button", { name: "Fit page" }).isVisible());
  assert.match(await wide.locator(".ext-t").innerText(), /NCCN website/);
  await wide.getByTestId("rail-toc").click();
  assert.equal(await wide.locator(".app.left-open").count(), 1);
  await wide.reload();
  await cards(wide).first().waitFor();
  assert.equal(await wide.locator(".app.left-open").count(), 1, "open again after reload");
  await wide.getByTestId("rail-toc").click();
  await wide.reload();
  await cards(wide).first().waitFor();
  assert.equal(await wide.locator(".app.left-open").count(), 0, "closed again after reload");
});
await step("wide screen, Advanced: zoom slider is back", async () => {
  await wide.getByTestId("rail-settings").click();
  await wide.getByTestId("advanced-toggle").check();
  await wide.keyboard.press("Escape");
  assert.equal(await wide.locator(".zbox input[type=range]").isVisible(), true);
});
await wide.close();

// ------------------------------------------------------------------ welcome dialog
const first = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
watch(first);
await first.goto(url);
await step("welcome: close button and Escape read the guideline; the disclaimer stays in view on a phone", async () => {
  await first.getByRole("dialog", { name: /Find where a patient sits/ }).waitFor();
  const foot = await first.locator(".wl-foot").boundingBox();
  assert.ok(foot && foot.y + foot.height <= 844 + 1, "disclaimer and How to use it fit on the screen");
  assert.ok(await first.getByRole("button", { name: "How to use it" }).isVisible());
  assert.ok(await first.getByRole("button", { name: "Close", exact: true }).isVisible());
  await first.keyboard.press("Escape");
  assert.equal(await first.getByRole("dialog").count(), 0);
  await first.reload();
  await first.waitForTimeout(300);
  assert.equal(await first.getByRole("dialog").count(), 0, "closing is remembered");
});
await first.close();
const esc = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
watch(esc);
await esc.goto(url);
await step("welcome: the close button opens the contents like Read the guideline", async () => {
  await esc.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await esc.getByRole("dialog").count(), 0);
  await esc.locator(".toc-item.alg").first().waitFor();
});
await esc.close();

// ------------------------------------------------------------------ phone
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
watch(phone);
await phone.goto(url);
await phone.getByRole("button", { name: /Read the guideline/ }).tap();
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
