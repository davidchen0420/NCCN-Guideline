"""Per-guideline layout, detected from the PDF instead of hard-coded for prostate.

Every NCCN guideline labels its pages bottom-right with a code: algorithm pages are
<PREFIX>-<n> (e.g. PROS-3, NSCL-12, DIAG-1, COL-5), their footnote pages <PREFIX>-<n>A,
principles pages <PREFIX>-<letter(s)>, plus ST- (staging), MS- (discussion), ABBR-, CAT-.
A guideline can have several algorithm prefixes (NSCLC: PREV, DIAG, NSCL).

Data for guideline <slug> lives in private/<slug>/ with the PDF at pdf/<slug>.pdf.
"""
import re
from collections import Counter
from functools import cached_property
from pathlib import Path

import pymupdf

LABEL_RE = re.compile(r"[A-Z]{2,6}-[A-Z0-9]{1,4}")
NON_FLOW = {"ST", "MS", "ABBR", "CAT", "UPDATES"}


def page_labels(doc):
    """0-based page index -> bottom-right page code."""
    out = {}
    for i, page in enumerate(doc):
        w, h = page.rect.width, page.rect.height
        for b in page.get_text("dict")["blocks"]:
            for line in b.get("lines", []):
                for s in line["spans"]:
                    t = s["text"].strip()
                    if LABEL_RE.fullmatch(t) and s["bbox"][1] > h * 0.85 and s["bbox"][0] > w * 0.6:
                        out[i] = t
    return out


class Spec:
    def __init__(self, root):
        self.root = Path(root)
        self.slug = self.root.name
        self.pdf = self.root / "pdf" / f"{self.slug}.pdf"

    @cached_property
    def doc(self):
        return pymupdf.open(self.pdf)

    @cached_property
    def ids(self):
        return page_labels(self.doc)

    @cached_property
    def prefixes(self):
        """Algorithm prefixes: those with at least one numbered page."""
        counts = Counter(c.split("-")[0] for c in self.ids.values() if re.fullmatch(r"[A-Z]+-\d+", c))
        return sorted(p for p in counts if p not in NON_FLOW)

    def _alt(self):
        return "|".join(self.prefixes)

    @cached_property
    def flow_re(self):
        return re.compile(rf"(?:{self._alt()})-\d+")

    @cached_property
    def footnote_page_re(self):
        return re.compile(rf"(?:{self._alt()})-\d+A")

    @cached_property
    def principles_re(self):
        return re.compile(rf"(?:{self._alt()})-[A-Z]{{1,2}}")

    @cached_property
    def link_re(self):
        """Page references printed in boxes, e.g. "(NSCL-3)" or "(COL-D 2 of 4)"."""
        return re.compile(rf"\(((?:{self._alt()}|ST)-[A-Z0-9]+(?: \d+ of \d+)?)\)")

    @cached_property
    def discussion_start(self):
        ms = [i for i, c in self.ids.items() if c.startswith("MS-")]
        return min(ms) if ms else len(self.doc)

    @cached_property
    def first_flow(self):
        flow = [i for i, c in self.ids.items() if self.flow_re.fullmatch(c)]
        return min(flow) if flow else 0

    def flow_pages(self):
        """Algorithm page codes in document order (each code once)."""
        seen = []
        for i in sorted(self.ids):
            c = self.ids[i]
            if self.flow_re.fullmatch(c) and c not in seen:
                seen.append(c)
        return seen

    def index_of(self, code):
        return next(i for i in sorted(self.ids) if self.ids[i] == code)

    def kind(self, index):
        code = self.ids.get(index)
        if code is None:
            if index < 2:
                return "front"  # cover and panel list
            if index < self.first_flow:
                return "updates"
            return "discussion" if index >= self.discussion_start else "other"
        if self.flow_re.fullmatch(code):
            return "algorithm"
        if self.footnote_page_re.fullmatch(code):
            return "footnotes"
        if self.principles_re.fullmatch(code):
            return "principles"
        if code.startswith("ST-"):
            return "staging"
        if code.startswith("MS-"):
            return "discussion"
        return "other"

    def path(self, name):
        return self.root / name


def spec(root):
    return Spec(root)
