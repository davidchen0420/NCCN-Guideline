import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph, type Graph } from "../src/lib/graph";
import {
  MAX_QUESTIONS, PAGE_CHARS, aiStatus, branchChildren, buildInput, buildQuestions, clearDecideCache, factLines,
  boxText, isScorable, pageText, predicateInWords, resetAiStatus, scorableNodes, scoreBranches, scoreBranchesDetailed,
  type Answer, type ChoiceQuestion, type Question,
} from "../src/lib/decide";

const load = (slug: string) => buildGraph(adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"))));
const prostate = load("prostate");
const rectal = load("rectal");

const PROS2 = "PROS-2:t_root";          // risk groups: low / intermediate / high / very high
const REC6_OPTS = "REC-6:t0_0_0";       // three treatment options for one clinical stage
const REC6_RESTAGING = "REC-6:t0_0_3";  // restaging: resection vs contraindicated
const FREE_TEXT = "64-year-old man, patient name John Smith, MRN 123456";

const facts = { risk_group: "high", psa_ng_ml: 22, life_expectancy_years: 12, clinical_t_category: "T3a", histology: "adenocarcinoma" };

describe("fact lines and page text", () => {
  it("writes one label: value line per entered fact, schema variables first, then derived values", () => {
    const lines = factLines(prostate, facts);
    expect(lines).toContain("PSA: 22 ng/mL");
    expect(lines).toContain("Risk Group: High");
    expect(lines).toContain("Histology: Adenocarcinoma");
    expect(lines.findIndex((l) => l.startsWith("Risk Group"))).toBeGreaterThanOrEqual(0);
    expect(lines.some((l) => /_/.test(l))).toBe(false);
  });

  it("never sends free text or values outside the schema", () => {
    const lines = factLines(prostate, { ...facts, notes: FREE_TEXT, histology: "John Smith has adenocarcinoma", grade_group: "MRN 123456", psa_ng_ml: "see chart", brca1_2_mutation: "yes please" });
    const all = lines.join("\n");
    expect(all).not.toMatch(/John|Smith|MRN|see chart|yes please/);
    expect(all).not.toMatch(/Notes/);
  });

  it("accepts a range for a number and Yes/No for a flag", () => {
    const lines = factLines(prostate, { life_expectancy_years: { min: 10, max: null, min_open: true, max_open: false }, visceral_metastases_present: false });
    expect(lines).toContain("Life Expectancy: >10 y");
    expect(lines).toContain("Visceral Metastases: No");
  });

  it("page text is in reading order, bounded, and carries the footnotes", () => {
    const t = pageText(prostate, "PROS-2");
    expect(t.length).toBeLessThanOrEqual(PAGE_CHARS);
    expect(t.toLowerCase()).toContain("low");
    expect(pageText(prostate, "PROS-2", 300).length).toBeLessThanOrEqual(300);
    expect(pageText(prostate, "NOPE-1")).toBe("");
  });

  it("input has the patient section and the page text, and nothing else", () => {
    const input = buildInput(prostate, { ...facts, notes: FREE_TEXT }, ["PROS-2"]);
    expect(input.startsWith("Patient (structured answers):\n")).toBe(true);
    expect(input).toContain("PSA: 22 ng/mL");
    expect(input).toContain("\n\nGuideline page text:\n[PROS-2]");
    expect(input).not.toContain("John Smith");
    expect(buildInput(prostate, {}, ["PROS-2"])).toContain("(none entered)");
  });
});

describe("boxText", () => {
  it("drops footnote marks printed after capitals but keeps ordinary words", () => {
    expect(boxText("INDUCTIONe,f,g")).toBe("INDUCTION");
    expect(boxText("Low")).toBe("Low");
    expect(boxText("Very high")).toBe("Very high");
    expect(boxText("High")).toBe("High");
    expect(boxText("cT1c")).toBe("cT1c");
    expect(boxText("Restage with sigmoidoscopy ± MRI\n(12–16 wk)")).toBe("Restage with sigmoidoscopy ± MRI (12–16 wk)");
    expect(boxText("x ".repeat(400)).length).toBeLessThanOrEqual(300);
  });
});

describe("predicateInWords", () => {
  const s = prostate.bundle.schema;
  it("writes leaves, and, or, not", () => {
    expect(predicateInWords({ fact: "risk_group", op: "==", value: "low" }, s)).toBe("Risk Group is Low");
    expect(predicateInWords({ fact: "psa_ng_ml", op: "<", value: 10 }, s)).toBe("PSA is less than 10 ng/mL");
    expect(predicateInWords({ fact: "risk_group", op: "in", value: ["high", "very_high"] }, s)).toBe("Risk Group is one of High, Very High");
    expect(predicateInWords({ all: [{ fact: "risk_group", op: "==", value: "low" }, { any: [{ fact: "psa_ng_ml", op: ">=", value: 20 }, { not: { fact: "visceral_metastases_present", op: "==", value: true } }] }] }, s))
      .toBe("Risk Group is Low and (PSA is at least 20 ng/mL or not (Visceral Metastases is Yes))");
  });
  it("works without a schema", () => {
    expect(predicateInWords({ fact: "some_flag", op: "!=", value: true }, null)).toBe("Some Flag is not Yes");
  });
});

describe("which nodes have something to score", () => {
  it("separates condition arms from options", () => {
    const risk = branchChildren(prostate, PROS2);
    expect(risk.conds).toHaveLength(4);
    expect(risk.opts).toHaveLength(0);
    const opts = branchChildren(rectal, REC6_OPTS);
    expect(opts.opts).toHaveLength(3);
    expect(opts.conds).toHaveLength(0);
    expect(branchChildren(rectal, REC6_RESTAGING).conds).toHaveLength(2);
    expect(isScorable(prostate, "PROS-2:t0_0_4")).toBe(false);   // a single continuing box
    expect(scorableNodes(prostate, "PROS-2")).toContain(PROS2);
    expect(scorableNodes(prostate).length).toBeGreaterThan(20);
  });
});

describe("buildQuestions on real guidelines", () => {
  it("prostate risk groups: one choice question with every arm and 'none'", () => {
    const r = buildQuestions(prostate, facts, [PROS2]);
    expect(r.questions).toHaveLength(1);
    const q = r.questions[0] as ChoiceQuestion;
    expect(q.type).toBe("choice");
    expect(q.name).toBe(`n:${PROS2}`);
    const kids = prostate.kids(PROS2);
    expect(q.choices.map((c) => c.value)).toEqual([...kids, "none"]);
    expect(q.choices.find((c) => c.value === "none")!.description).toBe("None of these applies, or not enough information");
    const low = q.choices.find((c) => c.value === "PROS-2:t0_0_0")!;
    expect(low.description).toBe("Low — Risk Group is Low");
    expect(q.instructions).toMatch(/^Guideline step: .*\. Page: .* \(PROS-2\)\. Choose the branch whose condition the patient's facts satisfy\.$/);
    expect(r.meta[q.name]).toEqual({ kind: "choice", page: "PROS-2", nodes: [PROS2] });
  });

  it("the input has the entered facts and the page text, no free text", () => {
    const r = buildQuestions(prostate, { ...facts, notes: FREE_TEXT }, [PROS2]);
    expect(r.input).toContain("Risk Group: High");
    expect(r.input).toContain("PSA: 22 ng/mL");
    expect(r.input).toContain("Guideline page text:");
    expect(r.input).not.toMatch(/John Smith|MRN/);
    expect(JSON.stringify(r.questions)).not.toMatch(/John Smith|MRN/);
  });

  it("rectal REC-6 table: options become one predicate question each", () => {
    const r = buildQuestions(rectal, { clinical_t_category: "T3" }, [REC6_OPTS]);
    const kids = rectal.kids(REC6_OPTS);
    expect(r.questions.map((q) => q.name)).toEqual(kids.map((k) => `o:${k}`));
    for (const q of r.questions) {
      expect(q.type).toBe("predicate");
      expect(q.instructions.startsWith("This option is appropriate for this patient: ")).toBe(true);
      expect(r.meta[q.name].child).toBe(q.name.slice(2));
    }
    expect(r.questions[0].instructions).toMatch(/Long-course chemo\/RT/);
  });

  it("rectal restaging: a choice between the arms the table encodes", () => {
    const q = buildQuestions(rectal, {}, [REC6_RESTAGING]).questions[0] as ChoiceQuestion;
    expect(q.choices.map((c) => c.value)).toEqual([...rectal.kids(REC6_RESTAGING), "none"]);
    expect(q.choices.some((c) => /Resection contraindicated — .*Resection/i.test(c.description))).toBe(true);
  });

  it("several nodes make unique names, in any mix", () => {
    const nodes = [PROS2, ...scorableNodes(prostate, "PROS-3")];
    const r = buildQuestions(prostate, facts, nodes);
    const names = r.questions.map((q) => q.name);
    expect(new Set(names).size).toBe(names.length);
    expect(buildQuestions(prostate, facts, [PROS2, PROS2]).questions).toHaveLength(1);
    const mix = [...buildQuestions(rectal, {}, [REC6_OPTS, REC6_RESTAGING]).questions];
    expect(mix.map((q: Question) => q.type)).toEqual(["predicate", "predicate", "predicate", "choice"]);
  });

  it("every scorable node of every sampled guideline yields valid, bounded questions", () => {
    for (const g of [prostate, rectal, load("breast"), load("aml")]) {
      for (const id of scorableNodes(g)) {
        const r = buildQuestions(g, {}, [id]);
        expect(r.questions.length, id).toBeGreaterThan(0);
        for (const q of r.questions) {
          expect(q.instructions.length, id).toBeLessThan(2000);
          if (q.type === "choice") {
            expect(q.choices.length).toBeLessThanOrEqual(61);
            expect(new Set(q.choices.map((c) => c.value)).size).toBe(q.choices.length);
            for (const c of q.choices) expect(c.description.length).toBeLessThan(1000);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------- scoring with a mocked fetch

interface Call { url: string; body: { input: string; questions: Question[] } }
/** A fake server: records requests and answers each question with `answer(q)`. */
function mockFetch(answer: (q: Question) => Answer, calls: Call[] = []) {
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body });
    return new Response(JSON.stringify({ answers: body.questions.map(answer) }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, calls };
}
/** Choice: 0.7 on the first arm, the rest shared; predicate: 0.6. */
const defaultAnswer = (q: Question): Answer => {
  if (q.type === "predicate") return { type: "predicate", name: q.name, probability: 0.6 };
  const n = q.choices.length;
  return { type: "choice", name: q.name, choice: q.choices[0].value, confidence: 0.8, probabilities: q.choices.map((c, i) => ({ value: c.value, probability: i === 0 ? 0.7 : 0.3 / (n - 1) })) };
};

describe("scoreBranches", () => {
  beforeEach(() => clearDecideCache());

  it("maps a choice answer onto the children and 'none'", async () => {
    const m = mockFetch(defaultAnswer);
    const out = await scoreBranches(prostate, facts, [PROS2], { fetch: m.fetch });
    const scores = out.get(PROS2)!;
    expect([...scores.keys()]).toEqual([...prostate.kids(PROS2), "none"]);
    expect(scores.get(prostate.kids(PROS2)[0])).toBeCloseTo(0.7);
    expect([...scores.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].url).toBe("/api/decide");
    expect(m.calls[0].body.questions[0].name).toBe(`n:${PROS2}`);
  });

  it("detail carries the model's choice and confidence", async () => {
    const m = mockFetch(defaultAnswer);
    const d = await scoreBranchesDetailed(prostate, facts, [PROS2], { fetch: m.fetch, baseUrl: "http://x:1" });
    expect(d.get(PROS2)!.choice).toBe(prostate.kids(PROS2)[0]);
    expect(d.get(PROS2)!.confidence).toBeCloseTo(0.8);
    expect(m.calls[0].url).toBe("http://x:1/api/decide");
  });

  it("maps option answers to one probability per child", async () => {
    const m = mockFetch((q) => ({ type: "predicate", name: q.name, probability: q.name.endsWith("t0_0_1") ? 0.9 : 0.2 }));
    const out = await scoreBranches(rectal, {}, [REC6_OPTS], { fetch: m.fetch });
    expect(out.get(REC6_OPTS)!.get("REC-6:t0_0_1")).toBe(0.9);
    expect(out.get(REC6_OPTS)!.get("REC-6:t0_2_1")).toBe(0.2);
    expect(out.get(REC6_OPTS)!.has("none")).toBe(false);
  });

  it("batches at most 16 questions per request", async () => {
    const nodes = scorableNodes(prostate);
    const total = buildQuestions(prostate, facts, nodes).questions.length;
    expect(total).toBeGreaterThan(MAX_QUESTIONS);
    const m = mockFetch(defaultAnswer);
    const out = await scoreBranches(prostate, facts, nodes, { fetch: m.fetch });
    expect(m.calls.length).toBe(Math.ceil(total / MAX_QUESTIONS));
    for (const c of m.calls) {
      expect(c.body.questions.length).toBeLessThanOrEqual(MAX_QUESTIONS);
      expect(JSON.stringify(c.body).length).toBeLessThan(200 * 1024);
      expect(new Set(c.body.questions.map((q) => q.name)).size).toBe(c.body.questions.length);
    }
    expect(m.calls.reduce((a, c) => a + c.body.questions.length, 0)).toBe(total);
    expect(out.size).toBe(nodes.length);
    for (const id of nodes) expect(out.get(id)!.size, id).toBeGreaterThan(0);
  });

  it("two requests for 17 questions", async () => {
    const opts = rectal.kids(REC6_OPTS);
    expect(opts.length).toBe(3);
    // 17 option questions: the options of several rectal nodes
    const nodes = scorableNodes(rectal).filter((id) => branchChildren(rectal, id).opts.length);
    let picked: string[] = [], n = 0;
    for (const id of nodes) { if (n >= 17) break; picked.push(id); n = buildQuestions(rectal, {}, picked).questions.length; }
    expect(n).toBeGreaterThanOrEqual(17);
    const m = mockFetch(defaultAnswer);
    await scoreBranches(rectal, {}, picked, { fetch: m.fetch });
    expect(m.calls.length).toBe(Math.ceil(n / MAX_QUESTIONS));
    expect(m.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("remembers results by node and facts", async () => {
    const m = mockFetch(defaultAnswer);
    await scoreBranches(prostate, facts, [PROS2], { fetch: m.fetch });
    await scoreBranches(prostate, { ...facts, notes: "ignored" }, [PROS2], { fetch: m.fetch });   // same structured facts
    expect(m.calls).toHaveLength(1);
    await scoreBranches(prostate, { ...facts, psa_ng_ml: 4 }, [PROS2], { fetch: m.fetch });
    expect(m.calls).toHaveLength(2);
    await scoreBranches(prostate, facts, [PROS2, "PROS-3:n272_26"], { fetch: m.fetch });          // a new node asks only for itself
    expect(m.calls.slice(2).flatMap((c) => c.body.questions.map((q) => q.name))).not.toContain(`n:${PROS2}`);
  });

  it("a refusal gives an empty map for that node and is not remembered", async () => {
    const refuse = mockFetch((q) => ({ type: "refusal", name: q.name }));
    const out = await scoreBranches(prostate, facts, [PROS2], { fetch: refuse.fetch });
    expect(out.has(PROS2)).toBe(true);
    expect(out.get(PROS2)!.size).toBe(0);
    const ok = mockFetch(defaultAnswer);
    const again = await scoreBranches(prostate, facts, [PROS2], { fetch: ok.fetch });
    expect(ok.calls).toHaveLength(1);
    expect(again.get(PROS2)!.size).toBeGreaterThan(0);
  });

  it("a refusal on one question leaves the others", async () => {
    const m = mockFetch((q) => (q.name.endsWith("t0_0_1") ? { type: "refusal", name: q.name } : { type: "predicate", name: q.name, probability: 0.4 }));
    const out = (await scoreBranches(rectal, {}, [REC6_OPTS], { fetch: m.fetch })).get(REC6_OPTS)!;
    expect(out.has("REC-6:t0_0_1")).toBe(false);
    expect(out.get("REC-6:t0_2_1")).toBe(0.4);
  });

  it("ignores malformed probabilities and answers out of order", async () => {
    const fetchFn = (async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { questions: Question[] };
      const answers = [...body.questions].reverse().map((q) => ({ type: "predicate", name: q.name, probability: q.name.endsWith("t0_0_1") ? 7 : q.name.endsWith("t0_2_1") ? "high" : 0.5 }));
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = (await scoreBranches(rectal, {}, [REC6_OPTS], { fetch: fetchFn })).get(REC6_OPTS)!;
    expect(out.get("REC-6:t0_0_1")).toBe(1);               // clamped
    expect(out.has("REC-6:t0_2_1")).toBe(false);           // not a number
    expect(out.get("REC-6:t0_4_1")).toBe(0.5);             // matched by name, not position
  });

  it("nodes with nothing to score get an empty map and no request", async () => {
    const m = mockFetch(defaultAnswer);
    const out = await scoreBranches(prostate, facts, ["PROS-2:t0_0_4", "NOPE:1"], { fetch: m.fetch });
    expect(out.get("PROS-2:t0_0_4")!.size).toBe(0);
    expect(out.get("NOPE:1")!.size).toBe(0);
    expect(m.calls).toHaveLength(0);
  });

  it("server errors surface as DecideError with the server's message", async () => {
    const f = (async () => new Response(JSON.stringify({ error: "AI decisions are off" }), { status: 503 })) as unknown as typeof fetch;
    await expect(scoreBranches(prostate, facts, [PROS2], { fetch: f })).rejects.toMatchObject({ name: "DecideError", status: 503, message: "AI decisions are off" });
    const down = (async () => { throw new TypeError("failed to fetch"); }) as unknown as typeof fetch;
    await expect(scoreBranches(prostate, facts, [PROS2], { fetch: down })).rejects.toMatchObject({ name: "DecideError" });
    const junk = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    await expect(scoreBranches(prostate, facts, [PROS2], { fetch: junk })).rejects.toMatchObject({ name: "DecideError" });
  });
});

describe("aiStatus", () => {
  beforeEach(() => resetAiStatus());
  const json = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("returns the server's status once and remembers it", async () => {
    let n = 0;
    const f = (async () => { n++; return new Response(JSON.stringify({ enabled: true, model: "m" }), { status: 200 }); }) as unknown as typeof fetch;
    expect(await aiStatus({ fetch: f })).toEqual({ enabled: true, model: "m" });
    expect(await aiStatus({ fetch: f })).toEqual({ enabled: true, model: "m" });
    expect(n).toBe(1);
  });
  it("is null for a static server, bad payloads and network failures", async () => {
    expect(await aiStatus({ fetch: json({}, 404) })).toBeNull();
    resetAiStatus();
    expect(await aiStatus({ fetch: json({ enabled: "yes" }) })).toBeNull();
    resetAiStatus();
    const down = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(await aiStatus({ fetch: down })).toBeNull();
    // a failed network call is not remembered
    expect(await aiStatus({ fetch: json({ enabled: false, model: "m" }) })).toEqual({ enabled: false, model: "m" });
  });
});
