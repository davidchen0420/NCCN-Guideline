/**
 * How patient facts are labelled, grouped and formatted in the form and in condition text.
 * Names come from fact_schema.json; anything not listed here falls back to a readable version
 * of the variable name, so other guidelines still work.
 */
import type { Facts, Schema, VarSpec } from "../types";

export interface Meta { label: string; hint?: string; group?: string; short?: string }

const META: Record<string, Meta> = {
  life_expectancy_years: { label: "Life expectancy", group: "patient", hint: "Estimated, in years. A range such as >10 or 5-10 is fine." },
  symptomatic_progression: { label: "Symptomatic progression", group: "patient" },
  clinical_t_category: { label: "Clinical T category", short: "cT", group: "staging" },
  n_category: { label: "N category", group: "staging" },
  m_category: { label: "M category", group: "staging" },
  grade_group: { label: "Grade Group", group: "staging" },
  psa_ng_ml: { label: "PSA", short: "PSA", group: "staging", hint: "At diagnosis or at the time being assessed." },
  positive_cores_percent: { label: "Positive biopsy cores", group: "staging", hint: "Percent of cores with cancer, e.g. 6 of 12 = 50." },
  histology: { label: "Histology", group: "staging" },
  positive_digital_rectal_exam: { label: "Suspicious DRE", group: "staging", hint: "Digital rectal exam positive for a suspicious finding." },
  definitive_treatment_received: { label: "Initial treatment received", group: "treatment" },
  current_treatment_phase: { label: "Current phase", group: "treatment" },
  psa_status: { label: "PSA after treatment", group: "treatment" },
  psa_trend: { label: "PSA trend on ADT", group: "treatment" },
  psa_doubling_time_months: { label: "PSA doubling time", short: "PSADT", group: "treatment" },
  testosterone_ng_dl: { label: "Testosterone", group: "treatment", hint: "Castrate level is below 50 ng/dL." },
  adverse_pathologic_features: { label: "Adverse pathologic features", group: "treatment", hint: "Positive margins, seminal vesicle invasion, extracapsular extension or detectable PSA (PROS-7A footnote)." },
  second_biochemical_recurrence: { label: "Second biochemical recurrence", group: "treatment" },
  prior_arpi_treatment: { label: "Prior ARPI", group: "treatment", hint: "Androgen receptor pathway inhibitor, e.g. abiraterone, enzalutamide." },
  metastasis_timing: { label: "Metastases appeared", group: "metastatic" },
  bone_metastases_count: { label: "Bone metastases", group: "metastatic", hint: "Number of lesions." },
  bone_metastases_beyond_vertebrae_pelvis_count: { label: "…outside spine and pelvis", group: "metastatic", hint: "How many of those lie outside the vertebral bodies and pelvis." },
  visceral_metastases_present: { label: "Visceral metastases", group: "metastatic" },
  clinician_judges_oligometastatic: { label: "Oligometastatic (clinical judgment)", group: "metastatic" },
  brca1_2_mutation: { label: "BRCA1/2 mutation", group: "molecular" },
  hrr_mutation_other_than_brca: { label: "Other HRR gene mutation", group: "molecular" },
  crpc_stated: { label: "Record states CRPC", group: "stated" },
  high_volume_stated: { label: "Record states high-volume disease", group: "stated" },
  high_risk_bcr_stated: { label: "Record states high-risk BCR", group: "stated" },
  guideline_section: { label: "Disease or subtype" },
  // derived
  disease_extent: { label: "Disease extent" },
  risk_group: { label: "Risk group" },
  intermediate_subgroup: { label: "Intermediate subgroup" },
  life_expectancy_band: { label: "Life expectancy band" },
  psadt_group: { label: "PSADT group" },
  castration_resistant: { label: "Castration-resistant (CRPC)" },
  clinician_judges_high_volume: { label: "High-volume metastases" },
  high_risk_biochemical_recurrence: { label: "High-risk biochemical recurrence" },
  gt5y_or_symptomatic: { label: "Life expectancy >5 y or symptomatic" },
  adverse_features_or_node_positive: { label: "Adverse features or N1" },
  psa_persistence_or_recurrence: { label: "PSA persistence or recurrence" },
  psa_recurrence_or_positive_dre: { label: "PSA recurrence or suspicious DRE" },
  staging_state: { label: "Disease state" },
  metastatic_pattern: { label: "Metastatic pattern" },
  adt_monitoring_result: { label: "Result of monitoring on ADT" },
};

