/**
 * The AI-assisted walk: thresholds, "not enough information", clinician overrides, rule and AI
 * disagreement, scorer failure, the edge probabilities rankPathways takes, and a library-wide
 * check that the walk never throws or loops on any guideline. The scorer is a mock: no network.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Bundle, Facts } from "../src/types";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph, type Graph } from "../src/lib/graph";
import { moments } from "../src/lib/moments";
import { rankPathways } from "../src/lib/pathways";
import { DecideError, NONE } from "../src/lib/decide";
import { aiWalk, edgeProbFromTrail, entryNode, rulesOnlyTrail, walkChildren, type ScoreFn, type TrailStep } from "../src/lib/aiWalk";

const sample = buildGraph(JSON.parse(readFileSync(new URL("../public/sample-bundle.json", import.meta.url), "utf8")) as Bundle);
const load = (slug: string) => buildGraph(adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"))));

const S1 = { n2: "SAMPLE-1:n2", high: "SAMPLE-1:n3", low: "SAMPLE-1:n4", lowEnd: "SAMPLE-1:n5" };
const S2 = { entry: "SAMPLE-2:n1", old: "SAMPLE-2:n2", young: "SAMPLE-2:n3", oldEnd: "SAMPLE-2:n4", youngEnd: "SAMPLE-2:n5" };

/** A scorer returning fixed probabilities per node, and counting its calls. */
function mock(table: Record<string, Record<string, number>>) {
  const calls: string[][] = [];
  const score: ScoreFn = async (_g, _f, ids) => {
    calls.push(ids);
    return new Map(ids.filter((id) => table[id]).map((id) => [id, new Map(Object.entries(table[id]))] as const));
  };
  return { score, calls };
}

describe("thresholds", () => {
  it("follows the top child at or above the threshold (source ai, with its probability)", async () => {
    const m = mock({ [S1.n2]: { [S1.high]: 0.9, [S1.low]: 0.05, [NONE]: 0.05 } });
    const r = await aiWalk(sample, {}, "SAMPLE-1", { score: m.score, threshold: 0.85 });
    const step = r.steps.find((s) => s.node === S1.n2)!;
    expect(step).toMatchObject({ chosen: S1.high, by: "ai", prob: 0.9, page: "SAMPLE-1" });
    expect(step.options.map((o) => [o.child, o.prob, o.source])).toEqual([[S1.high, 0.9, "ai"], [S1.low, 0.05, "ai"]]);
    expect(r.steps[0]).toMatchObject({ by: "entry", node: "SAMPLE-1:n1" });
    expect(r.steps[1]).toMatchObject({ node: "SAMPLE-1:n1", chosen: S1.n2, by: "single" });
    expect(r.steps.map((s) => s.node)).toContain(S1.high);   // and the walk went on from there
  });

  it("asks below the threshold, with the options most probable first", async () => {
    const m = mock({ [S1.n2]: { [S1.high]: 0.2, [S1.low]: 0.7, [NONE]: 0.1 } });
    const r = await aiWalk(sample, {}, "SAMPLE-1", { score: m.score, threshold: 0.85 });
    expect(r.stoppedFor).toBe("ask");
    expect(r.end).toBe(S1.n2);
    expect(r.options!.map((o) => o.child)).toEqual([S1.low, S1.high]);
    expect(r.options![0].prob).toBe(0.7);
    expect(r.missing).toEqual(["score"]);
    expect(r.steps.every((s) => s.node !== S1.n2)).toBe(true);
  });

  it("the threshold is a setting: 0.7 follows at threshold 0.6 and asks at 0.85", async () => {
    const table = { [S1.n2]: { [S1.high]: 0.7, [S1.low]: 0.3 } };
    const follows = await aiWalk(sample, {}, "SAMPLE-1", { score: mock(table).score, threshold: 0.6 });
    expect(follows.steps.find((s) => s.node === S1.n2)).toMatchObject({ chosen: S1.high, by: "ai", prob: 0.7 });
    expect((await aiWalk(sample, {}, "SAMPLE-1", { score: mock(table).score })).stoppedFor).toBe("ask");   // default 0.85
  });

  it("stops with 'not enough information' when none is above one half, and lists what is missing", async () => {
    const m = mock({ [S1.n2]: { [S1.high]: 0.3, [S1.low]: 0.1, [NONE]: 0.6 } });
    const r = await aiWalk(sample, {}, "SAMPLE-1", { score: m.score });
    expect(r.stoppedFor).toBe("not-enough");
    expect(r.end).toBe(S1.n2);
    expect(r.missing).toEqual(["score"]);
    expect(r.none).toBe(0.6);
    expect(r.options).toHaveLength(2);
  });

  it("none at exactly one half does not stop the walk when the top child is sure enough", async () => {
    const m = mock({ [S1.n2]: { [S1.high]: 0.9, [NONE]: 0.5 } });
    expect((await aiWalk(sample, {}, "SAMPLE-1", { score: m.score })).steps.some((s) => s.by === "ai")).toBe(true);
  });

  it("asks when the scorer has nothing for the node", async () => {
    const r = await aiWalk(sample, {}, "SAMPLE-1", { score: mock({}).score });
    expect(r.stoppedFor).toBe("ask");
    expect(r.options!.every((o) => o.prob === undefined)).toBe(true);
  });
});

