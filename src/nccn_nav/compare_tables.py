"""Compare table extractors on table-heavy pages: PyMuPDF (lines / text strategies) vs Docling
(layout + TableFormer, OCR off because the PDF has a text layer). Metric: share of the page's
content words recovered inside extracted tables. Prints numbers only.

  python -m nccn_nav.compare_tables <private>   (Docling optional: pip install docling)
"""
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

PAGES = [(12, "PROS-2"), (34, "PROS-18"), (95, "ST-1"), (66, "PROS-H")]


def words(text):
    return Counter(w.lower() for w in re.findall(r"[A-Za-z0-9]{3,}", text))


def recall(src, got):
    return sum(min(n, got[w]) for w, n in src.items()) / max(sum(src.values()), 1)


def docling_tables(pdf_path):
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opts = PdfPipelineOptions(do_ocr=False, do_table_structure=True)
    conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
    doc = conv.convert(str(pdf_path)).document
    by_page = {}
    for t in doc.tables:
        page = t.prov[0].page_no if t.prov else None
        by_page[page] = by_page.get(page, "") + " " + t.export_to_markdown(doc=doc)
    return by_page


def main(private):
    private = Path(private)
    doc = pymupdf.open(private / "pdf" / "prostate.pdf")
    sub = pymupdf.open()
    for i, _ in PAGES:
        sub.insert_pdf(doc, from_page=i, to_page=i)
    sub_path = private / "tables_subset.pdf"
    sub.save(sub_path)
    try:
        dl = docling_tables(sub_path)
    except ImportError:
        dl = None
    for k, (i, name) in enumerate(PAGES):
        page = doc[i]
        src = words(" ".join(b[4] for b in page.get_text("blocks") if 85 < b[1] < 540))
        row = [name]
        for strategy in ("lines", "text"):
            text = " ".join(" ".join(c or "" for r in t.extract() for c in r)
                            for t in page.find_tables(strategy=strategy).tables)
            row.append(f"pymupdf-{strategy} {recall(src, words(text)):.2f}")
        if dl is not None:
            row.append(f"docling {recall(src, words(dl.get(k + 1, ''))):.2f}")
        print(" | ".join(row))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "private")
