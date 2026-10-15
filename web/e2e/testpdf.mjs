// A stand-in for a guideline's source PDF (the real ones are licensed and never in the repo):
// every algorithm page with its boxes outlined at their recorded positions, a red banner and
// the page number, so tests can tell the original page is shown and where boxes land.
import { readFile } from "node:fs/promises";

const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "?");

export async function makeGuidelinePdf(guidelinePath) {
  const g = JSON.parse(await readFile(guidelinePath, "utf8"));
  const nodes = new Map();
  for (const n of g.nodes) (nodes.get(n.pdf_page) ?? nodes.set(n.pdf_page, []).get(n.pdf_page)).push(n);
  const pages = g.pages.map((p) => {
    const [w, h] = p.size ?? [792, 612];
    let s = `1 0 0 RG 1 0.85 0.85 rg 0 ${h - 40} ${w} 40 re f 0.6 0 0 rg BT /F1 18 Tf 20 ${h - 28} Td (SYNTHETIC TEST PDF - page ${p.pdf_page} - ${esc(p.id)}) Tj ET\n`;
    for (const n of nodes.get(p.pdf_page) ?? []) {
      const [x0, y0, x1, y1] = n.bbox;
      s += `0 0 0.8 RG 1 w ${x0} ${h - y1} ${x1 - x0} ${y1 - y0} re S 0 0 0 rg BT /F1 6 Tf ${x0 + 2} ${h - y0 - 7} Td (${esc(n.text.slice(0, 40))}) Tj ET\n`;
    }
    return { w, h, s };
  });
  // objects: 1 catalog, 2 pages, 3 font, then (page, content) pairs
  const objs = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((p, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(p.s, "latin1")} >>\nstream\n${p.s}endstream`);
  });
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
