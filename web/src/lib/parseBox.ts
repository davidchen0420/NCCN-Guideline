/**
 * Turns the flattened text of a guideline box into readable structure.
 *
 * The PDF text uses "•" for bullets, U+0017 for sub-bullets and "◊" for sub-sub-bullets,
 * plain "or" between alternative regimens, and tier headings such as "Preferred:".
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "ref"; code: string; label: string; idx?: number }
  | { t: "tag"; label: string; kind: "cat" | "pref" | "other" | "useful" }
  | { t: "url"; href: string }
  | { t: "link"; code: string; text: string; label: string; idx?: number }
  | { t: "or" };

export interface Item { inline: Inline[]; children: Item[] }
export type Block =
  | { t: "lead"; inline: Inline[] }
  | { t: "para"; inline: Inline[] }
  | { t: "list"; items: Item[] }
  | { t: "or" }
  | { t: "tier"; label: string; kind: "pref" | "other" | "useful" };

export interface Parsed { blocks: Block[]; tags: string[]; refs: string[]; plain: string }

const TAG = /\((category\s+[123][AB]?|preferred|other recommended|useful in certain circumstances)\)/i;
const URL_RE = /https?:\/\/[^\s)]+/;
const TIER = /^(preferred|other recommended|useful in certain circumstances)\s*:?$/i;
const WORD = "[A-Z][A-Za-z0-9\\-/&,.]*";
const SMALL = "of|and|for|the|in|to|with|on|or";

interface Rx { ref: string; combined: RegExp; titleRef: RegExp }
let rx: Rx;
let rxKey = "";
/** Page codes look like PROS-12, PROS-F, ST-1, MS-7. Other guidelines use other prefixes (NSCL, COL...). */
export function configureRefs(prefixes: string[]): void {
  const key = prefixes.join("|");
  if (key === rxKey) return;
  rxKey = key;
  const flow = prefixes.map((x) => x.replace(/[^A-Z0-9]/gi, "")).filter(Boolean).join("|");
  const code = `(?:${flow})-(?:[A-Z]\\b|\\d+[A-Z]?)|ST-\\d+|MS-\\d+|ABBR-\\d+|CAT-\\d+`;
  const ref = `\\b(${code})\\b(?:\\s+(\\d+)\\s+of\\s+(\\d+))?`;
  rx = {
    ref: code,
    combined: new RegExp(`${TAG.source}|${URL_RE.source}|\uE000([^\uE001]*)\uE001|${ref}`, "gi"),
    titleRef: new RegExp(`(${WORD}(?:\\s+(?:${SMALL}|${WORD}))*)\\s*[\\[(]\\s*(${code})(?:\\s+(\\d+)\\s+of\\s+(\\d+))?\\s*[\\])]`, "g"),
  };
}
configureRefs(["PROS"]);
const capCount = (t: string) => t.split(/\s+/).filter((w) => /^[A-Z]/.test(w) && !/^(Of|And|For|The|In|To|With|On|Or)$/.test(w)).length;

const tagKind = (label: string): "cat" | "pref" | "other" | "useful" => {
  const l = label.toLowerCase();
  return l.startsWith("category") ? "cat" : l === "preferred" ? "pref" : l.startsWith("other") ? "other" : "useful";
};
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d)([ab])\b/g, (_, d, c) => d + c.toUpperCase());

