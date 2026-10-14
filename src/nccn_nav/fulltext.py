"""Complete page store: every page of the guideline, in reading order, with tables kept as
Markdown grids, so nothing outside the decision graph is lost.

Output <private>/pages.json: [{index, code, kind, text, tables: [markdown], footnotes}]
and <private>/chunks_full.json for retrieval (every page kind, tables as their own chunks).

  python -m nccn_nav.fulltext <private>
"""
import json
import re
import sys
from pathlib import Path

from .guideline import Spec
from .layout import PAD, norm_hyphens, page_bands
from .pdfvec import _parse_footnotes, _text_lines, configure, extract_page_graph
from .textlayer import _discussion_label, _is_reference_list

FOOTER_RE = re.compile(r"(Version \d+\.\d{4}, \d\d/\d\d/\d{2,4} ©|PLEASE NOTE that use of this NCCN|Printed by)")


def table_markdown(table):
    rows = [[re.sub(r"\s+", " ", c or "").strip() for c in row] for row in table.extract()]
    rows = [r for r in rows if any(r)]
    if len(rows) < 2:
        return None
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + " --- |" * width]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def reading_order_text(page):
    blocks = page.get_text("blocks", sort=True)
    top, bottom = page_bands(page)
    # From the header rule (page titles can touch it) down to the footer's first line.
    keep = [b[4] for b in blocks if top - PAD - 3 < b[1] < bottom + PAD + 1 and not FOOTER_RE.search(b[4])]
    return norm_hyphens(re.sub(r"[ \t]+", " ", "\n".join(keep)).strip())


def build(private):
    private = Path(private)
    spec = Spec(private)
    configure(spec)
    doc, ids = spec.doc, spec.ids
    pages = []
    for i, page in enumerate(doc):
        code = ids.get(i)
        kind = spec.kind(i)
        if kind == "discussion":
            code = _discussion_label(page) or f"MS-p{i + 1}"
            if _is_reference_list(page):
                kind = "references"
        entry = {"index": i, "code": code or f"p{i + 1}", "kind": kind, "text": reading_order_text(page),
                 "tables": [], "footnotes": {}}
        if kind in ("algorithm", "principles", "staging", "other"):
            found = page.find_tables(strategy="lines").tables
            entry["tables"] = [md for md in (table_markdown(t) for t in found) if md]
        if kind == "footnotes":
            entry["footnotes"] = _parse_footnotes(_text_lines(page), page.rect.width)
        elif kind == "algorithm":
            entry["footnotes"] = extract_page_graph(doc, i)["footnotes"]
        pages.append(entry)
    # Unruled staging tables: use the vision transcription (review/staging_tables.json) if present.
    staging = private / "review" / "staging_tables.json"
    if staging.exists():
        tables = json.loads(staging.read_text())
        for p in pages:
            if p["code"] in tables:
                p["tables"] = tables[p["code"]]
    (private / "pages.json").write_text(json.dumps(pages, indent=1))
    return pages


def chunk_pages(pages, max_words=220):
    chunks = []
    for p in pages:
        if p["kind"] in ("front", "references"):
            continue
        for md in p["tables"]:
            chunks.append({"source": p["kind"] + "-table", "page": p["code"], "text": md})
        for letter, note in p["footnotes"].items():
            chunks.append({"source": "footnote", "page": p["code"], "text": f"Footnote {letter}: {note}"})
        buf = []
        for para in re.split(r"\n(?=[A-Z•◊])", p["text"]):
            buf.append(para.replace("\n", " "))
            if sum(len(b.split()) for b in buf) >= max_words:
                chunks.append({"source": p["kind"], "page": p["code"], "text": " ".join(buf)})
                buf = []
        if buf:
            chunks.append({"source": p["kind"], "page": p["code"], "text": " ".join(buf)})
    for n, c in enumerate(chunks):
        c["id"] = f"f{n}"
    return chunks


def main(private):
    pages = build(private)
    chunks = chunk_pages(pages)
    (Path(private) / "chunks_full.json").write_text(json.dumps(chunks))
    kinds = {}
    for p in pages:
        kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
    print("pages by kind:", kinds)
    print("tables:", sum(len(p["tables"]) for p in pages), "footnotes:",
          len({k for p in pages for k in p["footnotes"]}), "chunks:", len(chunks))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "private")
