#!/usr/bin/env node
/**
 * Offline calibration harness for AI decisions. Run by hand:
 *
 *   node web/test/ai-eval.mjs --server http://localhost:8000 [--limit N]   # real model through the proxy
 *   node web/test/ai-eval.mjs --mock --limit 50                              # deterministic mock, no server
 *
 * It builds a labelled set from all guidelines in data/ (decision nodes whose arms all have an
 * encoded condition, fact sets sampled so that the encoding gives a definite verdict), asks the
 * model the same questions the app asks (web/src/lib/decide.ts), and prints a markdown report:
 * accuracy, a 10-bin reliability table, and precision/recall of "auto-follow" at thresholds
 * 0.5 to 0.99. The report is also written to reports/ai-decisions-eval.md (a mock run writes
 * reports/ai-decisions-eval.mock.md, which is not tracked).
 *
 * Options
 *   --server URL        the nccn_nav.serve instance (default http://localhost:8000); needs OPENAI_API_KEY there
 *   --mock              answer from a deterministic mock instead (probability 0.9 on the true arm)
 *   --mock-accuracy X   with --mock: share of cases the mock gets right, 0..1 (default 1); the rest it answers wrongly with 0.9
 *   --limit N           number of labelled cases (default 200)
 *   --per-node K        cases per decision node (default 1); more nodes are used before more cases per node
 *   --guidelines a,b    only these data/<slug> folders
 *   --seed S            sampling seed (default 1)
 *   --concurrency C     parallel requests (default 4)
 *   --data DIR          guideline data folder (default <repo>/data)
 *   --out FILE          report path
 *
 * How the TypeScript is reached: the app's modules (adapt, graph, predicates, decide) are .ts files
 * with extensionless imports, which plain Node cannot load. Vite is already a devDependency, so the
 * harness loads web/test/ai-eval-lib.ts through Vite's module runner (`runnerImport`), the same
 * resolution the app build and vitest use. Run `npm install` in web/ once; no other tooling.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const o = { server: "http://localhost:8000", mock: false, mockAccuracy: 1, limit: 200, perNode: 1, seed: 1, concurrency: 4, data: join(repoRoot, "data"), guidelines: null, out: null };
  const num = (name, v) => { const x = Number(v); if (!Number.isFinite(x)) throw new Error(`${name} needs a number`); return x; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === "--mock") o.mock = true;
    else if (a === "--server") o.server = next().replace(/\/+$/, "");
    else if (a === "--mock-accuracy") o.mockAccuracy = num(a, next());
    else if (a === "--limit") o.limit = num(a, next());
    else if (a === "--per-node") o.perNode = Math.max(1, num(a, next()));
    else if (a === "--seed") o.seed = num(a, next());
    else if (a === "--concurrency") o.concurrency = Math.max(1, num(a, next()));
    else if (a === "--data") o.data = resolve(next());
    else if (a === "--guidelines") o.guidelines = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--out") o.out = resolve(next());
    else if (a === "-h" || a === "--help") { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n/, "").replace(/^\/\*\*?|^ \* ?/gm, "")); process.exit(0); }
    else throw new Error(`unknown option ${a} (try --help)`);
  }
  o.out ??= join(repoRoot, "reports", o.mock ? "ai-decisions-eval.mock.md" : "ai-decisions-eval.md");
  return o;
}

// ---------------------------------------------------------------- the mock
const hash01 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

/** A fetch that answers like the proxy would, from the label of the case being asked about. */
function mockFetch(state, accuracy) {
  return async (url, init) => {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (String(url).endsWith("/api/decide/status")) return json({ enabled: true, model: "mock" });
    const { questions } = JSON.parse(String(init.body));
    const c = state.current;
    const right = hash01(c.id + "|mock") < accuracy;
    const answers = questions.map((q) => {
      if (q.type !== "choice") return { type: "refusal", name: q.name };
      const values = q.choices.map((x) => x.value);
      const others = values.filter((v) => v !== c.truth);
      const top = right || !others.length ? c.truth : others[Math.floor(hash01(c.id + "|wrong") * others.length)];
      const rest = values.filter((v) => v !== top);
      return {
        type: "choice", name: q.name, choice: top, confidence: 0.9,
        probabilities: values.map((v) => ({ value: v, probability: v === top ? 0.9 : 0.1 / rest.length })),
      };
    });
    return json({ answers });
  };
}