describe("rules first", () => {
  it("a true condition is followed and the scorer is not called", async () => {
    const m = mock({});
    const r = await aiWalk(sample, { score: 12, age: 70 }, "SAMPLE-1", { score: m.score });
    expect(m.calls).toEqual([]);
    expect(r.stoppedFor).toBeUndefined();
    const step = r.steps.find((s) => s.node === S1.n2)!;
    expect(step).toMatchObject({ chosen: S1.high, by: "rule" });
    expect(step.options.map((o) => [o.child, o.verdict, o.source])).toEqual([[S1.high, true, "rule"], [S1.low, false, "rule"]]);
    expect(r.steps.find((s) => s.node === S2.entry)).toMatchObject({ chosen: S2.old, by: "rule" });
    expect(r.end).toBe(S2.oldEnd);
  });

  it("scores only what the rules leave open", async () => {
    const m = mock({ [S2.entry]: { [S2.old]: 0.1, [S2.young]: 0.9 } });
    const r = await aiWalk(sample, { score: 12 }, "SAMPLE-1", { score: m.score });
    expect(m.calls).toEqual([[S2.entry]]);
    expect(r.steps.find((s) => s.node === S2.entry)).toMatchObject({ chosen: S2.young, by: "ai", prob: 0.9 });
    expect(r.end).toBe(S2.youngEnd);
  });

  it("a branch whose every condition is false asks, listing all as pruned", () => {
    const g = load("prostate");
    const node = "PROS-2:t_root";
    // every arm of the risk-group table is conditioned on risk_group: an impossible mix rules them all out
    const r = rulesOnlyTrail(g, { risk_group: "regional" }, node);
    expect(r.stoppedFor).toBe("ask");
    expect(r.end).toBe(node);
    expect(r.options!.every((o) => o.verdict === false)).toBe(true);
  });
});

