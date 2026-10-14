"""Build the interactive guideline dashboard as one self-contained HTML file.

Reads the processed guideline folder (merged_graphs.json or e1_graphs.json, footnotes.json,
fact_schema.json, llm/pred_out_*.json predicate drafts, chunks_full.json) and writes
private/viz/dashboard.html plus bundle.json. The output contains guideline text, so it
belongs in the gitignored private directory. `--sample` builds from a synthetic demo.

  python -m nccn_nav.dashboard [data_dir]  ->  private/viz/dashboard.html (default data_dir: data/prostate)
  python -m nccn_nav.dashboard --sample    ->  <tmp or ./sample_out>/dashboard.html
"""
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
W, H = 792, 612  # PDF page size in points
TOP, BOTTOM = 85, 560
PAGE_RE = re.compile(r"[A-Z]+-\d+")


def _page_order(page):
    m = re.fullmatch(r"([A-Z]+)-(\d+)", page)
    return (m.group(1), int(m.group(2))) if m else (page, 0)


def _load(private, *names):
    for name in names:
        path = Path(private) / name
        if path.exists():
            return json.loads(path.read_text())
    return None


def footnote_source(store, page, letter):
    """(text, page code that prints it). Same lookup as pdfvec.footnote_text (letters repeat across pages)."""
    for code in (page, page + "A"):
        if letter in store.get(code, {}):
            return store[code][letter], code
    prefix = page.split("-")[0] + "-"
    for code, notes in store.items():
        if code.startswith(prefix) and letter in notes:
            return notes[letter], code
    return None, None


def footnote_text(store, page, letter):
    return footnote_source(store, page, letter)[0]


def load_predicates(private):
    """Branch conditions keyed by position-based box id, and their review status.

    predicates.json is the current, reviewed set: a null value means review rejected the
    draft, so the box has no condition. The raw LLM drafts in llm/pred_out_*.json are used
    only when no predicates.json exists (they still contain the rejected conditions).
    Returns (preds, review) where review maps box id -> "reviewed" | "draft" | "rejected"
    (rejected: the box has no condition because review rejected the draft)."""
    private = Path(private)
    path = private / "predicates.json"
    if path.exists():
        preds = {k: v for k, v in json.loads(path.read_text()).items() if v}
    else:
        preds = {}
        for f in sorted((private / "llm").glob("pred_out_*.json")):
            preds.update({k: v for k, v in json.loads(f.read_text()).items() if v})
    status = _load(private, "predicates_status.json") or {}
    reviewed = set(status.get("reviewed_correct", []))
    review = {k: "reviewed" if k in reviewed else "draft" for k in preds}
    # Boxes whose drafted condition review rejected: the viewer flags them as "not encoded".
    review.update({k: "rejected" for k in status.get("rejected", []) if k not in preds})
    return preds, review


DOC_KINDS = {"principles": "principles", "staging": "staging", "discussion": "discussion", "other": "reference"}


JUNK = re.compile("[\ue000-\uf8ff\x00-\x08\x0b\x0c\x0e-\x16\x18-\x1f\u200b\ufeff]")


def clean(text, keep_subbullet=False):
    """Drop private-use glyphs and control characters that the PDF text layer leaves behind.
    U+0017 is the sub-bullet marker inside algorithm boxes, so box text keeps it."""
    text = JUNK.sub("", str(text))
    return text if keep_subbullet else text.replace("\x17", "")


def build_docs(private):
    """Principles, staging, abbreviation and discussion pages grouped by page code, in reading order."""
    pages = _load(private, "pages.json") or []
    docs = {}
    for pg in pages:
        kind = DOC_KINDS.get(pg.get("kind"))
        code = pg.get("code")
        if not kind or not code or not str(pg.get("text", "")).strip():
            continue
        d = docs.setdefault(code, {"code": code, "kind": kind, "title": "", "pages": []})
        d["pages"].append({"text": clean(pg["text"]), "tables": [clean(t) for t in (pg.get("tables") or [])],
                           "pdf": pg.get("index")})
    for code, d in docs.items():
        d["title"] = doc_title(d["kind"], code, d["pages"][0]["text"])
    return docs


def _title_like(line):
    """Heading-like: most content words capitalised, no trailing footnote number like 'males.56'."""
    if re.search(r"\w\.\d", line) or re.search(r"\d,\d", line) or re.fullmatch(r"[A-Z]+\d+", line):
        return False
    if line.count(",") >= 2 or ":" in line or "=" in line:
        return False
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z\-/']*", line) if w.lower() not in SMALL_WORDS]
    return bool(words) and sum(w[0].isupper() for w in words) / len(words) >= 0.7