export const GROUPS: { key: string; title: string; match: RegExp }[] = [
  { key: "patient", title: "Patient", match: /life_expectancy|age|ecog|comorb|symptom|performance|health/ },
  { key: "staging", title: "Diagnosis and Staging", match: /category|stage|grade|cores|histology|gleason|psa_ng|dre|rectal/ },
  { key: "treatment", title: "Treatment So Far", match: /treatment|therapy|adt|arpi|radiation|prostatectomy|prior|recurr|castrat|psa|testosterone|patholog/ },
  { key: "metastatic", title: "Metastatic Disease", match: /metast|visceral|bone|nodal|oligo|volume/ },
  { key: "molecular", title: "Genetics and Biomarkers", match: /brca|hrr|msi|mmr|tmb|pten|germline|somatic|mutation|biomarker/ },
  { key: "stated", title: "Stated in the Record", match: /_stated$/ },
  { key: "other", title: "Other", match: /.*/ },
];

const VALUE_LABEL: Record<string, string> = {
  radical_prostatectomy: "Radical prostatectomy", radiation_therapy: "Radiation therapy", radiation_plus_adt: "Radiation + ADT",
  initial_definitive_therapy: "Initial definitive therapy", on_adt: "On ADT", on_observation: "On observation",
  small_cell_neuroendocrine: "Small cell / neuroendocrine", adenocarcinoma: "Adenocarcinoma",
  undetectable: "Undetectable", persistence: "Persistence", recurrence: "Recurrence", no_recurrence: "No recurrence",
  very_high: "Very high", favorable_intermediate: "Favorable", unfavorable_intermediate: "Unfavorable",
  clinically_localized: "Clinically localized", gt_10: ">10 y", eq_10: "10 y", between_5_and_10_exclusive: "5–10 y", eq_5: "5 y", lt_5: "<5 y",
  le_10_months: "≤10 months", gt_10_months: ">10 months", m1_crpc: "M1 CRPC", m1_cspc: "M1 CSPC", m0_crpc: "M0 CRPC",
  stable_no_metastases: "Stable, no metastases", none: "None", other: "Other",
};
// ---------------------------------------------------------------- labels

/** Abbreviations used across guidelines; each guideline adds the ones its own text writes in capitals. */
const BUILTIN_ACRONYMS = ["psa", "adt", "crpc", "cspc", "arpi", "hrr", "brca", "bcr", "rt", "rp", "dre", "psadt", "ebrt", "mdt",
  "ecog", "kps", "aml", "all", "cll", "cml", "mds", "mpn", "apl", "nhl", "dlbcl", "cns", "hct", "gvhd", "mri", "ct", "pet", "psma",
  "ldh", "uln", "lln", "hiv", "hpv", "hbv", "hcv", "egfr", "alk", "ros1", "braf", "kras", "nras", "her2", "er", "pr", "msi", "mmr",
  "tmb", "pd", "dna", "rna", "fish", "ngs", "ihc", "bmi", "bsa", "wbc", "anc", "rbc", "iv", "po", "sc", "im", "ici", "tki", "car",
  "nsclc", "sclc", "dcis", "lcis", "gist", "hcc", "rcc", "scc", "bcc", "vte", "dvt", "pe", "mrd", "cr", "pr", "pd", "sd", "ajcc",
  "figo", "who", "eln", "fdg", "suv", "ptld", "ebv", "cmv", "covid", "lvef", "nyha", "copd", "acth", "tsh", "afp", "cea", "us",
  "kd", "aya", "pt", "pn", "tg", "tgab", "mtx", "ph", "mb", "eac", "fdr", "hb", "adl", "alp", "pg", "sct", "tbi", "ocd", "src", "ida",
  "htlv", "idh", "idrf", "nen", "tps", "nrs", "mdro", "mme", "lmd", "pdt", "sitm", "ifl", "fta", "hars", "jak", "stat", "ato", "atra",
  "ecg", "ekg", "hla", "cbc", "cmp", "bun", "inr", "ptt", "crp", "esr", "bnp", "gfr", "ivc", "picc", "icu", "ed", "gi", "gu", "ent"];
