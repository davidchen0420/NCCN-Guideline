/**
 * What the reader shows of the AI-assisted walk: the trail's one-line summary, the card line, the
 * arrow labels, which of the clinician's choices still apply, the choices' effect on the
 * recommendation, the saved settings and the hook's first (synchronous) answer. No network.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { adaptGuideline } from "../src/lib/adapt";
import type { Bundle } from "../src/types";
import { buildGraph } from "../src/lib/graph";
import { rankPathways } from "../src/lib/pathways";
import { NONE } from "../src/lib/decide";
import { aiWalk, rulesOnlyTrail, type ScoreFn } from "../src/lib/aiWalk";
import { aiAssistedLine, byTag, clipText, decisionByChosen, decisionSteps, edgeTags, favouredByAi, percent, questionParts, questionText, readable, staleOverrides, stripGlyphs, trailStats, trailSummary, trimToRoute } from "../src/lib/trailView";
import { AI_THRESHOLD_DEFAULT, clampThreshold, readAiEnabled, readAiThreshold } from "../src/lib/prefs";
import { cleanOverrides } from "../src/lib/patient";
import { trailKey, useAiTrail, type AiTrail } from "../src/lib/useAiTrail";

const g = buildGraph(JSON.parse(readFileSync(new URL("../public/sample-bundle.json", import.meta.url), "utf8")) as Bundle);
const S1 = { n1: "SAMPLE-1:n1", n2: "SAMPLE-1:n2", high: "SAMPLE-1:n3", low: "SAMPLE-1:n4" };
const S2 = { entry: "SAMPLE-2:n1", old: "SAMPLE-2:n2", young: "SAMPLE-2:n3" };

const mock = (table: Record<string, Record<string, number>>): ScoreFn => async (_g, _f, ids) =>
  new Map(ids.filter((id) => table[id]).map((id) => [id, new Map(Object.entries(table[id]))] as const));

describe("the one-line summary", () => {
  it("counts decisions by who made them, with the AI part only when AI is on", async () => {
    const r = await aiWalk(g, { score: 12 }, "SAMPLE-1", { score: mock({ [S2.entry]: { [S2.old]: 0.1, [S2.young]: 0.9 } }) });
    const st = trailStats(r);
    expect(st).toMatchObject({ total: 2, rule: 1, ai: 1, clinician: 0, lowestAi: 0.9 });
    expect(trailSummary(st, true)).toBe("2 decisions · 1 by the guideline rule · 1 by AI (lowest 90%) · 0 by you");
    expect(trailSummary(st, false)).toBe("2 decisions · 1 by the guideline rule · 0 by you");
  });

  it("names the lowest AI confidence among several AI steps", () => {
    const st = { total: 7, rule: 5, ai: 2, clinician: 0, lowestAi: 0.86 };
    expect(trailSummary(st, true)).toBe("7 decisions · 5 by the guideline rules · 2 by AI (lowest 86%) · 0 by you");
    expect(aiAssistedLine(st)).toBe("AI-assisted: 2 of 7 decisions chosen by the AI (lowest 86%). Review in How we got here.");
  });

  it("says nothing about AI help when the AI chose nothing", () => {
    expect(aiAssistedLine({ total: 3, rule: 3, ai: 0, clinician: 0 })).toBeNull();
    expect(trailSummary({ total: 1, rule: 1, ai: 0, clinician: 0 }, true)).toBe("1 decision · 1 by the guideline rule · 0 by AI · 0 by you");
  });

  it("does not count the start or a single arrow as a decision", () => {
    const r = rulesOnlyTrail(g, { score: 12, age: 70 }, "SAMPLE-1");
    expect(r.steps.some((s) => s.by === "entry")).toBe(true);
    expect(r.steps.some((s) => s.by === "single")).toBe(true);
    expect(decisionSteps(r).every((s) => ["rule", "ai", "clinician"].includes(s.by))).toBe(true);
    expect(trailStats(r).total).toBe(decisionSteps(r).length);
  });

  it("percentages never round a real probability to 0% or 100%", () => {
    expect([percent(0.855), percent(0.004), percent(0.998), percent(1), percent(0)]).toEqual(["86%", "1%", "99%", "100%", "0%"]);
  });
});

describe("a clinician's choice", () => {
  it("changes the recommendation, and the walk after it", async () => {
    const top = (o?: Record<string, string>) => rankPathways(g, { score: 12 }, "SAMPLE-1", { overrides: o }).paths[0];
    const before = top();
    expect(before.steps.map((s) => s.node)).toContain(S1.high);
    const after = top({ [S1.n2]: S1.low });
    expect(after.steps.map((s) => s.node)).toContain(S1.low);
    expect(after.steps.map((s) => s.node)).not.toContain(S1.high);
    expect(rankPathways(g, { score: 12 }, "SAMPLE-1", { overrides: { [S1.n2]: S1.low } }).paths.every((p) => !p.steps.some((s) => s.node === S1.high))).toBe(true);
    // the walk agrees
    const r = rulesOnlyTrail(g, { score: 12 }, "SAMPLE-1", { [S1.n2]: S1.low });
    expect(r.steps.find((s) => s.node === S1.n2)).toMatchObject({ chosen: S1.low, by: "clinician" });
    expect(trailStats(r).clinician).toBe(1);
  });

  it("a choice for a box the route never reaches changes nothing", () => {
    const a = rankPathways(g, { score: 12 }, "SAMPLE-1").paths.map((p) => p.id);
    const b = rankPathways(g, { score: 12 }, "SAMPLE-1", { overrides: { "SAMPLE-9:zz": "SAMPLE-9:yy" } }).paths.map((p) => p.id);
    expect(b).toEqual(a);
  });

  it("is dropped when its box is no longer on the route, kept while it is", async () => {
    const ov = { [S2.entry]: S2.young };
    // score 12 reaches SAMPLE-2:n1 (the choice applies); with the AI unsure there it stops at that box (kept)
    const ok = await aiWalk(g, { score: 12 }, "SAMPLE-1", { overrides: ov, score: mock({}) });
    expect(staleOverrides(ok, ov)).toEqual([]);
    // a score that ends the route before the box: the choice is dropped
    const gone = rulesOnlyTrail(g, { score: 3 }, "SAMPLE-1", ov);
    expect(gone.steps.some((s) => s.node === S2.entry)).toBe(false);
    expect(gone.stoppedFor).toBeUndefined();   // the walk ended: the choice can be judged
    expect(staleOverrides(gone, ov)).toEqual([S2.entry]);
  });

  it("is dropped when the child is no longer one of the arms; never judged on an error or a walk that stopped earlier", () => {
    const bad = { [S1.n2]: "SAMPLE-1:nope" };
    expect(staleOverrides(rulesOnlyTrail(g, { score: 12 }, "SAMPLE-1", bad), bad)).toEqual([S1.n2]);
    expect(staleOverrides({ steps: [], end: "x", stoppedFor: "error" }, { a: "b" })).toEqual([]);
    expect(staleOverrides({ steps: [], end: "x", stoppedFor: "ask", options: [] }, { deeper: "b" })).toEqual([]);
    expect(staleOverrides({ steps: [], end: "x", stoppedFor: "ask", options: [] }, { x: "b" })).toEqual(["x"]);
  });
});

describe("the trail follows the recommendation shown", () => {
  it("keeps the decisions on the route and drops those after where it ends, and a stop it does not reach", async () => {
    const r = await aiWalk(g, { score: 12 }, "SAMPLE-1", { score: mock({ [S2.entry]: { [S2.old]: 0.1, [S2.young]: 0.9 } }) });
    const all = new Set(r.steps.map((s) => s.node).concat(r.steps.map((s) => s.chosen)));
    expect(decisionSteps(trimToRoute(r, all))).toEqual(decisionSteps(r));
    const upTo = new Set([S1.n1, S1.n2, S1.high]);
    const cut = trimToRoute(r, upTo);
    expect(decisionSteps(cut).map((s) => s.node)).toEqual([S1.n2]);
    expect(trailStats(cut).ai).toBe(0);
    const ask = await aiWalk(g, {}, "SAMPLE-1", { score: mock({}) });
    expect(trimToRoute(ask, new Set([S1.n1])).stoppedFor).toBeUndefined();
    expect(trimToRoute(ask, new Set([S1.n1, S1.n2])).stoppedFor).toBe("ask");
  });
});

describe("labels on the diagram", () => {
  it("says who chose each arrow, and marks the ones the AI was less sure of than the threshold", async () => {
    const r = await aiWalk(g, { score: 12 }, "SAMPLE-1", { score: mock({ [S2.entry]: { [S2.old]: 0.4, [S2.young]: 0.6 } }), overrides: { [S2.entry]: S2.young } });
    const tags = edgeTags(r, 0.85);
    expect(tags.get(`${S1.n2}>${S1.high}`)).toEqual({ text: "Rule", low: false });
    expect(tags.get(`${S2.entry}>${S2.young}`)).toEqual({ text: "You", low: true });
    const ai = await aiWalk(g, { score: 12 }, "SAMPLE-1", { score: mock({ [S2.entry]: { [S2.old]: 0.05, [S2.young]: 0.95 } }) });
    expect(edgeTags(ai, 0.85).get(`${S2.entry}>${S2.young}`)).toEqual({ text: "95%", low: false });
  });
});

describe("the questions and the disagreement note", () => {
  it("the virtual start reads as a question; a box reads as its own text", () => {
    expect(questionText(g, "SAMPLE-1:START")).toBe("Which starting point applies?");
    expect(questionText(g, S1.n2).length).toBeGreaterThan(0);
  });
  it("a box that is not a question is headed by its page, with its text kept apart", () => {
    const { heading, text } = questionParts(g, S1.n2);
    if (/\?\s*$/.test(questionText(g, S1.n2))) expect(text).toBeNull();
    else { expect(heading).toMatch(/^Choice on /); expect(text).toBe(questionText(g, S1.n2)); }
    expect(questionParts(g, "SAMPLE-1:START")).toEqual({ heading: "Which starting point applies?", text: null });
    const rectal = buildGraph(adaptGuideline(JSON.parse(readFileSync("../data/rectal/guideline.json", "utf8"))));
    const bullets = questionParts(rectal, "REC-2:n138_181");   // "• Biopsy • MMR/MSI testing …"
    expect(bullets.heading).toMatch(/^Choice on Clinical Presentation \(REC-2\)$/);
    expect(bullets.text).toContain("Biopsy");
  });
  it("private-use glyphs are dropped and a page code appears once", () => {
    expect(stripGlyphs("exam Axillary and including� \u0017x")).toBe("exam Axillary and including x");
    expect(clipText("😀".repeat(10), 5)).toBe("😀😀😀😀…");   // cut on characters, not UTF-16 halves
    const nsclc = buildGraph(adaptGuideline(JSON.parse(readFileSync("../data/nsclc/guideline.json", "utf8"))));
    expect(readable(nsclc, "NSCL-20")).not.toMatch(/\(NSCL-20\).*\(NSCL-20\)/);
    expect(readable(nsclc, "NSCL-20").match(/NSCL-20/g)!.length).toBe(1);
  });
  it("says how each step was decided, for the summary", () => {
    const mk = (by: "rule" | "ai" | "clinician", prob?: number) => ({ node: "a", page: "p", chosen: "b", by, options: [], ...(prob !== undefined ? { prob } : {}) });
    expect([byTag(mk("rule")), byTag(mk("ai", 0.93)), byTag(mk("clinician"))]).toEqual(["guideline rule", "AI 93%", "you chose"]);
    expect(decisionByChosen({ steps: [{ ...mk("rule"), options: [{ child: "b", text: "B", verdict: true, source: "rule" as const }, { child: "c", text: "C", verdict: false, source: "rule" as const }] }] }).get("b")?.by).toBe("rule");
  });
  it("favouredByAi is the AI's top option when it is not the one followed", () => {
    const step = { node: "a", page: "p", chosen: "x", by: "rule" as const, disagree: true, options: [
      { child: "x", text: "X", verdict: true, source: "rule" as const, prob: 0.03 },
      { child: "y", text: "Y", verdict: false, source: "rule" as const, prob: 0.91 },
    ] };
    expect(favouredByAi(step)?.child).toBe("y");
    expect(favouredByAi({ ...step, chosen: "y" })).toBeNull();
  });
});

describe("saved settings and choices", () => {
  it("the threshold stays inside 50%..99% and falls back to 85%", () => {
    expect(clampThreshold(0.3)).toBe(0.5);
    expect(clampThreshold(1)).toBe(0.99);
    expect(clampThreshold("0.9")).toBe(0.9);
    expect(clampThreshold("abc")).toBe(AI_THRESHOLD_DEFAULT);
    expect(clampThreshold(undefined)).toBe(0.85);
  });
  it("with no storage (blocked or a bare page) AI is on and the threshold is the default", () => {
    expect(readAiEnabled()).toBe(true);
    expect(readAiThreshold()).toBe(0.85);
  });
  it("only well-formed choices are kept", () => {
    expect(cleanOverrides({ "A:1": "A:2", bad: 3, "": "x", "B:1": "" })).toEqual({ "A:1": "A:2" });
    expect(cleanOverrides(null)).toEqual({});
    expect(cleanOverrides(["a"])).toEqual({});
  });
});

describe("useAiTrail", () => {
  /** The first render of the hook (effects do not run): what the reader sees before any AI answer. */
  function first(enabled: boolean, overrides: Record<string, string> = {}): AiTrail {
    let out!: AiTrail;
    const C = () => { out = useAiTrail(g, { score: 12 }, "SAMPLE-1", overrides, { enabled, score: mock({ [NONE]: {} }) }); return null; };
    renderToString(createElement(C));
    return out;
  }
  it("always has the rules-only trail at once, with AI off or on", () => {
    const off = first(false);
    expect(off.rules.steps.length).toBeGreaterThan(1);
    expect(off.trail).toBe(off.rules);
    expect(off).toMatchObject({ ai: null, loading: false, settled: true, failed: false, edgeProb: undefined });
    const on = first(true);
    expect(on.trail).toBe(on.rules);          // the rules show while the AI is asked
    expect(on).toMatchObject({ ai: null, loading: true, settled: false });
  });
  it("does not ask the AI about a blank patient (nothing entered, no choices)", () => {
    let out!: AiTrail;
    const C = () => { out = useAiTrail(g, {}, "SAMPLE-1", {}, { enabled: true, score: mock({ [NONE]: {} }) }); return null; };
    renderToString(createElement(C));
    expect(out).toMatchObject({ ai: null, loading: false, settled: true });
    // answers that are all "don't know" are blank as well; a choice or a real answer is not
    let withChoice!: AiTrail;
    const D = () => { withChoice = useAiTrail(g, { score: "unknown" }, "SAMPLE-1", { [S1.n2]: S1.low }, { enabled: true, score: mock({}) }); return null; };
    renderToString(createElement(D));
    expect(withChoice.loading).toBe(true);
  });
  it("the rules trail applies the clinician's choices", () => {
    expect(first(false, { [S1.n2]: S1.low }).trail.steps.find((s) => s.node === S1.n2)).toMatchObject({ chosen: S1.low, by: "clinician" });
  });
  it("the key changes with the answers, the choices and the threshold, and ignores the threshold when AI is off", () => {
    const k = (o: Record<string, string>, en: boolean, t: number) => trailKey(g, { score: 12 }, "SAMPLE-1", o, en, t);
    expect(k({}, true, 0.85)).not.toBe(k({ a: "b" }, true, 0.85));
    expect(k({}, true, 0.85)).not.toBe(k({}, true, 0.9));
    expect(k({}, false, 0.85)).toBe(k({}, false, 0.9));
  });
});

describe("the walk and the recommendation follow the same route", () => {
  it("an option the patient already received is followed by its own rule (as rankPathways infers it)", () => {
    const pros = buildGraph(adaptGuideline(JSON.parse(readFileSync("../data/prostate/guideline.json", "utf8"))));
    const v1 = JSON.parse(readFileSync("../data/prostate/vignettes/examples.json", "utf8")).find((e: { id: string }) => e.id === "V1");
    const r = rulesOnlyTrail(pros, v1.facts, "auto");
    const top = rankPathways(pros, v1.facts, "auto").paths[0];
    const onRoute = new Set(top.steps.map((s) => s.node));
    const step = r.steps.find((s) => /^Radical prostatectomy/i.test(pros.node(s.chosen)?.text ?? ""));
    expect(step).toMatchObject({ by: "rule" });
    expect(onRoute.has(step!.chosen)).toBe(true);
  });
});