def doc_title(kind, code, text):
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if kind == "discussion":
        # Discussion pages have no running title: use the first short heading-like line.
        for ln in lines[:30]:
            if (3 < len(ln) <= 70 and ln[0].isupper() and not ln.endswith((".", ",", ";", ":", "-"))
                    and "...." not in ln and not re.fullmatch(r"[\d\W]+", ln)
                    and not ln.lower().startswith(("this discussion", "nccn", "version", "page"))
                    and len(ln.split()) <= 9 and _title_like(ln)):
                return ln
        return f"Page {code.split('-')[-1]}"
    first = lines[0] if lines else code
    return smart_title(first) if first.isupper() else first


ACRONYMS = {"PSA", "ADT", "CRPC", "CSPC", "RT", "RP", "MDT", "BCR", "BRCA", "DNA", "MRI", "PET", "CT", "PSMA", "ARPI", "HRR", "FDA", "TNM", "AJCC", "NCCN", "M0", "M1", "N0", "N1"}
SMALL_WORDS = {"and", "or", "for", "of", "the", "in", "to", "with", "on", "a", "an"}


def smart_title(text):
    """Title-case an ALL-CAPS heading but keep clinical acronyms and stage codes in capitals."""
    words = text.split()
    out = []
    for i, w in enumerate(words):
        core = re.sub(r"[^A-Za-z0-9]", "", w)
        if core.upper() in ACRONYMS or re.search(r"\d", core) and core.isupper():
            out.append(w.upper() if core.upper() in ACRONYMS or re.search(r"\d", core) else w)
        elif i and core.lower() in SMALL_WORDS and not (core == "A" and i == len(words) - 1):  # "Option A"
            out.append(w.lower())
        else:
            out.append(re.sub(r"[A-Za-z]+", lambda m: m.group(0)[:1].upper() + m.group(0)[1:].lower(), w))
    return " ".join(out)


def page_titles(private):
    """Readable title per algorithm page, from the page text (footnote pages carry a clean copy)."""
    out = {}
    for pg in _load(private, "pages.json") or []:
        if pg.get("kind") not in ("algorithm", "footnotes"):
            continue
        code = re.sub(r"(?<=\d)A$", "", pg.get("code", ""))
        first = next((ln.strip() for ln in str(pg.get("text", "")).splitlines() if ln.strip()), "")
        first = re.sub(r"(?<=[A-Z)])[a-z]{1,3}(?:,[a-z]{1,3})*$", "", first).strip()
        if not first or first.upper() == "FOOTNOTES":
            continue
        if pg["kind"] == "footnotes" or code not in out:
            out[code] = smart_title(first) if first.isupper() else first
    return out