describe("disagreement", () => {
  it("rule true, AI picks the other child with probability at the threshold: flagged, rule wins", async () => {
    const m = mock({ [S1.n2]: { [S1.high]: 0.03, [S1.low]: 0.95, [NONE]: 0.02 } });
    const r = await aiWalk(sample, { score: 12, age: 70 }, "SAMPLE-1", { score: m.score, checkRules: true });
    expect(m.calls[0]).toEqual([S1.n2]);
    const step = r.steps.find((s) => s.node === S1.n2)!;
    expect(step).toMatchObject({ chosen: S1.high, by: "rule", disagree: true });
    expect(step.options.find((o) => o.child === S1.low)).toMatchObject({ verdict: false, prob: 0.95 });
  });

  it("rule false for a child the AI is sure of: the same flag", async () => {
    // score 3 makes "Option A" false; the model says A with 0.9
    const m = mock({ [S1.n2]: { [S1.high]: 0.9, [S1.low]: 0.1 } });
    const r = await aiWalk(sample, { score: 3 }, "SAMPLE-1", { score: m.score, checkRules: true });
    expect(r.steps.find((s) => s.node === S1.n2)).toMatchObject({ chosen: S1.low, by: "rule", disagree: true });
  });

  it("no flag when they agree, or when the AI is below the threshold", async () => {
    const agree = await aiWalk(sample, { score: 12, age: 70 }, "SAMPLE-1", { score: mock({ [S1.n2]: { [S1.high]: 0.99, [S1.low]: 0.01 } }).score, checkRules: true });
    expect(agree.steps.find((s) => s.node === S1.n2)!.disagree).toBeUndefined();
    const unsure = await aiWalk(sample, { score: 12, age: 70 }, "SAMPLE-1", { score: mock({ [S1.n2]: { [S1.high]: 0.2, [S1.low]: 0.8 } }).score, checkRules: true });
    expect(unsure.steps.find((s) => s.node === S1.n2)).toMatchObject({ chosen: S1.high, by: "rule" });
    expect(unsure.steps.find((s) => s.node === S1.n2)!.disagree).toBeUndefined();
  });

  it("rule-decided nodes are only scored with checkRules (default off)", async () => {
    const m = mock({ [S1.n2]: { [S1.high]: 0.03, [S1.low]: 0.95 } });
    const r = await aiWalk(sample, { score: 12, age: 70 }, "SAMPLE-1", { score: m.score });
    expect(m.calls).toEqual([]);
    expect(r.steps.find((s) => s.node === S1.n2)!.disagree).toBeUndefined();
    expect(r.steps.find((s) => s.node === S1.n2)!.options.every((o) => o.prob === undefined)).toBe(true);
  });

  it("an AI-decided step is flagged when a child the rules pruned has the highest probability", async () => {
    // age >= 65 is false for age 30, but the model prefers it at 0.97 and also gives "young" 0.9?  (not possible as a choice; as options it is)
    const m = mock({ [S2.entry]: { [S2.old]: 0.97, [S2.young]: 0.9 } });
    const r = await aiWalk(sample, { score: 12, age: 30 }, "SAMPLE-1", { score: m.score, checkRules: true });
    // age 30: "old" is false, "young" is true -> rule decides; flagged because the model sure of the pruned one
    expect(r.steps.find((s) => s.node === S2.entry)).toMatchObject({ chosen: S2.young, by: "rule", disagree: true });
  });
});

describe("clinician overrides", () => {
  it("an override wins over the rules and the AI, and the walk recomputes downstream", async () => {
    const m = mock({ [S1.n2]: { [S1.high]: 0.95, [S1.low]: 0.05 } });
    const free = await aiWalk(sample, {}, "SAMPLE-1", { score: m.score });
    expect(free.steps.map((s) => s.node)).toContain(S1.high);
    const forced = await aiWalk(sample, {}, "SAMPLE-1", { score: m.score, overrides: { [S1.n2]: S1.low } });
    const step = forced.steps.find((s) => s.node === S1.n2)!;
    expect(step).toMatchObject({ chosen: S1.low, by: "clinician" });
    expect(step.options.find((o) => o.child === S1.low)!.source).toBe("clinician");
    expect(step.options.find((o) => o.child === S1.high)!.prob).toBe(0.95);   // the bars are still there
    expect(forced.steps.map((s) => s.node)).not.toContain(S1.high);
    expect(forced.end).toBe(S1.lowEnd);
  });

  it("overrides beat a true rule too, and an override for a later node applies after the first", async () => {
    const r = await aiWalk(sample, { score: 12 }, "SAMPLE-1", { score: mock({}).score, overrides: { [S2.entry]: S2.young } });
    expect(r.steps.find((s) => s.node === S2.entry)).toMatchObject({ chosen: S2.young, by: "clinician" });
    expect(r.end).toBe(S2.youngEnd);
    const rules = rulesOnlyTrail(sample, { score: 12, age: 70 }, "SAMPLE-1", { [S1.n2]: S1.low });
    expect(rules.steps.find((s) => s.node === S1.n2)).toMatchObject({ chosen: S1.low, by: "clinician" });
    expect(rules.end).toBe(S1.lowEnd);
  });

  it("an override naming something that is not a child is ignored", async () => {
    const r = await aiWalk(sample, {}, "SAMPLE-1", { score: mock({}).score, overrides: { [S1.n2]: "SAMPLE-2:n5" } });
    expect(r.stoppedFor).toBe("ask");
  });
});

