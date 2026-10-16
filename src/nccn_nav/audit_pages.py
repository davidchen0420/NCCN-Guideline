"""Find pages that carry algorithm content but are not usable as algorithm pages.

Footnote pages (`<PREFIX>-<n>A`) are classified by their page code alone, so a lettered page that
continues the flowchart (a workup, a bridge between two algorithm pages) ends up with kind
"footnotes" (or "other" for `B`, `C`, ...) and no boxes. Other boxes still link to it, which
leaves dead ends. Pages whose boxes were lost (two pages with one code) and algorithm pages
without an entry box are dead ends of the same kind.

  python -m nccn_nav.audit_pages [--data data] [--out reports/misclassified-pages.md]
                                 [--pdfs DIR] [--review reports/misclassified-pages-review.json]
                                 [--json] [--all-kinds]

For every guideline in `data/index.json` it lists

  1. pages whose kind is not "algorithm" (footnotes, other, staging, principles; front matter, update
     lists and the discussion are skipped) with a link into them or with algorithm signals,
  2. algorithm pages without any box that a box links to,
  3. algorithm pages with boxes but no entry box that a box links to,
  4. the worklist: every dead-end link target (a page with no entry box that boxes on algorithm pages link to),
     with whether it is genuine algorithm content, an estimated size and the action to take
  5. pages already re-extracted (page key `reextracted`, see page_spec.py), with their earlier kind.

Signals of a page (columns):

  linked   distinct boxes on algorithm pages whose `links` point at the page ("Footnotes on X" notes
           do not count: they point at footnotes on purpose)
  vec      vector drawings (box outlines, connectors, arrowheads) inside the content band
  body     text lines of the page that are not footnote definitions
  arrows   "->" glyphs in the page text
  sees     "See XXX-n" references outside footnote definitions
  codes    algorithm page codes printed in the body or inside footnote text (algorithm text that was
           absorbed into a footnote shows up as a long footnote holding page codes)

`principles` pages are reference material that boxes link to by design, so they are listed only when
the signals are strong (arrows), with `--all-kinds` all of them. `--review` merges a reviewer's
decision per page ({"<slug>:<page>": "text"}) into the report.

Needs PyMuPDF and the source PDFs (found like the dashboard does); without a PDF only the text
signals are used.
"""
import argparse
import json
import re
import sys
from pathlib import Path

CODE_RE = re.compile(r"\b[A-Z][A-Z0-9_/]{1,11}-\d+[A-Z]?\b")
SEE_RE = re.compile(r"\bSee\s+[A-Z][A-Z0-9_/]{1,11}-[A-Z0-9]+")
FOOTNOTE_LINE = re.compile(r"^[a-z]{1,2}\s+\S")
FOOTNOTE_POINTER = re.compile(r"^\s*Footnotes?\s+(on|for)\b", re.I)
AUDIT_KINDS = ("footnotes", "other", "staging", "principles")
TITLE_FOOTNOTES = re.compile(r"\b(FOOTNOTES|REFERENCES)\b", re.I)
DOC_KINDS = {"principles", "staging", "discussion", "references", "front", "updates"}  # shown as documents, not walked
PRINCIPLES_CODE = re.compile(r"^[A-Z0-9_/]+-[A-Z]{1,3}(?: \d+ of \d+)?$")   # "NE-B 1 of 6": a letter, no number
VEC_FLOWCHART = 12   # a plain footnote page draws at most ~10 lines (header rule, bullets)


def _split_lines(text):
    return [ln.strip() for ln in text.split("\n") if ln.strip()]


def page_signals(page, algorithm_prefixes):
    """Text signals of one guideline page dict."""
    lines = _split_lines(page["text"])
    fn_texts = list((page.get("footnotes") or {}).values())
    # a footnote definition line starts with its letter ("a All patients ..."); anything else that
    # is not a continuation of a footnote is body text
    fn_blob = " ".join(fn_texts)
    body = [ln for ln in lines if not FOOTNOTE_LINE.match(ln) and ln not in fn_blob]
    codes_body = [c for c in CODE_RE.findall("\n".join(body)) if c.split("-")[0] in algorithm_prefixes]
    codes_fn = [c for c in CODE_RE.findall(fn_blob) if c.split("-")[0] in algorithm_prefixes]
    long_fn = sum(1 for t in fn_texts if len(t) > 450)
    return {
        "body": len(body),
        "arrows": page["text"].count("\u2192"),
        "sees": len(SEE_RE.findall("\n".join(body))),
        "codes": len(codes_body) + len(codes_fn),
        "long_fn": long_fn,
    }