// ---------------------------------------------------------------- main
async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { module: lib } = await runnerImport(join(here, "ai-eval-lib.ts"), { configFile: false, root: webRoot, logLevel: "error" });
  const { decide } = lib;

  if (!existsSync(o.data)) throw new Error(`no data folder at ${o.data}`);
  const slugs = readdirSync(o.data, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(o.data, d.name, "guideline.json")))
    .map((d) => d.name).sort()
    .filter((s) => !o.guidelines || o.guidelines.includes(s));
  if (!slugs.length) throw new Error("no guidelines to evaluate");

  const state = { current: null };
  let fetchFn, model = null;
  if (o.mock) fetchFn = mockFetch(state, o.mockAccuracy);
  else {
    fetchFn = fetch;
    decide.resetAiStatus();
    const st = await decide.aiStatus({ fetch: fetchFn, baseUrl: o.server });
    if (!st) throw new Error(`no AI server at ${o.server} (start: OPENAI_API_KEY=... python -m nccn_nav.serve), or use --mock`);
    if (!st.enabled) throw new Error(`the server at ${o.server} has no OPENAI_API_KEY`);
    model = st.model;
  }

  // 1. Label: walk the guidelines in shuffled order, taking nodes round robin until there are enough cases.
  const rand = lib.rng(o.seed);
  const graphs = new Map();
  const pool = [];   // [slug, node] with a label to check
  for (const slug of lib.shuffle(slugs, rand)) {
    const g = lib.loadGraph(JSON.parse(readFileSync(join(o.data, slug, "guideline.json"), "utf8")));
    graphs.set(slug, g);
    for (const node of lib.evaluableNodes(g)) pool.push([slug, node]);
    if (pool.length >= o.limit * 3 && graphs.size >= Math.min(slugs.length, 12)) break;   // enough variety; skip loading the rest
  }
  // interleave the guidelines, so that one with many decision nodes does not fill the set
  const bySlug = new Map();
  for (const item of lib.shuffle(pool, rand)) (bySlug.get(item[0]) ?? bySlug.set(item[0], []).get(item[0])).push(item);
  const order = [];
  for (let i = 0; order.length < pool.length; i++) for (const list of bySlug.values()) if (list[i]) order.push(list[i]);
  const cases = [];
  for (let pass = 0; cases.length < o.limit && pass < o.perNode && order.length; pass++) {
    for (const [slug, node] of order) {
      if (cases.length >= o.limit) break;
      const g = graphs.get(slug);
      lib.activate(g);
      const got = lib.casesForNode(g, slug, node, o.perNode, rand);
      const c = got[pass];
      if (c) cases.push(c);
    }
  }
  if (!cases.length) throw new Error("no labelled cases could be built");
  console.error(`${cases.length} labelled cases from ${new Set(cases.map((c) => c.slug)).size} guidelines (${pool.length} evaluable decision nodes seen); asking ${o.mock ? "the mock" : o.server} ...`);

  // 2. Ask. The mock answers from `state.current`, so it runs one case at a time.
  const scored = [];
  let errors = 0, done = 0, fatal = null;
  const run = async (c) => {
    const g = graphs.get(c.slug);
    lib.activate(g);
    state.current = c;
    decide.clearDecideCache();
    try {
      const out = await decide.scoreBranches(g, c.facts, [c.node], { fetch: fetchFn, baseUrl: o.mock ? "" : o.server });
      scored.push(lib.score(c, out.get(c.node)));
    } catch (e) {
      errors++;
      if (e?.status === 503 || e?.status === 403) fatal = e;
      scored.push(lib.score(c, null));
    }
    if (++done % 25 === 0) console.error(`  ${done}/${cases.length}`);
  };
  if (o.mock) for (const c of cases) await run(c);
  else {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(o.concurrency, cases.length) }, async () => {
      while (next < cases.length && !fatal) await run(cases[next++]);
    }));
  }
  if (fatal) throw new Error(`stopped: ${fatal.message}`);

  // 3. Report.
  const m = lib.metrics(scored);
  const md = lib.report(m, {
    mode: o.mock ? "mock" : "server", server: o.server, model, seed: o.seed, limit: o.limit, perNode: o.perNode, errors,
    date: new Date().toISOString().slice(0, 10), guidelines: new Set(cases.map((c) => c.slug)).size, mockAccuracy: o.mockAccuracy,
  });
  console.log(md);
  mkdirSync(dirname(o.out), { recursive: true });
  writeFileSync(o.out, md + "\n");
  console.error(`written ${o.out}`);
}

main().catch((e) => { console.error(`ai-eval: ${e?.message ?? e}`); process.exit(1); });