describe("scorer failure", () => {
  it("a DecideError ends the walk with stoppedFor error, keeping the steps so far", async () => {
    const score: ScoreFn = async () => { throw new DecideError("AI decisions are not enabled on this server.", 503); };
    const r = await aiWalk(sample, {}, "SAMPLE-1", { score });
    expect(r.stoppedFor).toBe("error");
    expect(r.error).toMatch(/not enabled/);
    expect(r.end).toBe(S1.n2);
    expect(r.steps.map((s) => s.by)).toEqual(["entry", "single"]);
  });

  it("any thrown value is caught", async () => {
    const score: ScoreFn = async () => { throw "boom"; };
    const r = await aiWalk(sample, {}, "SAMPLE-1", { score });
    expect(r.stoppedFor).toBe("error");
  });

  it("the default scorer without a server fails gracefully (no fetch endpoint)", async () => {
    const fetchFn = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    const r = await aiWalk(sample, {}, "SAMPLE-1", { decide: { fetch: fetchFn } });
    expect(r.stoppedFor).toBe("error");
  });

  it("an unknown start does not throw", async () => {
    expect((await aiWalk(sample, {}, "NOPE-1")).stoppedFor).toBe("error");
    expect(rulesOnlyTrail(sample, {}, "NOPE-1").stoppedFor).toBe("error");
  });
});

describe("rulesOnlyTrail", () => {
  it("follows what the facts decide and stops at the first open branch", () => {
    const open = rulesOnlyTrail(sample, { score: 12 }, "SAMPLE-1");
    expect(open.steps.map((s) => s.by)).toEqual(["entry", "single", "rule", "single"]);
    expect(open.stoppedFor).toBe("ask");
    expect(open.end).toBe(S2.entry);
    expect(open.missing).toEqual(["age"]);
    const done = rulesOnlyTrail(sample, { score: 12, age: 30 }, "SAMPLE-1");
    expect(done.stoppedFor).toBeUndefined();
    expect(done.end).toBe(S2.youngEnd);
  });

  it("starts from a node id or from auto", () => {
    expect(rulesOnlyTrail(sample, { score: 12 }, S1.n2).steps[0]).toMatchObject({ by: "entry", node: S1.n2 });
    expect(entryNode(sample, "auto")).toBe("SAMPLE-1:n1");
    expect(walkChildren(sample, S1.n2)).toEqual([S1.high, S1.low]);
  });
});

