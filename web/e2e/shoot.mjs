// Screenshots of the atlas for design review: node e2e/shoot.mjs <outdir> [width height]
import { chromium } from "playwright-core";
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
const out = process.argv[2];
const W = +(process.argv[3] ?? 1440), H = +(process.argv[4] ?? 900);
const scheme = process.argv[5] ?? "light";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, colorScheme: scheme, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name); };
await page.goto(base);
await page.waitForTimeout(800); await shot("01-intro-mid");
await page.waitForTimeout(2600); await shot("02-home");
// hover the survivorship node
const pos = await page.evaluate(() => {
  const c = document.querySelector("canvas"); return { w: c.clientWidth, h: c.clientHeight };
});
await page.mouse.move(pos.w / 2 + 10, 120); await page.waitForTimeout(400); await shot("03-hover-somewhere");
await page.getByRole("combobox").fill("prost"); await page.waitForTimeout(300); await shot("04-search");
await page.keyboard.press("Enter"); await page.waitForTimeout(1600); await shot("05-l1-prostate");
const chip = page.locator(".pchip").first();
await chip.waitFor({ timeout: 5000 }).catch(() => {});
if (await chip.count()) { await chip.click(); await page.waitForTimeout(2200); await shot("06-l1-route"); }
await page.evaluate(() => { location.hash = "#atlas/prostate/PROS-3"; });
await page.waitForTimeout(1800); await shot("07-l2-pros3");
await page.evaluate(() => { location.hash = "#atlas/@gi"; });
await page.waitForTimeout(1600); await shot("08-site-gi");
await page.evaluate(() => { location.hash = "#atlas/b_cell_lymphomas"; });
await page.waitForTimeout(1800); await shot("09-l1-bcell");
await browser.close(); server.close();