def vector_count(doc, page):
    """Vector drawings inside the content band, ignoring page-wide hairlines."""
    pg = doc[page["pdf_page"] - 1]
    top, bottom = page.get("content_band") or (0, pg.rect.height)
    n = 0
    for d in pg.get_drawings():
        r = d["rect"]
        if r.y1 < top - 2 or r.y0 > bottom + 2:
            continue
        if r.width > 0.9 * pg.rect.width and r.height < 3:
            continue
        n += 1
    return n


def est_boxes(doc, page):
    """Rough number of boxes of a flowchart page: text blocks in the content band that are not footnotes."""
    pg = doc[page["pdf_page"] - 1]
    top, bottom = page.get("content_band") or (0, pg.rect.height)
    n = 0
    for b in pg.get_text("blocks"):
        if b[6] != 0 or b[3] < top or b[1] > bottom:
            continue
        t = b[4].strip()
        if not t or FOOTNOTE_LINE.match(t) or t.startswith("Note:"):
            continue
        n += 1
    return n


def classify(p, row):
    """(genuine algorithm content?, action) of a dead-end link target. yes = flowchart, list = recommendation
    list without arrows, no = what its kind says (footnotes, references, principles), check = read it."""
    first, body = row["first"], row["body"]
    if TITLE_FOOTNOTES.search(first[:80]) and body < 20:
        return "no", "none: genuine footnote / reference page"
    if p["kind"] != "algorithm" and PRINCIPLES_CODE.match(p["code"]) and not row.get("unlabelled"):
        return "no", "none: principles page typed other (a document, not a flowchart)"
    if p["kind"] == "algorithm" and row["nodes"] > 0:
        if re.search(r"\b(REFERENCES|PRINCIPLES)\b", first[:80]):
            return "no", "none: principles / reference text page typed algorithm"
        return "yes", "add the missing entry box (boxes exist)"
    vec = row["vec"] if row["vec"] is not None else 0
    if vec >= VEC_FLOWCHART and body >= 6:
        return "yes", "re-extract (flowchart)"
    if vec < VEC_FLOWCHART and body >= 8:
        return "list", "re-extract (recommendation list: one entry box)"
    return "check", "read the page; probably none"


