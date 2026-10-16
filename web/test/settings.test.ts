import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { adaptGuideline } from "../src/lib/adapt";
import { buildGraph } from "../src/lib/graph";
import { MAX_CHOICES, PHASES, askableQuestions, hasOwnEntry, impliedBySection, moments, momentsFor, onlyCodes, reaches, settingChoices, settingsFor, type Setting } from "../src/lib/moments";
import { isRecommendationEnd, rankPathways } from "../src/lib/pathways";

const slugs = readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`)).sort();
const load = (slug: string) => buildGraph(adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8"))));

interface Variant { section: string; needs: { need: string; settings: Setting[] }[] }
const variantsOf = (slug: string) => {
  const g = load(slug);
  const all = moments(g);
  const sec = g.bundle.sections;
  const lists: [string, ReturnType<typeof moments>][] = sec
    ? sec.values.map((v) => [v, momentsFor(g, all, { [sec.variable]: v })])
    : [["", all]];
  const variants: Variant[] = lists.map(([section, list]) => ({
    section,
    needs: PHASES.map((p) => ({ need: p.id, settings: settingsFor(g, list, p.id) })).filter((n) => n.settings.length),
  }));
  return { g, variants, title: g.bundle.title };
};

const mapped = slugs.map((slug) => ({ slug, ...variantsOf(slug) }));

describe("the need and setting offered for every guideline", () => {
  it("every guideline (and every disease or subtype) offers at least one need", () => {
    for (const m of mapped) for (const v of m.variants) expect(v.needs.length, `${m.slug} [${v.section}]`).toBeGreaterThan(0);
  });

  it("every guideline offers a first workup or its programme equivalent (some subtypes only start later)", () => {
    for (const m of mapped) expect(m.variants.some((v) => v.needs.some((n) => n.need === "diagnosis")), m.slug).toBe(true);
  });

  it("every disease offers a Workup & first treatment that starts at its own page, not at a shared list of diseases", () => {
    for (const m of mapped) {
      const sec = m.g.bundle.sections;
      for (const v of m.variants) {
        const dx = v.needs.find((n) => n.need === "diagnosis");
        if (!sec) { expect(dx, `${m.slug}: no first workup`).toBeTruthy(); continue; }
        if (!dx) continue;   // (a subtype that only starts later: histologic transformation, a recurrent glioma page)
        const own = dx.settings.filter((s) => sec.pages[s.page] === v.section);
        const shared = dx.settings.filter((s) => !sec.pages[s.page]);
        expect(own.length + shared.length, `${m.slug} [${v.section}]`).toBeGreaterThan(0);
        // a shared page that stays must say a setting of the patient (every entry box has a condition), and the disease has its own page too
        for (const s of shared) {
          const roots = m.g.bundle.roots[s.page] ?? [];
          expect(roots.every((r) => m.g.preds[r]) || own.length === 0, `${m.slug} [${v.section}]: shared page ${s.page} lists steps, not a setting`).toBe(true);
        }
      }
    }
  });

  it("the audited guidelines offer the settings clinicians look for", () => {
    const by = (slug: string) => mapped.find((m) => m.slug === slug)!;
    const pages = (slug: string, need: string, section = "") => (by(slug).variants.find((v) => v.section === section)?.needs.find((n) => n.need === need)?.settings ?? []).map((s) => s.page);
    // NSCLC: the lung cancer's own first page (NSCL-1), not only the nodule page; and the page after surgery
    expect(pages("nsclc", "diagnosis")).toContain("NSCL-1");
    expect(pages("nsclc", "diagnosis")).toContain("NSCL-4");
    expect(pages("nsclc", "advanced")).toEqual(expect.arrayContaining(["NSCL-15", "NSCL-19"]));
    // multiple myeloma starts at the initial workup, not at the CNS myeloma page that two pages link to
    expect(pages("multiple_myeloma", "diagnosis")[0]).toBe("MYEL-1");
    expect(pages("multiple_myeloma", "diagnosis")).not.toContain("CNSM-1");
    // colon: follow-up, recurrence at the recurrence page, and the pathologic stage page after resection
    for (const sec of ["pMMR/MSS Colon Cancer", "dMMR/MSI-H Colon Cancer"]) {
      expect(pages("colon", "followup", sec), sec).toContain("COL-8");
      expect(pages("colon", "recurrence", sec), sec).toEqual(["COL-9"]);
      const after = by("colon").variants.find((v) => v.section === sec)!.needs.find((n) => n.need === "diagnosis")!.settings.filter((s) => s.post);
      expect(after.length, `${sec}: an after-resection setting`).toBeGreaterThan(0);
      expect(after[0].label).toMatch(/^After surgery: /);
    }
    // breast: stage IV or recurrent disease (BINV-18) is metastatic as well as recurrent
    expect(pages("breast", "advanced", "Invasive Breast Cancer")).toContain("BINV-18");
    expect(pages("breast", "recurrence", "Invasive Breast Cancer")).toContain("BINV-18");
    // DLBCL starts at its own workup page; follicular and the other lymphomas at theirs
    expect(pages("b_cell_lymphomas", "diagnosis", "Diffuse Large B-Cell Lymphoma")).toEqual(["BCEL-1"]);
    expect(pages("b_cell_lymphomas", "diagnosis", "Classic Follicular Lymphoma")).toEqual(["FOLL-2"]);
  });

  it("no setting is a dead end: it either has something to ask or leads to a recommendation", () => {
    for (const m of mapped) {
      const sec = m.g.bundle.sections;
      for (const v of m.variants) for (const n of v.needs) for (const s of n.settings) {
        const facts: Record<string, unknown> = { ...(sec ? { [sec.variable]: v.section, ...impliedBySection(m.g, v.section) } : {}), ...s.implied };
        const r = rankPathways(m.g, facts, s.page);
        const q = askableQuestions(m.g, r, facts, s.page, (f) => f !== sec?.variable);
        expect(q.length > 0 || r.paths.some(isRecommendationEnd), `${m.slug} [${v.section}] ${n.need} ${s.page}: nothing to ask and no recommendation`).toBe(true);
      }
    }
  }, 120_000);

  it("a chosen subtype answers the questions it states (pMMR/MSS colon cancer: mismatch repair status)", () => {
    const colon = mapped.find((m) => m.slug === "colon")!.g;
    expect(impliedBySection(colon, "pMMR/MSS Colon Cancer")).toEqual({ mismatch_repair_status: "pMMR_MSS" });
    expect(impliedBySection(colon, "dMMR/MSI-H Colon Cancer")).toEqual({ mismatch_repair_status: "dMMR_MSI_H" });
    const rectal = mapped.find((m) => m.slug === "rectal")!.g;
    expect(impliedBySection(rectal, "pMMR/MSS Rectal Cancer").mismatch_repair_status).toBe("pMMR_MSS");
    // a word most subtypes share names none of them
    const tcell = mapped.find((m) => m.slug === "t_cell_lymphomas")!.g;
    expect(impliedBySection(tcell, "Peripheral T-Cell Lymphomas")).toEqual({});
  });

  it("no setting is a page another setting of the same need leads to; labels are plain text", () => {
    for (const m of mapped) for (const v of m.variants) for (const n of v.needs) {
      const where = `${m.slug} [${v.section}] ${n.need}`;
      for (const a of n.settings) for (const b of n.settings) if (a.page !== b.page && (!b.post || a.post) && !reaches(m.g, b.page, a.page) && !hasOwnEntry(m.g, b.page, a.page)) expect(reaches(m.g, a.page, b.page), `${where}: ${a.page} leads to ${b.page}`).toBe(false);
      expect(new Set(n.settings.map((s) => s.page)).size, `${where}: a page twice`).toBe(n.settings.length);
      for (const s of n.settings) {
        expect(s.label.trim().length, `${where} ${s.page}: empty label`).toBeGreaterThan(2);
        expect(/^[A-Z]{1,8}-\d+[A-Z]?(\s|$)/.test(s.label.trim()) && s.label.replace(/[^a-z]/gi, "").length < 8, `${where} ${s.page}: only a code ("${s.label}")`).toBe(false);
        expect(onlyCodes(s.label), `${where} ${s.page}: the label is a code ("${s.label}")`).toBe(false);
        expect(/[a-z]{3}/i.test(s.label), `${where} ${s.page}: no words ("${s.label}")`).toBe(true);
        expect(/[•◦▪]/.test(s.label), `${where} ${s.page}: a bullet list ("${s.label}")`).toBe(false);
      }
    }
  });

  it("a need offers at most six choices: settings picked by the same detail are grouped, never a long flat list", () => {
    for (const m of mapped) for (const v of m.variants) for (const n of v.needs) {
      const where = `${m.slug} [${v.section}] ${n.need}`;
      const choices = settingChoices(n.settings);
      expect(choices.length, `${where}: ${choices.length} choices`).toBeLessThanOrEqual(MAX_CHOICES);
      for (const c of choices) if (c.group) {
        expect(c.settings.length, `${where}: group "${c.group.label}"`).toBeGreaterThanOrEqual(3);
        expect(onlyCodes(c.group.label) || !/[a-z]{3}/i.test(c.group.label), `${where}: group name "${c.group.label}"`).toBe(false);
      }
      // (a group lists every one of its settings: nothing is lost by grouping)
      expect(choices.reduce((k, c) => k + (c.group ? c.settings.length : 1), 0), where).toBe(n.settings.length);
    }
  });

  it("no two settings of a need share a name, and no name is only a page code", () => {
    for (const m of mapped) for (const v of m.variants) for (const n of v.needs) {
      const names = n.settings.map((s) => s.label.toLowerCase().replace(/[^a-z0-9]/g, ""));
      expect(new Set(names).size, `${m.slug} [${v.section}] ${n.need}: ${n.settings.map((s) => s.label).join(" | ")}`).toBe(names.length);
      for (const s of n.settings) expect(s.label.length, `${m.slug} ${s.page}: label length`).toBeLessThanOrEqual(100);
    }
  });

  it("the second line of a setting is a short whole description, not a cut-off fragment or a bullet list", () => {
    for (const m of mapped) for (const v of m.variants) for (const n of v.needs) for (const s of n.settings) {
      const where = `${m.slug} [${v.section}] ${n.need} ${s.page}: "${s.sub}"`;
      expect(s.sub.length, where).toBeLessThanOrEqual(80);
      expect(/[•◦▪]|;\s*$|…$/.test(s.sub), where).toBe(false);
      expect(s.sub.toLowerCase() === s.label.toLowerCase(), where).toBe(false);
    }
  });

  it("a page that only other diseases' pages lead to is not offered for the patient's disease (genetic colorectal, glioma recurrence)", () => {
    const by = (slug: string) => mapped.find((m) => m.slug === slug)!;
    const pagesOf = (slug: string, section: string) => by(slug).variants.find((v) => v.section === section)!.needs.flatMap((n) => n.settings.map((s) => s.page));
    // the attenuated-FAP and classical-FAP follow-up pages belong to the polyposis diseases, not to Lynch syndrome
    expect(pagesOf("genetic_familial_high_risk_assessment_colorectal", "Lynch Syndrome")).not.toEqual(expect.arrayContaining(["AFAP-1"]));
    expect(pagesOf("genetic_familial_high_risk_assessment_colorectal", "Lynch Syndrome")).not.toEqual(expect.arrayContaining(["FAP-2"]));
    expect(pagesOf("genetic_familial_high_risk_assessment_colorectal", "APC-Associated Polyposis")).toEqual(expect.arrayContaining(["AFAP-1", "FAP-2"]));
    const glio = by("central_nervous_system");
    expect(glio.variants.find((v) => v.section === "Adult Medulloblastoma")!.needs.flatMap((n) => n.settings.map((s) => s.page))).not.toContain("GLIO-7");
  });

  it("many toxicities or sites that differ by one detail form one group (immune checkpoint toxicities, pediatric sarcoma sites)", () => {
    const by = (slug: string) => mapped.find((m) => m.slug === slug)!;
    for (const [slug, min] of [["management_of_immune_checkpoint_inhibitor_relate", 10], ["pediatric_soft_tissue_sarcoma", 5]] as const) {
      const dx = by(slug).variants[0].needs.find((n) => n.need === "diagnosis")!;
      const groups = settingChoices(dx.settings).filter((c) => c.group);
      expect(groups.length, slug).toBe(1);
      expect((groups[0] as { settings: Setting[] }).settings.length, slug).toBeGreaterThanOrEqual(min);
    }
  });

  it("writes the table to reports/settings-map.md", () => {
    const out: string[] = [
      "# Need and setting offered, per guideline", "",
      "Generated by `web/test/settings.test.ts` from the guideline data (no per-guideline rules). A guideline lists the needs below as chips; a need with several",
      "settings lists them (plain words first, then the algorithm page); a need with one setting starts there at once. Pages another setting of the same need leads",
      "to are not offered; a page that only other diseases' pages lead to is not offered for this disease. Past six, settings picked by the same detail are grouped",
      "(shown as `[By ...]` before the name; the group is one line that opens the list). `Second line` is the short description under the name. `fills` are the details",
      "the setting itself states (entered for the clinician, shown in Entered so far).", "",
    ];
    let withDiagnosis = 0, multi = 0;
    for (const m of mapped) {
      out.push(`## ${m.title} (\`${m.slug}\`)`, "");
      if (m.variants.some((v) => v.needs.some((n) => n.need === "diagnosis"))) withDiagnosis++;
      for (const v of m.variants) {
        if (v.section) out.push(`### ${v.section}`, "");
        out.push("| Need | Setting | Second line | Start page | Fills |", "|---|---|---|---|---|");
        for (const n of v.needs) {
          const label = PHASES.find((p) => p.id === n.need)!.label;
          if (n.settings.length > 1) multi++;
          n.settings.forEach((s, i) => out.push(`| ${i === 0 ? label : ""} | ${s.group ? `[${s.group.label}] ` : ""}${s.label.replace(/\|/g, "/")} | ${s.sub.replace(/\|/g, "/")} | ${s.page} ${s.byTitle ? "" : `(${s.title.replace(/\|/g, "/")})`} | ${Object.entries(s.implied).map(([k, x]) => `${k}=${String(x)}`).join(", ")} |`));
        }
        out.push("");
      }
    }
    out.splice(8, 0, `${mapped.length} guidelines; ${withDiagnosis} offer a first workup; ${multi} needs list several settings.`, "");
    mkdirSync("../reports", { recursive: true });
    writeFileSync("../reports/settings-map.md", out.join("\n"));
    expect(withDiagnosis).toBe(mapped.length);
  });
});
