import type { Graph } from "./graph";
import { parseInline } from "./parseBox";
import { splitParagraphs } from "./docFormat";

export type Kind = "box" | "footnote" | "principles" | "staging" | "discussion" | "reference";
export interface SearchDoc { kind: Kind; label: string; text: string; page: string; node?: string; letter?: string; doc?: string }

const short = (t: string, n = 38) => (t.length > n ? t.slice(0, n).trimEnd() + "…" : t);

export function buildIndex(g: Graph): SearchDoc[] {
  const out: SearchDoc[] = [];
  for (const [full, n] of g.nodes) {
    if (n.kind !== "box") continue;
    out.push({ kind: "box", label: `${n.page} · ${short(g.bundle.pages[n.page].title ?? "")}`.replace(/ · $/, ""), text: g.parsed.get(full)!.plain, page: n.page, node: full });
  }
  const seen = new Set<string>();
  for (const [full, n] of g.nodes) for (const [letter, text] of n.footnotes) {
    const key = `${n.page}|${letter}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "footnote", label: `Footnote ${letter} · ${n.page}`, text: plain(text), page: n.page, node: full, letter });
  }
  for (const d of Object.values(g.bundle.docs ?? {}))
    d.pages.forEach((pg, i) => splitParagraphs(pg.text).forEach((para) => {
      if (para.length > 24) out.push({ kind: d.kind as Kind, label: `${d.code} · ${short(d.title)}`, text: para, page: d.code, doc: d.code + (i ? `#${i + 1}` : "") });
    }));
  return out;
}

const plain = (t: string) => parseInline(t).map((x) => (x.t === "text" ? x.v : x.t === "link" ? x.text : x.t === "ref" ? x.label : x.t === "tag" ? x.label : "")).join("");

export function matcher(q: string): (t: string) => boolean {
  const query = q.trim();
  if (!query) return () => true;
  const exact = query.match(/^"(.*)"$/);
  if (exact) { const e = exact[1].toLowerCase(); return (t) => t.toLowerCase().includes(e); }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (t) => { const l = t.toLowerCase(); return words.every((w) => l.includes(w)); };
}

export function terms(q: string): string[] {
  const exact = q.trim().match(/^"(.*)"$/);
  return (exact ? [exact[1]] : q.trim().split(/\s+/)).filter(Boolean);
}

export function vocab(index: SearchDoc[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of index) for (const w of d.text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

export function snippet(text: string, q: string, len = 150): string {
  const t = terms(q)[0]?.toLowerCase() ?? "";
  const i = Math.max(0, text.toLowerCase().indexOf(t));
  const a = Math.max(0, i - 50);
  return (a ? "…" : "") + text.slice(a, a + len) + (a + len < text.length ? "…" : "");
}