/** Abbreviations with their own mixed case, units, and names. */
const MIXED: Record<string, string> = {
  hcg: "hCG", qpcr: "qPCR", pcr: "PCR", dmmr: "dMMR", pmmr: "pMMR", irae: "irAE", qtcf: "QTcF", qtc: "QTc", bzip: "bZIP", btki: "BTKi",
  xray: "X-ray", ph: "Ph", gcsf: "G-CSF", plp: "P/LP", iamp: "iAMP", miu: "mIU", yp: "yp", yc: "yc", tdap: "Tdap", hib: "Hib", igg: "IgG", igm: "IgM",
  iga: "IgA", ige: "IgE", adls: "ADLs", mohs: "Mohs", gail: "Gail", pugh: "Pugh", echo: "Echo", ml: "mL", dl: "dL", mg: "mg",
  mmol: "mmol", kg: "kg", cm: "cm", mm: "mm", gy: "Gy", ng: "ng", mcg: "mcg", egfr_kidney: "eGFR",
};
/** Words the text writes in capitals that are still ordinary words or names in a variable name. */
const NOT_ACRONYMS = new Set(["flag", "mets", "yes", "no", "not", "and", "or", "of", "the", "with", "lynch", "sellar", "supra", "stage", "grade", "risk", "score", "x", "y", "echo", "met", "mut", "tox", "fam"]);
const SMALL_WORDS = new Set(["a", "an", "and", "or", "nor", "but", "of", "the", "in", "on", "at", "to", "for", "with", "vs", "by", "per", "as", "from", "into", "than", "via"]);
/** Multi-word spellings that a plain word-by-word pass would get wrong. */
const PHRASES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/\bli fraumeni\b/g, "Li-Fraumeni"], [/\blynch\b/g, "Lynch"], [/\bpd l1\b/g, "PD-L1"], [/\bpi rads\b/g, "PI-RADS"],
  [/\bcar t\b/g, "CAR T"], [/\bbrca1 2\b/g, "BRCA1/2"], [/\bcovid ?19\b/g, "COVID-19"], [/\bjak stat\b/g, "JAK-STAT"], [/\bann arbor\b/g, "Ann Arbor"],
  [/\bchild pugh\b/g, "Child-Pugh"], [/\bmpmri\b/g, "mpMRI"], [/\b([tbk]) cell\b/g, (_m: string, c: string) => `${c.toUpperCase()}-cell`],
  [/\bnk cell\b/g, "NK-cell"], [/\by([pc]) ([tnm])\b/g, (_m: string, a: string, c: string) => `y${a}${c.toUpperCase()}`], [/\bfollow up\b/g, "follow-up"], [/\bx uln\b/g, "× ULN"], [/\begfr ml min\b/g, "eGFR"], [/\bpack years\b/g, "Pack-Years"],
  [/\bng ml\b/g, "ng/mL"], [/\bng dl\b/g, "ng/dL"], [/\bmg dl\b/g, "mg/dL"], [/\bg dl\b/g, "g/dL"], [/\bu ml\b/g, "U/mL"],
  [/\bml min\b/g, "mL/min"], [/\bmm hr\b/g, "mm/hr"], [/\bx10e9 l\b/g, "×10⁹/L"],
  [/\bge\b/g, "≥"], [/\bgt\b/g, ">"], [/\ble\b/g, "≤"], [/\blt\b/g, "<"],
];
/** Trailing words that only repeat the field's unit ("psa_ng_ml" is shown as "PSA" with "ng/mL" beside it). */
const UNIT_WORDS = /(?:\s+(?:years?|months?|weeks?|days?|hours?|cm|mm|percent|pct|ng\/mL|ng\/dL|mg\/dL|g\/dL|U\/mL|mL\/min|mm\/hr|kg|kg m2|gy|mmhg))+$/i;
/** Lower-case words that stay lower case in Title Case (units, TNM prefixes). */
const KEEP_LOWER = new Set(["mg", "mmol", "kg", "cm", "mm", "ng", "mcg", "yp", "yc", "vs"]);