def audit(data_dir="data", pdf_roots=None, kinds=AUDIT_KINDS, all_kinds=False):
    """Returns {"candidates", "no_boxes", "no_entry", "reextracted", "reference_pages_linked", "genuine_footnotes"}."""
    import pymupdf
    from .dashboard import find_pdfs
    data_dir = Path(data_dir)
    index = json.loads((data_dir / "index.json").read_text())["guidelines"]
    try:
        pdfs = find_pdfs(str(data_dir), pdf_roots)
    except Exception:
        pdfs = {}
    out = {"candidates": [], "no_boxes": [], "no_entry": [], "reextracted": [], "reference_pages_linked": 0,
           "genuine_footnotes": 0, "worklist": [], "unwired": {}}
    for gi in index:
        slug = gi["slug"]
        g = json.loads((data_dir / slug / "guideline.json").read_text())
        pages = g["pages"]
        algo_ids = {p["id"] for p in pages if p["kind"] == "algorithm"}
        prefixes = {p["code"].split("-")[0] for p in pages if p["kind"] == "algorithm"}
        letter_re = re.compile(r"(?:%s)-\d+[A-Z]" % "|".join(map(re.escape, sorted(prefixes)))) if prefixes else None
        linked, sources = {}, {}
        n_boxes, entry_pages = {}, set()
        for n in g["nodes"]:
            n_boxes[n["page"]] = n_boxes.get(n["page"], 0) + 1
            if n["page"] not in algo_ids or FOOTNOTE_POINTER.match(n["text"]):
                continue
            for pid in {l.get("page") for l in n["links"] if l.get("type") == "page" and l.get("page")}:
                if pid != n["page"]:
                    linked[pid] = linked.get(pid, 0) + 1
                    sources.setdefault(pid, set()).add(n["page"])
        for e in g["entries"]:
            entry_pages.add(e.split(":")[0])
        doc = pymupdf.open(pdfs[slug]) if slug in pdfs else None
        algo_pdf = [p["pdf_page"] for p in pages if p["kind"] == "algorithm"]
        span = (min(algo_pdf), max(algo_pdf)) if algo_pdf else (0, 0)
        # leaf boxes naming an algorithm page that has entry boxes, without a continuation into it
        kids = {e["src"] for e in g["edges"]}
        conts = {}
        for c in g["continuations"]:
            conts.setdefault(c["src"], set()).add(c["page"])
        by_id_page = {p["id"]: p for p in pages}
        unwired = 0
        for n in g["nodes"]:
            if n["page"] not in algo_ids or n["id"] in kids or n["role"] in ("note", "page_heading", "column_header"):
                continue
            for l in n["links"]:
                t = l.get("page")
                if (l.get("type") == "page" and t in entry_pages and t != n["page"]
                        and t not in conts.get(n["id"], ()) and by_id_page[t]["code"] not in conts.get(n["id"], ())):
                    unwired += 1
        out["unwired"][slug] = unwired
        for p in pages:
            reex = p.get("reextracted")
            kind = p.get("kind_before", p["kind"]) if reex else p["kind"]
            if p["id"] in linked and p["id"] not in entry_pages and p["kind"] not in DOC_KINDS:
                sig0 = page_signals(p, prefixes)
                vec0 = vector_count(doc, p) if doc is not None else None
                w = _row(slug, p, kind, linked, sources, n_boxes, vec0, sig0)
                w["unlabelled"] = bool(re.fullmatch(r"p\d+", p["id"]))
                w["genuine"], w["action"] = classify(p, w)
                w["est_boxes"] = w["nodes"] if w["nodes"] else (est_boxes(doc, p) if doc is not None and w["genuine"] != "no" else 0)
                out["worklist"].append(w)
            if p["kind"] == "algorithm" and not reex:
                # dead ends among algorithm pages: no boxes at all, or boxes but no entry box
                if p["id"] in linked and n_boxes.get(p["id"], 0) == 0:
                    out["no_boxes"].append(_row(slug, p, kind, linked, sources, n_boxes, None, page_signals(p, prefixes)))
                elif p["id"] in linked and p["id"] not in entry_pages:
                    out["no_entry"].append(_row(slug, p, kind, linked, sources, n_boxes, None, page_signals(p, prefixes)))
                continue
            if kind not in kinds and not reex:
                continue
            sig = page_signals(p, prefixes)
            vec = vector_count(doc, p) if doc is not None else None
            row = _row(slug, p, kind, linked, sources, n_boxes, vec, sig)
            if reex:
                row["reextracted"] = reex
                out["reextracted"].append(row)
                continue
            flowchart = (vec or 0) >= VEC_FLOWCHART
            # a page without a printed code between the first and last algorithm page is a page the
            # label detector missed (NET "PanNET-2", CNS "NF2-VS-1" use labels it does not read)
            row["unlabelled"] = bool(re.fullmatch(r"p\d+", p["id"])) and span[0] < p["pdf_page"] < span[1]
            lettered = bool(letter_re and letter_re.fullmatch(p["code"]))
            strong = sig["arrows"] > 0 or (flowchart and (sig["body"] >= 8 or sig["codes"] or sig["sees"]))
            weak = sig["sees"] or sig["codes"] or sig["long_fn"] or flowchart
            titled_footnotes = bool(TITLE_FOOTNOTES.search(row["first"][:80])) and sig["body"] < 20
            if kind == "footnotes" or (lettered and kind == "other"):
                if titled_footnotes:
                    out["genuine_footnotes"] += 1   # "FOOTNOTES FOR X-n ..." / "REFERENCES ...": what the code says
                    continue
                keep = row["linked"] > 0 or weak or sig["body"] >= 8
            elif all_kinds:
                keep = True
            else:
                keep = sig["arrows"] > 0 or (flowchart and (row["unlabelled"] or sig["sees"] >= 2))
                if not keep and row["linked"]:
                    out["reference_pages_linked"] += 1
            if keep:
                row["strong"] = bool(strong)
                out["candidates"].append(row)
    return out


