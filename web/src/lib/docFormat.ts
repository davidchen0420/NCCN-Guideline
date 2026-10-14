/** Turn the extracted text of a principles / discussion page into headings, paragraphs and lists. */
export type DocBlock =
  | { t: "h"; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: { text: string; sub: string[] }[] }
  | { t: "table"; head: string[]; rows: string[][]; title: string };

const isHeading = (l: string) => l.length > 3 && l.length < 110 && l === l.toUpperCase() && /[A-Z]{3}/.test(l) && !/^[•\-\d]/.test(l);

export function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}|\n(?=•)/).map((p) => p.replace(/\s*\n\s*/g, " ").replace(/^•\s*/, "").trim()).filter(Boolean);
}

export function formatDoc(text: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  let ul: { text: string; sub: string[] }[] | null = null;
  let collecting: "sub" | "cont" | null = null;
  const flushPara = () => { if (para.length) blocks.push({ t: "p", text: para.join(" ").replace(/\s+/g, " ").trim() }); para = []; };
  const flushList = () => { ul = null; collecting = null; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    if (isHeading(line)) { flushPara(); flushList(); blocks.push({ t: "h", text: line.replace(/(?<=[A-Z])\d{1,2}$/, "").replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase()) }); continue; }
    const bullet = line.match(/^[•▪◦\-–]\s*(.*)$/);
    if (bullet) {
      flushPara();
      if (!ul) { ul = []; blocks.push({ t: "ul", items: ul }); }
      ul.push({ text: bullet[1], sub: [] });
      collecting = bullet[1].endsWith(":") ? "sub" : "cont";
      continue;
    }
    if (ul && ul.length) {
      const cur = ul[ul.length - 1];
      if (collecting === "sub" || (collecting === "cont" && cur.sub.length)) { cur.sub.push(line); collecting = "sub"; }
      else cur.text += " " + line;
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

export function parseTable(md: string): Extract<DocBlock, { t: "table" }> | null {
  const rows = md.split("\n").filter((l) => l.trim());
  const titleLine = rows[0]?.startsWith("###") ? rows.shift()!.replace(/^#+\s*/, "") : "";
  const cells = (l: string) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const table = rows.filter((l) => l.startsWith("|"));
  if (table.length < 2) return null;
  const head = cells(table[0]);
  const body = table.slice(1).filter((l) => !/^\|\s*-+/.test(l)).map(cells);
  return { t: "table", head, rows: body, title: titleLine };
}