let acronyms = new Set(BUILTIN_ACRONYMS);
let schemaRef: Schema | null = null;
/** Called once per guideline (graph.ts): its schema and the abbreviations its text uses. */
export function configureLabels(schema: Schema | null, extra: Iterable<string> = []) {
  schemaRef = schema;
  acronyms = new Set([...BUILTIN_ACRONYMS, ...[...extra].filter((x) => !NOT_ACRONYMS.has(x))]);
}

/** Title Case, with abbreviations in capitals and small words lower case (except first). */
export function titleCase(text: string): string {
  return text.split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w) || !/[a-z]/i.test(w)) return w;
    const core = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (/[A-Z]/.test(core.slice(1)) || /^[A-Z0-9]+$/.test(core) && core.length > 1) return w;   // as printed: CRPC, Lung-RADS, eGFR
    if (KEEP_LOWER.has(core)) return w;
    if (i > 0 && SMALL_WORDS.has(core.toLowerCase())) return w.toLowerCase();
    // "high-volume" -> "High-Volume"; short hyphen parts stay as they are ("T-cell" -> "T-Cell" is fine too)
    return w.replace(/[A-Za-z]/, (c) => c.toUpperCase()).replace(/-([a-z])(?=[a-z]{2})/g, (_m, c: string) => "-" + c.toUpperCase());
  }).join("");
}

function word(t: string): string {
  if (!t) return t;
  if (MIXED[t]) return MIXED[t];
  if (acronyms.has(t) || /^(i{1,3}v?|iv|v|vi{1,3})[abc]?$/.test(t)) return t.toUpperCase();   // roman numerals: stage IIIA
  if (/^\d+(st|nd|rd|th)$/.test(t) || /^\d+(\.\d+)?$/.test(t)) return t;                 // 1st, 4, 0.5
  if (/^[a-z]{4,}\d+$/.test(t)) return t.replace(/(\d+)$/, " $1");                            // cycle4 -> cycle 4
  if (/\d/.test(t) && /[a-z]/.test(t)) return t.toUpperCase();                                 // brca1, tp53, n0m0, cd20
  return t;
}

/** "ecog_score" -> "ECOG Score"; "psa_ng_ml" -> "PSA"; "psa_lt_4" -> "PSA < 4"; "cycle4_pr" -> "Cycle 4 PR". */
export function humanName(name: string): string {
  let s = name.toLowerCase().replace(/_/g, " ").trim();
  for (const [re, to] of PHRASES) s = s.replace(re, to as string);
  s = s.split(" ").map((t) => (/[A-Z≥≤<>×/-]/.test(t) ? t : word(t))).join(" ");
  const spec = schemaRef?.variables?.[name];
  if (spec?.type === "number") { const cut = s.replace(UNIT_WORDS, ""); if (cut.trim()) s = cut; }
  return titleCase(s.replace(/\s+/g, " ").trim());
}
export const meta = (name: string): Meta => {
  const m = META[name];
  return m ? { ...m, label: titleCase(m.label) } : { label: humanName(name) };
};
export const label = (name: string) => meta(name).label;
export function groupOf(name: string): string {
  return META[name]?.group ?? GROUPS.find((g) => g.match.test(name))!.key;
}