/** Linkify page references, category/preference tags and URLs inside a run of text. */
export function parseInline(input: string): Inline[] {
  const text = input
    .replace(/\b[Ss]ee Discussion\b/g, (m) => `${m.slice(0, 4)}\uE000MS-1||Discussion\uE001`)
    .replace(rx.titleRef, (m, title: string, code: string, idx: string | undefined) =>
      capCount(title) >= 2 || /^Principles /.test(title) ? `\uE000${code}|${idx ?? ""}|${title.trim()}\uE001` : m)
    .replace(/\(\s*(\uE000[^\uE001]*\uE001)\s*\)/g, "$1")
    .replace(/\[\s*(\uE000[^\uE001]*\uE001)\s*\]/g, "$1");
  const out: Inline[] = [];
  let last = 0;
  const push = (v: string) => { if (v) out.push({ t: "text", v }); };
  for (const m of text.matchAll(rx.combined)) {
    const start = m.index ?? 0;
    let before = text.slice(last, start);
    let end = start + m[0].length;
    if (m[2] !== undefined) {
      push(before);
      const [code, idx, title] = m[2].split("|");
      out.push({ t: "link", code, text: title, label: idx ? `${code} ${idx}` : code, idx: idx ? Number(idx) : undefined });
    } else if (m[1]) {
      const label = m[1];
      push(before);
      out.push({ t: "tag", label: titleCase(label), kind: tagKind(label) });
    } else if (m[0].startsWith("http")) {
      push(before);
      out.push({ t: "url", href: m[0] });
    } else {
      const code = m[3];
      const page = m[4] ? Number(m[4]) : undefined;
      const label = m[0];
      // "(PROS-F 2 of 5)" / "[PROS-A]": drop brackets that wrap only the reference
      if (/[(\[]$/.test(before) && /^[)\]]/.test(text.slice(end))) { before = before.slice(0, -1); end += 1; }
      push(before);
      out.push({ t: "ref", code, label, idx: page });
    }
    last = end;
  }
  push(text.slice(last));
  // tidy whitespace and empty parentheses left behind
  return out.map((x) => (x.t === "text" ? { t: "text" as const, v: x.v.replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ") } : x)).filter((x) => x.t !== "text" || x.v.trim() !== "" || x.v === " ");
}

interface Entry { level: number; text: string; orBefore: boolean; newGroup: boolean }

/** Split "A or B" at parenthesis depth 0 when B starts a new option (capital letter or digit). */
function splitOr(text: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(" or ", i) && /[A-Z0-9]/.test(text[i + 4] ?? "") && i > 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 4;
      i += 3;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

const MARK: Record<string, number> = { "•": 1, "\u0017": 2, "◊": 3 };

export function parseBox(raw: string): Parsed {
  const text = raw.replace(/\s+/g, " ").replace(/ /g, " ").trim();
  const pieces = text.split(/([•\u0017◊])/);
  const entries: Entry[] = [];
  const addSegment = (level: number, seg: string) => {
    let s = seg.trim();
    if (!s) return;
    const glued = s.match(/^(.+?)\s+(Useful in Certain Circumstances|Other Recommended|Preferred):?$/);
    if (glued) { addSegment(level, glued[1]); entries.push({ level: 0, text: glued[2], orBefore: false, newGroup: false }); return; }
    let orBefore = false;
    if (/^or\b\s*/i.test(s) && s.length > 3 && /^[Oo]r\s/.test(s)) { orBefore = true; s = s.replace(/^[Oo]r\s+/, ""); }
    let endsWithOr = false;
    if (/\sor$/.test(s)) { endsWithOr = true; s = s.replace(/\s+or$/, ""); }
    const parts = splitOr(s);
    parts.forEach((p, i) => {
      const split = i > 0;
      const newGroup = split && (/:\s*$/.test(p) || level === 0);
      entries.push({ level: split && newGroup ? 0 : level, text: p, orBefore: split || (i === 0 && orBefore), newGroup });
    });
    if (endsWithOr) entries.push({ level: 0, text: "", orBefore: true, newGroup: true });
  };
  addSegment(0, pieces[0] ?? "");
  for (let i = 1; i < pieces.length; i += 2) addSegment(MARK[pieces[i]] ?? 1, pieces[i + 1] ?? "");

  const blocks: Block[] = [];
  const tags = new Set<string>();
  const refs = new Set<string>();
  let list: Extract<Block, { t: "list" }> | null = null;
  let stack: Item[] = [];
  let base = 1;
  const note = (inl: Inline[]) => inl.forEach((x) => { if (x.t === "tag") tags.add(x.label); if (x.t === "ref" || x.t === "link") refs.add(x.code); });
  for (const e of entries) {
    if (e.text === "") { blocks.push({ t: "or" }); list = null; stack = []; continue; }
    if (TIER.test(e.text)) {
      const label = titleCase(e.text.replace(/\s*:$/, ""));
      blocks.push({ t: "tier", label, kind: tagKind(label) as "pref" | "other" | "useful" });
      tags.add(label);
      list = null; stack = [];
      continue;
    }
    const inline = parseInline(e.text);
    note(inline);
    if (e.level === 0 || e.newGroup) {
      if (e.orBefore) blocks.push({ t: "or" });
      blocks.push({ t: "para", inline });
      list = null; stack = [];
      continue;
    }
    if (!list) base = e.level;
    const depth = Math.max(1, Math.min(e.level - base + 1, stack.length + 1));
    const item: Item = { inline: e.orBefore ? [{ t: "or" }, ...inline] : inline, children: [] };
    stack = stack.slice(0, depth - 1);
    if (stack.length === 0) {
      if (!list) { list = { t: "list", items: [] }; blocks.push(list); }
      list.items.push(item);
    } else stack[stack.length - 1].children.push(item);
    stack.push(item);
  }
  // a paragraph that introduces a list or tier is a lead-in
  blocks.forEach((b, i) => {
    if (b.t === "para" && (blocks[i + 1]?.t === "list" || blocks[i + 1]?.t === "tier")) (b as unknown as { t: string }).t = "lead";
  });
  const plain = text.replace(/[•\u0017◊]/g, " ").replace(/\s+/g, " ").trim();
  return { blocks, tags: [...tags], refs: [...refs], plain };
}

/** Longest line of a block list, used to size cards. */
export const textLength = (p: Parsed) => p.plain.length;