def _row(slug, p, kind, linked, sources, n_boxes, vec, sig):
    return {
        "slug": slug, "page": p["id"], "kind": kind, "linked": linked.get(p["id"], 0),
        "from": sorted(sources.get(p["id"], ())), "pdf_page": p["pdf_page"], "vec": vec,
        "nodes": n_boxes.get(p["id"], 0), "first": " ".join(_split_lines(p["text"]))[:120], **sig,
    }


def render(result, review=None):
    review = review or {}

    def cell(s):
        return str(s).replace("|", "\\|").replace("\n", " ")
    head = ("| slug | page | kind | linked from | pdf page | vec | body | sees | codes | boxes | first 120 chars | review |\n"
            "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|\n")

    def line(r):
        return (f"| {r['slug']} | {r['page']} | {r['kind']} | {r['linked']} | {r['pdf_page']} | "
                f"{'' if r['vec'] is None else r['vec']} | {r['body']} | {r['sees']} | {r['codes']} | "
                f"{r['nodes']} | {cell(r['first'])} | {cell(review.get(r['slug'] + ':' + r['page'], ''))} |\n")

    cands = result["candidates"]
    strong = sorted((r for r in cands if r["strong"]), key=lambda r: (-(r["vec"] or 0), r["slug"], r["page"]))
    weak = sorted((r for r in cands if not r["strong"]), key=lambda r: (-r["linked"], r["slug"], r["page"]))
    by_kind = {}
    for r in cands + result["reextracted"]:
        by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + 1
    out = ["# Pages with algorithm content that are not usable algorithm pages\n\n",
           "Generated by `python -m nccn_nav.audit_pages` (columns and rules in its docstring). `vec` is the number of vector "
           "drawings in the content band (a plain footnote page has under about 12), `body` the text lines that are not "
           "footnote definitions, `codes` the algorithm page codes printed in the body or inside footnote text, `boxes` the "
           "boxes the page has in guideline.json. A page is only a real miss after reading it; the last column is that decision.\n\n"]
    if review.get("_notes"):
        out.append(review["_notes"].strip() + "\n\n")
    done, nb, ne = result["reextracted"], result["no_boxes"], result["no_entry"]
    out.append(f"- {len(cands) + len(done)} pages typed footnotes / other / principles / staging carry signals or are linked to "
               f"({', '.join(f'{k}: {v}' for k, v in sorted(by_kind.items()))}); {len(done)} of them are re-extracted, "
               f"{len(cands)} remain listed below ({len(strong)} with strong signals).\n")
    out.append(f"- {len(nb)} algorithm pages without any box and {len(ne)} algorithm pages with boxes but no entry box are linked to.\n")
    out.append(f"- Not listed: {result['genuine_footnotes']} lettered pages titled FOOTNOTES / REFERENCES with little body text (what their "
               f"code says they are) and another {result['reference_pages_linked']} principles, staging or other reference pages that boxes "
               "link to without algorithm signals.\n\n")
    wl = result["worklist"]
    todo = [r for r in wl if r["genuine"] in ("yes", "list")]
    out.append(f"- Dead-end link targets (a page with no entry box that boxes on algorithm pages link to; principles and staging "
               f"pages are shown as documents and left out): {len(wl)} pages, {sum(r['linked'] for r in wl)} boxes; "
               f"{len(todo)} carry algorithm content (worklist, about {sum(r['est_boxes'] for r in todo)} boxes), "
               f"{sum(r['genuine'] == 'check' for r in wl)} need a look, {sum(r['genuine'] == 'no' for r in wl)} are genuine footnote / "
               f"reference pages that boxes link to on purpose.\n")
    out.append(f"- {sum(result['unwired'].values())} leaf boxes name an algorithm page that has entry boxes but have no continuation "
               "into it (`page_spec wire --all` adds them; not applied).\n\n")
    per = {}
    for r in wl:
        d = per.setdefault(r["slug"], {"pages": 0, "boxes": 0, "todo": 0, "est": 0, "check": 0, "no": 0})
        d["pages"] += 1
        d["boxes"] += r["linked"]
        if r["genuine"] in ("yes", "list"):
            d["todo"] += 1
            d["est"] += r["est_boxes"]
        else:
            d["check" if r["genuine"] == "check" else "no"] += 1
    out.append("## Worklist per guideline\n\n| slug | dead-end pages | boxes linking | to re-extract | est. boxes | to check | genuine (leave) | unwired leaf boxes |\n"
               "|---|---:|---:|---:|---:|---:|---:|---:|\n")
    for slug in sorted(set(per) | {k for k, v in result["unwired"].items() if v}):
        d = per.get(slug, {"pages": 0, "boxes": 0, "todo": 0, "est": 0, "check": 0, "no": 0})
        out.append(f"| {slug} | {d['pages']} | {d['boxes']} | {d['todo']} | {d['est']} | {d['check']} | {d['no']} | {result['unwired'].get(slug, 0)} |\n")
    out.append("\n## Every dead-end link target\n\n`genuine`: yes = flowchart, list = recommendation list without arrows (one entry box), "
               "check = read it, no = leave. `est. boxes` is the count of boxes that exist, else of text blocks in the content band.\n\n"
               "| slug | page | kind | linked from (boxes) | pdf page | genuine algorithm content | est. boxes | action | first 120 chars | review |\n"
               "|---|---|---|---:|---:|---|---:|---|---|---|\n")
    for r in sorted(wl, key=lambda r: (r["slug"], r["pdf_page"])):
        out.append(f"| {r['slug']} | {r['page']} | {r['kind']} | {r['linked']} | {r['pdf_page']} | {r['genuine']} | {r['est_boxes']} | "
                   f"{cell(r['action'])} | {cell(r['first'])} | {cell(review.get(r['slug'] + ':' + r['page'], ''))} |\n")
    out.append("\n## Re-extracted (now algorithm pages)\n\nKind is the earlier one.\n\n" + head)
    out += [line(r) for r in sorted(done, key=lambda r: (r["slug"], r["page"]))]
    out.append("\n## Algorithm pages without any box\n\n" + head)
    out += [line(r) for r in sorted(nb, key=lambda r: (r["slug"], r["pdf_page"]))]
    out.append("\n## Algorithm pages with boxes but no entry box\n\n" + head)
    out += [line(r) for r in sorted(ne, key=lambda r: (r["slug"], r["pdf_page"]))]
    out.append("\n## Not re-extracted: strong signals (flowchart-like drawings with body text, page codes or arrows)\n\n" + head)
    out += [line(r) for r in strong]
    out.append("\n## Not re-extracted: linked from a box or weak signal\n\n" + head)
    out += [line(r) for r in weak]
    return "".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data", default="data")
    ap.add_argument("--out", default=None, help="write the Markdown report here (default: print it)")
    ap.add_argument("--pdfs", action="append", help="extra folder to search for the source PDFs")
    ap.add_argument("--review", default=None, help="JSON {'<slug>:<page>': 'decision'} merged into the report")
    ap.add_argument("--json", action="store_true", help="print JSON instead of Markdown")
    ap.add_argument("--all-kinds", action="store_true", help="also list principles pages that merely are linked to")
    a = ap.parse_args(argv)
    result = audit(a.data, a.pdfs, all_kinds=a.all_kinds)
    review = json.loads(Path(a.review).read_text()) if a.review and Path(a.review).exists() else None
    text = json.dumps(result, indent=1) if a.json else render(result, review)
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(text)
        print(f"{len(result['candidates'])} pages listed, {len(result['reextracted'])} re-extracted, "
              f"{len(result['no_boxes'])} without boxes, {len(result['no_entry'])} without entry -> {a.out}")
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
