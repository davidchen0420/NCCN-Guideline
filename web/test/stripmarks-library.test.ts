/**
 * Library-wide text hygiene: every box text and page title of all 91 guidelines, as the viewer shows
 * them (adaptGuideline + stripMarks), is scanned for the extraction debris clinicians reported:
 * footnote letters left mid-sentence ("alterations,m start"), titles cut at a line break
 * ("Adjuvant Treatment (Up to 6"), acronyms in title case ("Er- And/Or Pr-Positive", "Nlphl"),
 * wrapped compounds ("Amivantamab- vmjw", "first- line"), private-use glyphs and "/ " splits.
 * Set SCAN_REPORT=<file> to write every hit as JSON.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { adaptGuideline, balanced, cleanBoxText, pageTitle, smartTitle, stripMarks } from "../src/lib/adapt";

const slugs = readdirSync("../data").filter((d) => existsSync(`../data/${d}/guideline.json`)).sort();

export type Hits = Record<string, string[]>;
const KINDS = ["commaMark", "parenMark", "junk", "slashSpace", "wrappedHyphen", "strayDot", "titleParen", "titleAcronym", "titleHyphen", "titleSeeRef"] as const;

/** One scan per guideline: node text as shown (stripMarks), flow-page titles and document titles. */
export function scan(slug: string): Hits {
  const b = adaptGuideline(JSON.parse(readFileSync(`../data/${slug}/guideline.json`, "utf8")));
  const hits: Hits = Object.fromEntries(KINDS.map((k) => [k, [] as string[]]));
  const texts: [string, string][] = [];
  for (const [pid, fp] of Object.entries(b.pages)) for (const n of fp.nodes) texts.push([`${pid}:${n.id}`, n.text]);
  const titles: [string, string][] = [
    ...Object.entries(b.pages).map(([id, fp]) => [id, fp.title] as [string, string]),
    ...Object.values(b.docs).map((d) => [`doc ${d.code}`, d.title] as [string, string]),
  ];
  const corpus = texts.map((t) => t[1]).join("\n") + "\n" + Object.values(b.docs).flatMap((d) => d.pages.map((p) => p.text)).join("\n");
  // an acronym: printed in capitals inside mixed-case text, and never as an ordinary word (lower case or Capitalised)
  const lowerWords = new Set((corpus.match(/\b[A-Za-z][a-z]+\b/g) ?? []).map((w) => w.toLowerCase()));
  const upperWords = new Set(corpus.split("\n").filter((l) => /[a-z]{3}/.test(l)).flatMap((l) => l.match(/\b[A-Z]{2,6}\b/g) ?? []));
  for (const [id, raw] of texts) {
    const t = stripMarks(raw).replace(/\s+/g, " ");
    const at = (re: RegExp) => { const m = re.exec(t); return m ? `${id}: …${t.slice(Math.max(0, m.index - 30), m.index + 40)}…` : null; };
    const add = (k: string, h: string | null) => { if (h) hits[k].push(h); };
    add("commaMark", at(/[A-Za-z0-9%)\]],(?:[a-z])(?:,[a-z])*(?=[\s.;:)\]]|$)(?<!,(?:an|or|if|to|in|of|as|at|by|is|it|no|so|up|we))/));
    add("parenMark", at(/\)(?:([a-z])\1{0,2})(?:,(?:[a-z])\1{0,2})*(?=[\s.;:,\]]|$)/));
    add("junk", at(/[\u0000-\u0008\u000b\u000c\u000e-\u001f�-]/));
    add("slashSpace", at(/[A-Za-z]\/ [a-z]/));
    add("wrappedHyphen", at(/[A-Za-z]{2,}- (?!(?:and|or|to|vs|nor|but)\b)[a-z]/));
    add("strayDot", at(/(^|\s)\.(\s|$)/));
  }
  for (const [id, t] of titles) {
    if ((t.match(/\(/g) ?? []).length !== (t.match(/\)/g) ?? []).length) hits.titleParen.push(`${id}: ${t}`);
    if (/[a-z]{2,}- (?!(?:and|or|to|vs|nor|but)\b)[A-Za-z]/.test(t)) hits.titleHyphen.push(`${id}: ${t}`);
    if (/\(\s*see\b/i.test(t)) hits.titleSeeRef.push(`${id}: ${t}`);
    for (const w of t.match(/\b[A-Z][a-z]{1,5}\b/g) ?? []) {
      if (upperWords.has(w.toUpperCase()) && !lowerWords.has(w.toLowerCase()) && w.length >= 2) hits.titleAcronym.push(`${id}: ${w} in ${t}`);
    }
  }
  return hits;
}

describe("library text hygiene", () => {
  const all: Record<string, Hits> = {};
  it("scans every node text and page title of the library", () => {
    for (const s of slugs) all[s] = scan(s);
    const totals = Object.fromEntries(KINDS.map((k) => [k, Object.values(all).reduce((n, h) => n + h[k].length, 0)]));
    console.log("text hygiene hits", JSON.stringify(totals));
    if (process.env.SCAN_REPORT) writeFileSync(process.env.SCAN_REPORT, JSON.stringify(all, null, 1));
    expect(slugs.length).toBeGreaterThanOrEqual(91);
  }, 300_000);

  for (const k of KINDS) {
    it(`no ${k} left in the library`, () => {
      const hits = Object.entries(all).flatMap(([s, h]) => h[k].map((x) => `${s} ${x}`));
      expect(hits.slice(0, 15), `${hits.length} hits`).toEqual([]);
    });
  }
});

