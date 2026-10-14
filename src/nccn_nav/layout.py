"""Per-page header and footer bands, detected from the page itself (no fixed coordinates).

NCCN pages carry a running header (logo, title, navigation links) closed by a full-width
rule, and a footer ("Note: All recommendations are category 2A...", the page code and the
"Version x.yyyy ©" line). Content lies between the two. Detection falls back to the
typical proportions of an NCCN page when a page has no rule or no footer.
"""
import re

FOOTER_LINE_RE = re.compile(
    r"^(Note: All recommendations|Version \d+\.\d{4}\b.*©|PLEASE NOTE that use of this NCCN|Printed by)")

# Hyphen look-alikes some guidelines use in page codes ("THYR\u20111"); en/em dashes are kept
# because they mark ranges in doses and values.
_HYPHENS = str.maketrans({"\u2010": "-", "\u2011": "-", "\u2012": "-"})


def norm_hyphens(text):
    return text.translate(_HYPHENS)


# Fallback proportions (a 612pt-high page has its header rule near 80pt, its footer near 561pt).
TOP_FRACTION, BOTTOM_FRACTION = 0.139, 0.907
PAD = 5  # gap between a rule/footer line and the content kept


def header_bottom(page, drawings=None):
    """y just below the full-width rule closing the running header (topmost wide thin rule
    in the top 30% of the page)."""
    w, h = page.rect.width, page.rect.height
    rules = [g["rect"].y1 for g in (drawings if drawings is not None else page.get_drawings())
             if g["rect"].width > 0.6 * w and g["rect"].height < 4 and g["rect"].y1 < 0.3 * h]
    return (min(rules) + PAD) if rules else TOP_FRACTION * h


def footer_top(page):
    """y just above the first footer line in the bottom quarter of the page."""
    h = page.rect.height
    tops = [line["bbox"][1]
            for b in page.get_text("dict")["blocks"] for line in b.get("lines", [])
            if line["bbox"][1] > 0.75 * h
            and FOOTER_LINE_RE.match("".join(s["text"] for s in line["spans"]).strip())]
    return (min(tops) - PAD - 1) if tops else BOTTOM_FRACTION * h


def page_bands(page, drawings=None):
    """(top, bottom): the content band of a page."""
    return header_bottom(page, drawings), footer_top(page)
