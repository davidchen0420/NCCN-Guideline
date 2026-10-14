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
  clinician_judges_oligometastatic: { label: "Oligometastatic (clinician judgment)", group: "metastatic" },
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
  { key: "staging", title: "Diagnosis and staging", match: /category|stage|grade|cores|histology|gleason|psa_ng|dre|rectal/ },
  { key: "treatment", title: "Treatment so far", match: /treatment|therapy|adt|arpi|radiation|prostatectomy|prior|recurr|castrat|psa|testosterone|patholog/ },
  { key: "metastatic", title: "Metastatic disease", match: /metast|visceral|bone|nodal|oligo|volume/ },
  { key: "molecular", title: "Genetics and biomarkers", match: /brca|hrr|msi|mmr|tmb|pten|germline|somatic|mutation|biomarker/ },
  { key: "stated", title: "Stated in the record", match: /_stated$/ },
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
const ACRONYM = /\b(psa|adt|crpc|cspc|arpi|hrr|brca|bcr|rt|rp|dre|psadt|ebrt|mdt)\b/gi;

export const humanName = (name: string) => {
  const s = name.replace(/_/g, " ").replace(ACRONYM, (m) => m.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const meta = (name: string): Meta => META[name] ?? { label: humanName(name) };
export const label = (name: string) => meta(name).label;
export function groupOf(name: string): string {
  return META[name]?.group ?? GROUPS.find((g) => g.match.test(name))!.key;
}

export function valueLabel(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return VALUE_LABEL[v] ?? (/^[a-z_]+$/.test(v) ? humanName(v) : v);
  if (Array.isArray(v)) return v.map(valueLabel).join(", ");
  return String(v);
}

const UNIT: Record<string, string> = { "ng/ml": "ng/mL", "ng/dl": "ng/dL", years: "y", months: "mo", percent: "%", count: "" };
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