describe("edge probabilities", () => {
  it("collects every scored option of every step and of the stop", async () => {
    const m = mock({ [S1.n2]: { [S1.high]: 0.9, [S1.low]: 0.1 }, [S2.entry]: { [S2.old]: 0.3, [S2.young]: 0.5 } });
    const r = await aiWalk(sample, {}, "SAMPLE-1", { score: m.score });
    const e = edgeProbFromTrail(r);
    expect(e.get(`${S1.n2}>${S1.high}`)).toBe(0.9);
    expect(e.get(`${S1.n2}>${S1.low}`)).toBe(0.1);
    expect(e.get(`${S2.entry}>${S2.old}`)).toBe(0.3);   // from the stop
    expect(edgeProbFromTrail(r.steps).has(`${S2.entry}>${S2.old}`)).toBe(false);
    expect(edgeProbFromTrail([]).size).toBe(0);
  });

  it("changes the order of ranked pathways; absent, the output is identical", () => {
    const plain = rankPathways(sample, { score: 12 });
    expect(plain.paths.map((p) => p.likelihood)).toEqual([0.5, 0.5]);
    expect(rankPathways(sample, { score: 12 }, "auto", undefined)).toEqual(plain);
    expect(rankPathways(sample, { score: 12 }, "auto", {})).toEqual(plain);
    expect(rankPathways(sample, { score: 12 }, "auto", { edgeProb: new Map() })).toEqual(plain);
    const lastOf = (p: { steps: { node: string }[] }) => p.steps[p.steps.length - 1].node;
    const young = rankPathways(sample, { score: 12 }, "auto", { edgeProb: new Map([[`${S2.entry}>${S2.young}`, 0.8], [`${S2.entry}>${S2.old}`, 0.2]]) });
    expect(young.paths.map(lastOf)).toEqual([S2.youngEnd, S2.oldEnd]);
    expect(young.paths.map((p) => Math.round(p.likelihood * 100) / 100)).toEqual([0.8, 0.2]);
    const old = rankPathways(sample, { score: 12 }, "auto", { edgeProb: new Map([[`${S2.entry}>${S2.old}`, 0.9], [`${S2.entry}>${S2.young}`, 0.1]]) });
    expect(old.paths.map(lastOf)).toEqual([S2.oldEnd, S2.youngEnd]);
    // likelihoods still sum to one, and a decided branch is not touched
    expect(young.paths.reduce((a, p) => a + p.likelihood, 0)).toBeCloseTo(1);
    const decided = rankPathways(sample, { score: 12, age: 70 }, "auto", { edgeProb: new Map([[`${S2.entry}>${S2.young}`, 0.99]]) });
    expect(decided).toEqual(rankPathways(sample, { score: 12, age: 70 }));
  });

  it("an arm with no probability takes the mean of the supplied ones; zero keeps the route listed", () => {
    const r = rankPathways(sample, { score: 12 }, "auto", { edgeProb: new Map([[`${S2.entry}>${S2.young}`, 0.6]]) });
    expect(r.paths.map((p) => p.likelihood)).toEqual([0.5, 0.5]);
    const z = rankPathways(sample, { score: 12 }, "auto", { edgeProb: new Map([[`${S2.entry}>${S2.young}`, 0], [`${S2.entry}>${S2.old}`, 1]]) });
    expect(z.paths).toHaveLength(2);
    expect(z.paths[1].likelihood).toBeGreaterThan(0);
  });
});

describe("a real guideline, through the default scorer with a mocked server", () => {
  it("prostate risk groups: the model's choice is followed above the threshold", async () => {
    const g = load("prostate");
    const node = "PROS-2:t_root";
    const kids = g.kids(node);
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { questions: { name: string; choices: { value: string }[] }[] };
      const answers = body.questions.map((q) => ({
        type: "choice", name: q.name,
        probabilities: q.choices.map((c) => ({ value: c.value, probability: c.value === kids[1] ? 0.93 : c.value === "none" ? 0.01 : 0.02 })),
      }));
      return { ok: true, status: 200, json: async () => ({ answers }) } as Response;
    }) as unknown as typeof fetch;
    const r = await aiWalk(g, {}, node, { decide: { fetch: fetchFn } });
    expect(r.steps[1]).toMatchObject({ node, chosen: kids[1], by: "ai", prob: 0.93 });
    expect(r.steps[1].options).toHaveLength(kids.length);
  });
});

// ---------------------------------------------------------------- the whole library