def build_bundle(private):
    graphs = _load(private, "merged_graphs.json", "e1_graphs.json")
    if graphs is None:
        raise FileNotFoundError(f"no merged_graphs.json or e1_graphs.json in {private}")
    notes = _load(private, "footnotes.json") or {}
    preds, review = load_predicates(private)
    valid = {f"{pg}:{n['id']}" for pg, g in graphs.items() for n in g["nodes"]}
    preds = {k: v for k, v in preds.items() if k in valid}
    preds_draft = any(review.get(k) != "reviewed" for k in preds)
    store = _load(private, "pages.json") or []
    first_index = {}  # page code -> PDF page index (0-based) of its first page
    for pg in store:
        if "index" in pg:
            first_index.setdefault(pg.get("code"), pg["index"])
    schema = _load(private, "fact_schema.json") or {"variables": {}, "derived": {}}
    docs = build_docs(private)
    titles = page_titles(private)

    pages, links, children, roots = {}, set(), {}, {}
    for page in sorted(graphs, key=_page_order):
        g = graphs[page]
        has_parent = {e["dst"] for e in g["edges"]}
        has_child = {e["src"] for e in g["edges"]}
        nodes = []
        for n in g["nodes"]:
            nid = f"{page}:{n['id']}"
            node_links = [re.sub(r"\s.*", "", link) for link in n.get("links", [])]
            # A table cell that is only a page code ("PROS-3") points at that page.
            only = re.fullmatch(r"\(?\s*([A-Z]+-\d+)\s*\)?", n["text"].strip())
            if not node_links and only and only.group(1) != page:
                node_links = [only.group(1)]
            fns = []
            for r in n.get("footnote_refs", []):
                text, src = footnote_source(notes, page, r)
                if text:  # [letter, text, PDF page index of the page that prints it]
                    fns.append([r, clean(text), first_index.get(src, g.get("page_index"))])
            nodes.append({"id": n["id"], "kind": n.get("kind", "box"), "text": clean(n["text"], True), "bbox": n["bbox"],
                          "pred": preds.get(nid), "review": review.get(nid),
                          "links": node_links, "role": n.get("role"), "footnotes": fns})
            if n.get("kind", "box") == "box":
                children[nid] = []
                for link in node_links:
                    if link != page:
                        links.add((page, link))
        ids = {n["id"] for n in nodes if n["kind"] == "box"}
        edges, counts = [], {}
        for e in g["edges"]:
            if e["src"] not in ids or e["dst"] not in ids:
                continue
            sup = e.get("support", "agreed")
            cls = "unsure" if ("unsure" in sup or sup.endswith("_only")) else ("verified" if "verified" in sup else "agreed")
            counts[cls] = counts.get(cls, 0) + 1
            edges.append({"src": e["src"], "dst": e["dst"], "cls": cls})
            children[f"{page}:{e['src']}"].append(f"{page}:{e['dst']}")
        roots[page] = [f"{page}:{n['id']}" for n in nodes
                       if n["kind"] == "box" and n["id"] not in has_parent and n["id"] in has_child]
        pages[page] = {"nodes": nodes, "edges": edges, "counts": counts, "title": titles.get(page, ""),
                       "pdf": g.get("page_index", first_index.get(page))}

    # A leaf that points at another flow page continues on that page's entry boxes (as in navigator.py).
    for page, pg in pages.items():
        for n in pg["nodes"]:
            nid = f"{page}:{n['id']}"
            if n["kind"] == "box" and not children[nid]:
                for link in n["links"]:
                    if link != page and link in roots and PAGE_RE.fullmatch(link):
                        children[nid] += roots[link]

    return {"pages": pages, "links": sorted(links), "children": children, "roots": roots,
            "docs": docs, "schema": schema, "preds_draft": preds_draft,
            "w": W, "h": H, "top": TOP, "bottom": BOTTOM,
            "title": _load(private, "title.json") or front_title(store) or "Guideline navigator",
            "pdf_pages": len(store), "pdf_candidates": [],
            "examples": _load(private, "vignettes/examples.json") or []}


def front_title(store):
    """'Prostate Cancer · v6.2026' from the cover page text."""
    if not store:
        return None
    lines = [ln.strip() for ln in str(store[0].get("text", "")).splitlines() if ln.strip()]
    name = next((ln for ln in lines if "NCCN" not in ln and not ln.lower().startswith("version")), None)
    version = next((m.group(1) for ln in lines for m in [re.search(r"Version (\S+)", ln)] if m), None)
    if not name:
        return None
    return f"{name} · v{version}" if version else name


def build(private, out_dir=None, title=None):
    bundle = build_bundle(private)
    if title:
        bundle["title"] = title
    out_dir = Path(out_dir) if out_dir else Path("private") / "viz"
    out_dir.mkdir(parents=True, exist_ok=True)
    # Where the viewer looks for the source PDF when served over http (never embedded: licensed).
    slug = Path(private).resolve().name
    spots = [Path(private) / "pdf" / f"{slug}.pdf", Path("private") / slug / "pdf" / f"{slug}.pdf"]
    bundle["pdf_candidates"] = list(dict.fromkeys(
        Path(os.path.relpath(p.resolve(), out_dir.resolve())).as_posix() for p in spots))
    template = (HERE / "dashboard.html").read_text()
    doc = template.replace("/*BUNDLE*/null", json.dumps(bundle).replace("</", "<\\/"))
    (out_dir / "bundle.json").write_text(json.dumps(bundle))
    out = out_dir / "dashboard.html"
    out.write_text(doc)
    return out, bundle


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--sample":
        out_dir = Path(args[1]) if len(args) > 1 else Path("sample_out")
        path, b = build(HERE / "sample", out_dir, "Sample guideline (synthetic demo data)")
    else:
        path, b = build(args[0] if args else "data/prostate")
    print(path, len(b["pages"]), "flow pages", sum(len(p["nodes"]) for p in b["pages"].values()), "boxes")
