// Screenshots of the main screens for design review: home, guideline panel, reader, patient
// questions, recommendation, page window; at desktop, laptop and phone widths, light and dark.
//   node e2e/shots.mjs [outDir] [--advanced]   (from web/, after the library build)
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(ROOT, "built/screenshots/review");
const ADV = process.argv.includes("--advanced");
const TYPES = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".pdf": "application/pdf" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/built/oncocarta.html`;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const sizes = [["desktop", 1440, 900], ["laptop", 1280, 800], ["phone", 390, 844]];
const errors = [];
for (const scheme of ["light", "dark"]) {
  for (const [name, w, h] of sizes) {
    if (scheme === "dark" && name === "laptop") continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
    await ctx.addInitScript((adv) => { try { sessionStorage.setItem("oc-intro", "1"); if (adv) localStorage.setItem("oc-advanced", "1"); } catch { /* */ } }, ADV);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${name}/${scheme}: ${e.message}`));
    const shot = (s) => p.screenshot({ path: join(OUT, `${s}-${name}-${scheme}.png`) });
    // 1 home
    await p.goto(base + "#atlas");
    await p.waitForTimeout(2500);
    await shot("1-home");
    // 2 guideline panel
    await p.goto(base + "#atlas/prostate");
    await p.waitForTimeout(2500);
    await shot("2-guideline");
    // 3 reader, first visit (welcome)
    await p.goto(base + "#prostate/");
    await p.waitForTimeout(1500);
    await shot("3-reader-first-visit");
    // 4 patient questions: enter a patient
    const enter = p.getByRole("button", { name: /Enter a patient/ });
    if (await enter.count()) await enter.first().click();
    await p.waitForTimeout(800);
    await shot("4-patient");
    // 5 recommendation: load an example patient
    const load = p.locator('select[aria-label="Load a patient"]');
    if (await load.count()) {
      const opt = await load.locator("option").nth(1).getAttribute("value").catch(() => null);
      if (opt) await load.selectOption(opt).catch(() => {});
    }
    await p.locator("#tab-paths").click().catch(() => {});
    await p.waitForTimeout(1200);
    await shot("5-recommendation");
    // 6 hover a step: preview of its NCCN page
    const card = p.locator(".canvas [data-testid=card]:visible").nth(1);
    if (await card.count()) { await card.hover({ position: { x: 20, y: 20 } }).catch(() => {}); await p.waitForTimeout(1200); }
    await shot("6-hover-step");
    await ctx.close();
  }
}
await browser.close();
server.close();
console.log(`screenshots in ${OUT}${errors.length ? `\npage errors:\n${errors.join("\n")}` : ""}`);