const slugs = readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`)).sort();

/** Deterministic details for every schema variable: the first enum value, true, a middling number. */
function filled(g: Graph): Facts {
  const out: Facts = {};
  for (const [k, spec] of Object.entries(g.bundle.schema?.variables ?? {})) {
    if (spec.type === "bool") out[k] = true;
    else if (spec.type === "number") out[k] = 10;
    else if (spec.values?.length) out[k] = spec.values[0];
  }
  return out;
}

/** Probability .95 for the first child, the rest tiny, none zero. */
const firstChild: ScoreFn = async (g, _f, ids) =>
  new Map(ids.map((id) => {
    const ks = walkChildren(g, id);
    return [id, new Map<string, number>([...ks.map((k, i) => [k, i === 0 ? 0.95 : 0.05 / Math.max(1, ks.length - 1)] as const), [NONE, 0]])] as const;
  }));
/** Probability .95 for every child (independent options): the walk goes on through the first candidate. */
const everyChild: ScoreFn = async (g, _f, ids) =>
  new Map(ids.map((id) => [id, new Map<string, number>(walkChildren(g, id).map((k) => [k, 0.95] as const))] as const));

function check(g: Graph, r: Awaited<ReturnType<typeof aiWalk>>, maxSteps: number, label: string) {
  expect(r.steps.length, label).toBeGreaterThan(0);
  expect(r.steps.length, label).toBeLessThanOrEqual(maxSteps + 1);
  expect(r.steps[0].by, label).toBe("entry");
  const seen = new Set<string>();
  r.steps.forEach((s: TrailStep, i: number) => {
    if (i === 0) return;   // the entry step names the start; a START box is then branched on
    expect(seen.has(s.node), `${label}: ${s.node} twice`).toBe(false);
    seen.add(s.node);
    expect(s.node, label).toBe(r.steps[i - 1].chosen);
    expect(walkChildren(g, s.node, {}), `${label}: ${s.chosen} is not a child of ${s.node}`).toContain(s.chosen);
    expect(s.options.some((o) => o.child === s.chosen), label).toBe(true);
    expect(s.page).toBe(s.node.split(":")[0]);
  });
  expect(r.end, label).toBe(r.steps[r.steps.length - 1].chosen);
}

describe("library-wide", () => {
  it("every guideline, every moment: rulesOnlyTrail and aiWalk terminate, never throw, and only choose real children", async () => {
    const MAX = 300;
    const stats = { walks: 0, stops: { ask: 0, "not-enough": 0, error: 0, none: 0 } as Record<string, number>, truncated: 0, ai: 0 };
    for (const slug of slugs) {
      const g = load(slug);
      const starts = ["auto", ...moments(g).map((m) => m.page)];
      for (const [name, facts] of [["empty", {} as Facts], ["filled", filled(g)]] as const) {
        for (const start of starts) {
          const label = `${slug} ${start} (${name})`;
          const rules = rulesOnlyTrail(g, facts, start, {}, MAX);
          check(g, rules, MAX, `${label} rules`);
          expect(rules.steps.every((s) => s.by !== "ai"), label).toBe(true);
          for (const [which, score] of [["first", firstChild], ["every", everyChild]] as const) {
            const r = await aiWalk(g, facts, start, { score, maxSteps: MAX });
            check(g, r, MAX, `${label} ${which}`);
            stats.walks++;
            stats.stops[r.stoppedFor ?? "none"]++;
            if (r.truncated) stats.truncated++;
            stats.ai += r.steps.filter((s) => s.by === "ai").length;
            // the model can only extend what the rules reach
            expect(r.steps.length, label).toBeGreaterThanOrEqual(rules.steps.length);
          }
        }
      }
    }
    expect(stats.walks).toBeGreaterThan(500);
    expect(stats.ai).toBeGreaterThan(100);   // the scorer is used somewhere
    expect(stats.stops.error).toBe(0);
    console.log("aiWalk library stats", JSON.stringify(stats));
  }, 600_000);

  it("a clinician override at any step of a real walk is honoured and the walk goes on", async () => {
    const g = load("prostate");
    const base = await aiWalk(g, {}, "auto", { score: everyChild, maxSteps: 60 });
    const branch = base.steps.find((s) => s.by === "ai" && s.options.length > 1);   // (the entry step has no options)
    expect(branch).toBeDefined();
    const other = branch!.options.find((o) => o.child !== branch!.chosen)!.child;
    const forced = await aiWalk(g, {}, "auto", { score: everyChild, maxSteps: 60, overrides: { [branch!.node]: other } });
    const step = forced.steps.find((s) => s.node === branch!.node && s.by !== "entry")!;
    expect(step).toMatchObject({ chosen: other, by: "clinician" });
    expect(forced.steps.map((s) => s.node)).not.toContain(branch!.chosen);
    check(g, forced, 60, "forced");
  }, 60_000);
});
