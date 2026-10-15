export type Pred =
  | { all: Pred[] }
  | { any: Pred[] }
  | { not: Pred }
  | { fact: string; op: string; value: unknown };

export interface BNode {
  id: string;
  kind: "box" | "header";
  text: string;
  bbox: [number, number, number, number];
  pred: Pred | null;
  links: string[];
  role: string | null;
  /** reviewed / draft (not confirmed) / rejected (review rejected the draft: no condition) /
   * inherited (an entry box's condition taken from the boxes that link to it) / section (only
   * requires the patient to be in the page's guideline section) */
  review?: "reviewed" | "draft" | "rejected" | "inherited" | "section" | null;
  /** condition (describes the patient), option (one of several treatment choices), other */
  decision?: "condition" | "option" | "other" | null;
  /** For an option: "the patient already received this option". */
  received?: Pred | null;
  /** For an entry box reached by links: the linking boxes' conditions (information only). */
  linkCond?: Pred | null;
  reviewNote?: string;
  sectionClause?: boolean;
  /** References to other guidelines. */
  ext?: { slug: string; code: string | null }[];
  /** [letter, text, 0-based PDF page index of the page that prints it] */
  footnotes: [string, string, number?][];
}
export interface BEdge { src: string; dst: string; cls: "agreed" | "verified" | "unsure" }
export interface FlowPage {
  nodes: BNode[]; edges: BEdge[]; counts: Record<string, number>; title?: string; pdf?: number;
  size?: [number, number]; band?: [number, number]; section?: string | null;
}
export interface DocPage { text: string; tables: string[]; pdf?: number }
export interface Doc { code: string; kind: string; title: string; pages: DocPage[] }

export interface VarSpec {
  type: "number" | "enum" | "bool"; unit?: string; values?: string[]; definition?: string;
  /** when the value applies: current state, at diagnosis, or history */
  time?: "current" | "at_diagnosis" | "history";
  judgment?: boolean; criteria?: string;
}
export interface DerivedSpec { type: string; definition?: string; rules: { if: Pred; then: unknown }[]; else?: unknown }
export interface Schema { variables: Record<string, VarSpec>; derived: Record<string, DerivedSpec> }

export interface Bundle {
  pages: Record<string, FlowPage>;
  links: [string, string][];
  children: Record<string, string[]>;
  roots: Record<string, string[]>;
  docs: Record<string, Doc>;
  schema: Schema;
  preds_draft: boolean;
  w: number; h?: number; top: number; bottom: number;
  title: string;
  pdf_pages?: number;
  pdf_candidates?: string[];
  examples?: Example[];
  /** canonical format only */
  guideline?: { slug: string; title: string; category?: string; version?: string; version_date?: string; pdf_sha256?: string; pdf_pages?: number };
  sections?: { variable: string; values: string[]; pages: Record<string, string> } | null;
  /** page-code prefix of another guideline -> its slug ("DIS" -> distress_management) */
  prefixes?: Record<string, string>;
  /** tables and option types are explicit in the data (no viewer heuristics needed) */
  structured?: boolean;
}
export interface Example { id: string; label: string; note?: string; age?: number; facts: Facts }

export type Facts = Record<string, unknown>;

export interface LibraryEntry { slug: string; title: string; category: string; version?: string; version_date?: string; path: string; pdf_sha256?: string; quality?: Record<string, unknown> }
/** pdfs: served copies of the source PDFs found at build time (slug -> path relative to the page) */
export interface Library { base: string; guidelines: LibraryEntry[]; pdfs?: Record<string, string>; packs?: string }

declare global { interface Window { __BUNDLE__: Bundle | null; __GUIDELINE__?: unknown; __LIBRARY__?: { base?: string; pdfs?: Record<string, string>; packs?: string; index?: LibraryEntry[] } | null; __OC_PACKS?: Record<string, string> } }
