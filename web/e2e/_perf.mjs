import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const ROOT = "/home/user/NCCN-Guideline/";
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { "content-type": extname(path) === ".html" ? "text/html" : "application/json" }); res.end(body); } catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/built/oncocarta.html`;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const out = [];
for (const slug of ["prostate", "b_cell_lymphomas", "survivorship"]) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(base + "#atlas"); await p.waitForTimeout(3200);
  await p.evaluate(() => { window.__f = []; let last = performance.now(); const loop = (t) => { window.__f.push(t - last); last = t; if (window.__f.length < 150) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
  await p.evaluate((s) => { history.pushState(null, "", "#atlas/" + s); dispatchEvent(new HashChangeEvent("hashchange")); }, slug);
  await p.waitForTimeout(2600);
  const f = await p.evaluate(() => window.__f);
  const long = f.filter((x) => x > 34);
  out.push(`${slug}: frames ${f.length}, >34ms ${long.length}, max ${Math.round(Math.max(...f))}ms, total ${Math.round(f.reduce((a, b) => a + b, 0))}ms`);
  await p.close();
}
console.log(out.join("\n"));
await browser.close(); server.close();
