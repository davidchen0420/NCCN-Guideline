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
  review?: "reviewed" | "draft" | "rejected" | null;
  /** [letter, text, 0-based PDF page index of the page that prints it] */
  footnotes: [string, string, number?][];
}
export interface BEdge { src: string; dst: string; cls: "agreed" | "verified" | "unsure" }
export interface FlowPage { nodes: BNode[]; edges: BEdge[]; counts: Record<string, number>; title?: string; pdf?: number }
export interface DocPage { text: string; tables: string[]; pdf?: number }
export interface Doc { code: string; kind: string; title: string; pages: DocPage[] }

export interface VarSpec { type: "number" | "enum" | "bool"; unit?: string; values?: string[]; definition?: string }
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
}
export interface Example { id: string; label: string; note?: string; age?: number; facts: Facts }

export type Facts = Record<string, unknown>;

declare global { interface Window { __BUNDLE__: Bundle | null } }