/** Enum values: same casing rules as names, without unit stripping. */
function humanValue(v: string): string {
  let s = v.replace(/_/g, " ");
  for (const [re, to] of PHRASES) s = s.replace(re, to as string);
  return titleCase(s.split(" ").map((t) => (/[A-Z≥≤<>×/-]/.test(t) ? t : word(t))).join(" "));
}

export function valueLabel(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return VALUE_LABEL[v] ? titleCase(VALUE_LABEL[v]) : /^[a-z0-9_]+$/.test(v) && /[a-z]/.test(v) ? humanValue(v) : v;
  if (Array.isArray(v)) return v.map(valueLabel).join(", ");
  return String(v);
}

const UNIT: Record<string, string> = { "ng/ml": "ng/mL", "ng/dl": "ng/dL", "mg/dl": "mg/dL", "g/dl": "g/dL", "u/ml": "U/mL", "ml/min": "mL/min", years: "y", months: "mo", percent: "%", count: "", score: "", points: "", index: "", ratio: "" };
export const unitLabel = (u?: string) => (u === undefined ? "" : UNIT[u] ?? u);

type Interval = { min?: number | null; max?: number | null; min_open?: boolean; max_open?: boolean };
/** "18", ">10", "≥5", "5-10" -> number or interval (same forms the Python validator accepts). */
export function parseNumber(text: string): number | Interval | null | undefined {
  const t = text.trim().replace(/,/g, ".").replace(/–|—/g, "-");
  if (!t) return undefined;
  let m = t.match(/^(-?\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]);
  m = t.match(/^(>=|<=|≥|≤|>|<)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const x = Number(m[2]), op = m[1];
    if (op === ">" || op === ">=" || op === "≥") return { min: x, max: null, min_open: op === ">", max_open: false };
    return { min: null, max: x, min_open: false, max_open: op === "<" };
  }
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)$/);
  if (m && Number(m[1]) <= Number(m[2])) return { min: Number(m[1]), max: Number(m[2]), min_open: false, max_open: false };
  return null;
}

export function formatNumber(v: unknown, unit?: string): string {
  const u = unitLabel(unit);
  const sp = u && u !== "%" ? " " : "";
  if (typeof v === "number") return `${+v.toFixed(2)}${sp}${u}`;
  if (v && typeof v === "object") {
    const iv = v as Interval;
    const lo = iv.min ?? null, hi = iv.max ?? null;
    if (lo !== null && hi !== null) return lo === hi ? `${lo}${sp}${u}` : `${lo}–${hi}${sp}${u}`;
    if (lo !== null) return `${iv.min_open ? ">" : "≥"}${lo}${sp}${u}`;
    if (hi !== null) return `${iv.max_open ? "<" : "≤"}${hi}${sp}${u}`;
  }
  return String(v);
}
/** The text a number field shows for a stored value. */
export function numberText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return String(v);
  const iv = v as Interval;
  if (iv.min != null && iv.max != null) return iv.min === iv.max ? String(iv.min) : `${iv.min}-${iv.max}`;
  if (iv.min != null) return `${iv.min_open ? ">" : ">="}${iv.min}`;
  if (iv.max != null) return `${iv.max_open ? "<" : "<="}${iv.max}`;
  return "";
}

export function factValue(name: string, v: unknown, schema: Schema): string {
  const spec: VarSpec | undefined = schema.variables[name];
  if (spec?.type === "number") return formatNumber(v, spec.unit);
  return valueLabel(v);
}

export const filledCount = (facts: Facts, schema: Schema) =>
  Object.keys(schema.variables).filter((k) => facts[k] !== undefined && !k.endsWith("_stated")).length;
export const fieldCount = (schema: Schema) => Object.keys(schema.variables).filter((k) => !k.endsWith("_stated")).length;