describe("text cleanup rules", () => {
  it("drops footnote letters after a comma or a closing parenthesis", () => {
    expect(stripMarks("if somatic PI3K pathway alterations,m start aspirin")).toBe("if somatic PI3K pathway alterations start aspirin");
    expect(stripMarks("PD-L1 Positive (≥1%)rr")).toBe("PD-L1 Positive (≥1%)");
    expect(stripMarks("Preferred: BCG induction followed by maintenance therapys,u")).toBe("Preferred: BCG induction followed by maintenance therapys");
    expect(stripMarks("SUBSEQUENT DOSE,l")).toBe("SUBSEQUENT DOSE");
    expect(stripMarks("surgery (category 1)bbb If ado")).toBe("surgery (category 1) If ado");
  });
  it("keeps real words after a comma and restores a missing space", () => {
    expect(stripMarks("isavuconazole,an echinocandin")).toBe("isavuconazole, an echinocandin");
    expect(stripMarks("FDG-PET/CT,or biopsy")).toBe("FDG-PET/CT, or biopsy");
    expect(stripMarks("(HCT)or Allogeneic HCT")).toBe("(HCT) or Allogeneic HCT");
    expect(stripMarks("Stage II, IIA and IIB")).toBe("Stage II, IIA and IIB");
  });
  it("removes the box's own glued footnote letters when it lists them", () => {
    expect(cleanBoxText("Arsenic trioxide ± ATRA ± gemtuzumab ozogamicinq,r", ["q", "r"])).toBe("Arsenic trioxide ± ATRA ± gemtuzumab ozogamicin");
    expect(cleanBoxText("Adjuvant endocrine therapygg,kk ± ovarian suppression", ["gg", "kk"])).toBe("Adjuvant endocrine therapy ± ovarian suppression");
    expect(cleanBoxText("Consider adjuvant ribociclib", ["a", "b"])).toBe("Consider adjuvant ribociclib");
  });
  it("joins wrapped compounds and drug suffixes but keeps suspended hyphens", () => {
    expect(stripMarks("Amivantamab- vmjw")).toBe("Amivantamab-vmjw");
    expect(stripMarks("emapalumab- lzsg")).toBe("emapalumab-lzsg");
    expect(stripMarks("first- line therapy, ultra- hypermutated, high- risk")).toBe("first-line therapy, ultra-hypermutated, high-risk");
    expect(stripMarks("PCR- and culture, ER- or PR-positive")).toBe("PCR- and culture, ER- or PR-positive");
  });
  it("closes a slash followed by a space and drops glyphs", () => {
    expect(stripMarks("persistence/ recurrence and/ or")).toBe("persistence/recurrence and/or");
    expect(stripMarks("exam \u0017Axillary  incl�")).toBe("exam · Axillary incl");
    expect(cleanBoxText("a \u0007b\n\u0017c")).toBe("a b\n\u0017c");
    expect(stripMarks("Observation\n.\nor")).toBe("Observation\nor");
  });
});

describe("page titles", () => {
  it("keeps acronyms, roman numerals and hyphenated suffixes", () => {
    expect(smartTitle("SYSTEMIC TREATMENT OF RECURRENT UNRESECTABLE (LOCAL OR REGIONAL) OR STAGE IV (M1) DISEASE: ER- AND/OR PR-POSITIVE; HER2-NEGATIVE"))
      .toBe("Systemic Treatment of Recurrent Unresectable (Local or Regional) or Stage IV (M1) Disease: ER- and/or PR-positive; HER2-negative");
    expect(smartTitle("PROGRESSION ON OSIMERTINIB OR LAZERTINIB ± AMIVANTAMAB- VMJW")).toMatch(/Amivantamab-vmjw$/i);
    expect(smartTitle("STAGE IIIA DISEASE")).toBe("Stage IIIA Disease");
    expect(smartTitle("POST- CONSOLIDATION THERAPY")).toBe("Post-Consolidation Therapy");
    expect(smartTitle("MANAGEMENT PER NMIBC RISK GROUP (SEE BL-1)", new Set(["NMIBC"]))).toBe("Management Per NMIBC Risk Group");
    expect(smartTitle("NLPHL REFRACTORY DISEASE", new Set(["NLPHL"]))).toBe("NLPHL Refractory Disease");
    expect(smartTitle("Changes in MFSS-3A noted")).toBe("Changes in MFSS-3A noted");
  });
  it("reads a wrapped title to its closing parenthesis and drops a dangling one", () => {
    expect(pageTitle("ADJUVANT TREATMENTb (UP TO 6 MO PERIOPERATIVE TREATMENT) (resected metastatic disease)", "", "pMMR/MSS Colon Cancer", "Colon Cancer", "COL-6"))
      .toBe("Adjuvant Treatment (Up to 6 Mo Perioperative Treatment) (resected metastatic disease)");
    expect(pageTitle("ADJUVANT TREATMENTb (UP TO 6", "MO PERIOPERATIVE TREATMENT)", "", "Colon Cancer", "COL-7")).toBe("Adjuvant Treatment");
    expect(balanced("Low hypodiploidy (30–39 chromosomes)/near triploidy (60–78")).toBe("Low hypodiploidy (30–39 chromosomes)/near triploidy");
  });
});
