"""One canonical, self-contained file per guideline: <private>/<slug>/guideline.json.

Everything a reader, viewer or engine needs is resolved here by code, so consumers never
re-derive it from intermediate files (merged_graphs.json, predicates*.json, llm/*):

  guideline   slug, title, version and date printed on the cover, PDF SHA-256 and page count
  sections    disease/subtype sections (sections.py) and the enum variable that names them
  pages       every PDF page: unique id ("PROS-F 2 of 5" for multi-page codes), printed code,
              part, 1-based pdf_page, kind, running title, section, heading, size, content
              band, full text, tables (markdown), footnotes {letter: text}
  nodes       every flowchart/table box: text, lines and boxes in PDF points, structural role,
              decision type (condition/option/other), footnotes with the page each letter was
              resolved on, resolved links, effective predicate with its review status, the
              "already received" predicate of options, and a PDF check of its position
  edges       arrows with their evidence: two_methods, image_checked, table_text_checked,
              single_source
  continuations  leaf -> another page's entry boxes, for every page reference
  schema      the patient-fact schema
  quality     counts that say how complete and how checked the representation is

  python -m nccn_nav.bundle private/<slug> [...]     write guideline.json
  python -m nccn_nav.bundle archive private/<slug>   move superseded files to archive/
"""
import csv
import datetime
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from .guideline import Spec
from .layout import page_bands, page_title
from .scoring import norm

PAGE_REF_RE = re.compile(r"\b([A-Z][A-Z0-9_/]{1,11})-([A-Z0-9]{1,4})(?: \(?(\d+) of (\d+)\)?)?(?![A-Za-z0-9])")
VERSION_RE = re.compile(r"Version (\d+\.\d{4})\s*[—–-]\s*([A-Z][a-z]+ \d{1,2}, \d{4})")
SHARED_PREFIXES = {"ST", "MS"}  # staging and discussion pages exist in every guideline
EVIDENCE = {"agreed": "two_methods", "verified": "image_checked", "table": "table_text_checked",
            "e1_only": "single_source", "e2_only": "single_source"}
ROOT_DIR = Path(__file__).resolve().parents[2]


def manifest():
    with (ROOT_DIR / "NCCN Guidelines" / "manifest.csv").open() as f:
        return {r["slug"]: r for r in csv.DictReader(f)}


def prefix_index(private):
    """Page-code prefix -> slug for prefixes used by exactly one guideline (cross-guideline links
    such as "DIS-A" -> distress_management)."""
    path = Path(private) / "prefix_index.json"
    if path.exists():
        return json.loads(path.read_text())
    owners = defaultdict(set)
    for p in Path(private).glob("*/pages.json"):
        for page in json.loads(p.read_text()):
            m = re.match(r"([A-Z][A-Z0-9_/]{1,11})-", page["code"] or "")
            if m:
                owners[m.group(1)].add(p.parent.name)
    index = {k: sorted(v)[0] for k, v in owners.items() if len(v) == 1 and k not in SHARED_PREFIXES}
    path.write_text(json.dumps(index, indent=0, sort_keys=True))
    return index


def _tokens(t):
    return norm(t).split()


def _cover(text, inside):
    t, have = _tokens(text), Counter(_tokens(inside))
    return sum((Counter(t) & have).values()) / max(len(t), 1)


class Bundler:
    def __init__(self, root):
        self.root = Path(root)
        self.slug = self.root.name
        self.spec = Spec(self.root)
        self.doc = self.spec.doc
        self.private = self.root.parent
        self.prefixes = prefix_index(self.private)
        self.meta = manifest().get(self.slug, {})
        self.titles = {r["title"].lower(): s for s, r in manifest().items()}

    def load(self, name, default=None):
        p = self.root / name
        return json.loads(p.read_text()) if p.exists() else default

    # ---- pages -------------------------------------------------------------------------
    def build_pages(self):
        raw = self.load("pages.json", [])
        counts = Counter(p["code"] for p in raw)
        seen = Counter()
        sections = self.load("sections.json")
        pages = []
        for p in raw:
            idx = int(p["index"])
            code = p["code"]
            seen[code] += 1
            n = counts[code]
            pid = code if n == 1 else f"{code} {seen[code]} of {n}"
            page = self.doc[idx]
            top, bottom = page_bands(page)
            tables = p.get("tables", [])
            footnotes = p.get("footnotes", {})
            pages.append({
                "id": pid, "code": code, "part": seen[code] if n > 1 else None, "parts": n if n > 1 else None,
                "pdf_page": idx + 1, "kind": p["kind"], "title": page_title(page),
                "section": (sections or {}).get("pages", {}).get(code) if p["kind"] == "algorithm" else None,
                "size": [round(page.rect.width, 1), round(page.rect.height, 1)],
                "content_band": [round(top, 1), round(bottom, 1)],
                "text": p["text"], "tables": tables if isinstance(tables, list) else [],
                "footnotes": footnotes if isinstance(footnotes, dict) else {},
            })
        self.pages = pages
        self.by_code = defaultdict(list)
        for pg in pages:
            self.by_code[pg["code"]].append(pg)
        disc = [pg for pg in pages if pg["kind"] == "discussion" and pg["code"].startswith("MS-")]
        self.discussion = disc[0]["id"] if disc else None
        return pages

    # ---- links -------------------------------------------------------------------------
    def resolve(self, prefix, rest, part=None, of=None):
        code = f"{prefix}-{rest}"
        if code in self.by_code:
            cands = self.by_code[code]
            pg = cands[int(part) - 1] if part and int(part) <= len(cands) else cands[0]
            return {"code": code, "part": int(part) if part else None, "type": "page", "page": pg["id"],
                    "pdf_page": pg["pdf_page"]}
        if prefix in self.prefixes and self.prefixes[prefix] != self.slug:
            return {"code": code, "part": int(part) if part else None, "type": "external_guideline",
                    "guideline": self.prefixes[prefix], "page": None}
        return None

    def links(self, node):
        out, seen = [], set()
        texts = [f"({l})" for l in node.get("links", [])] + [node["text"]]
        for t in texts:
            for m in PAGE_REF_RE.finditer(t):
                link = self.resolve(*m.groups())
                if link and (link["code"], link["part"]) not in seen:
                    seen.add((link["code"], link["part"]))
                    out.append(link)
        low = node["text"].lower()
        if "see discussion" in low and self.discussion:
            out.append({"code": "MS-1", "part": None, "type": "discussion", "page": self.discussion})
        for m in re.finditer(r"NCCN Guidelines for ([A-Z][A-Za-z ,()/-]+?)(?:[.;)]|$| for | in )", node["text"]):
            slug = self.titles.get(m.group(1).strip().lower())
            if slug and slug != self.slug:
                out.append({"code": None, "part": None, "type": "external_guideline", "guideline": slug, "page": None})
        return out

    # ---- footnotes ---------------------------------------------------------------------
    def footnote(self, page_code, letter):
        """(source page code, text, how): the box's own page, the page its "Footnotes on X" line
        points to, its footnote page ("<code>A"), then the nearest page of the same prefix that
        defines the letter (how = "nearest_same_prefix": the least certain case)."""
        store = self.footnotes
        steps = [(page_code, "own_page"), (self.fn_pointer.get(page_code), "printed_pointer"),
                 (page_code + "A", "footnote_page")]
        for code, how in steps:
            if code and letter in store.get(code, {}):
                return code, store[code][letter], how
        prefix = page_code.split("-")[0] + "-"
        order = [c for c in store if c.startswith(prefix)]
        here = order.index(page_code) if page_code in order else len(order)
        for code in order[here:] + list(reversed(order[:here])):
            if letter in store[code]:
                return code, store[code][letter], "nearest_same_prefix"
        return None, None, None

    # ---- roles -------------------------------------------------------------------------
    @staticmethod
    def roles(g):
        boxes = [n for n in g["nodes"] if n["kind"] == "box"]
        parents, kids = defaultdict(set), defaultdict(set)
        for e in g["edges"]:
            kids[e["src"]].add(e["dst"])
            parents[e["dst"]].add(e["src"])
        loose = [n for n in boxes if not kids[n["id"]] and not parents[n["id"]] and not n["id"].startswith("t")]
        out = {}
        for n in g["nodes"]:
            nid = n["id"]
            if n["kind"] == "header":
                out[nid] = "page_heading"
            elif n.get("role", "").startswith("table_"):
                out[nid] = n["role"]
            elif n in loose:
                words = len(n["text"].split())
                same_row = [m for m in loose if m is not n and abs(m["bbox"][1] - n["bbox"][1]) < 6
                            and len(m["text"].split()) <= 5]
                if words <= 5 and same_row and not PAGE_REF_RE.search(n["text"]):
                    out[nid] = "column_header"
                elif PAGE_REF_RE.fullmatch(n["text"].strip(" ()")):
                    out[nid] = "link"
                else:
                    out[nid] = "note"
            elif not parents[nid]:
                out[nid] = "entry"
            elif len(kids[nid]) > 1:
                out[nid] = "decision"
            elif kids[nid]:
                out[nid] = "step"
            else:
                out[nid] = "leaf"
        return out

    # ---- PDF check ---------------------------------------------------------------------
    def bbox_ok(self, page_index, node):
        import pymupdf

        x0, y0, x1, y1 = node["bbox"]
        if x1 <= x0 or y1 <= y0:
            return None
        clip = pymupdf.Rect(x0 - 2, y0 - 2, x1 + 2, y1 + 2)
        spans = [s for b in self.doc[page_index].get_text("dict", clip=clip)["blocks"] for l in b.get("lines", [])
                 for s in l["spans"]]
        if not spans:
            return False
        size = sorted(s["size"] for s in spans)[len(spans) // 2]
        # Footnote letters are superscripts (flag bit 0) or smaller type; they are not box text.
        text = " ".join(s["text"] if not (s["flags"] & 1 or s["size"] < 0.8 * size) else " " for s in spans)
        return _cover(node["text"], text) >= 0.9

    # ---- whole bundle ------------------------------------------------------------------
    def build(self):
        from .navigator import Guideline
        from .sections import entry_predicates, load as load_sections

        pages = self.build_pages()
        self.footnotes = self.load("footnotes.json", {})
        self.fn_pointer = {}
        for pg in pages:
            m = re.search(r"Footnotes (?:on|for) ([A-Z][A-Z0-9_/]{1,11}-[A-Z0-9]+)", pg["text"])
            if m:
                self.fn_pointer[pg["code"]] = m.group(1)
        merged = self.load("merged_graphs.json", {})
        schema = self.load("fact_schema.json", {"variables": {}, "derived": {}})
        raw_preds = self.load("predicates.json", {})
        status = self.load("predicates_status.json", {"reviewed_correct": [], "rejected": []})
        correct, rejected = set(status["reviewed_correct"]), set(status["rejected"])
        types = self.load("node_types.json", {})
        received = self.load("received_predicates.json", {})
        from .llm_tasks import review_notes

        notes = review_notes(self.root)
        gl = Guideline(self.root)  # roots, cross-page continuations, section-aware predicates
        sections = load_sections(self.root)
        effective = gl.predicates
        page_of = {pg["code"]: pg for pg in pages if pg["kind"] == "algorithm"}

        nodes, edges = [], []
        for code, g in merged.items():
            pg = page_of.get(code) or (self.by_code.get(code) or [None])[0]
            if pg is None:
                continue
            pidx = pg["pdf_page"] - 1
            pg["size"] = g.get("page_size") or pg["size"]
            if g.get("content_band"):
                pg["content_band"] = g["content_band"]
            pg["heading"] = next((n["text"] for n in g["nodes"] if n["kind"] == "header"), "")
            roles = self.roles(g)
            for n in g["nodes"]:
                nid = f"{code}:{n['id']}"
                fns = []
                for letter in n.get("footnote_refs", []):
                    src, text, how = self.footnote(code, letter)
                    fns.append({"mark": letter, "page": src, "text": text, "resolved_by": how})
                rec = {
                    "id": nid, "page": pg["id"], "pdf_page": pg["pdf_page"], "text": n["text"],
                    "lines": n.get("line_texts", [n["text"]]), "bbox": [round(v, 1) for v in n["bbox"]],
                    "line_bboxes": [[round(v, 1) for v in b] for b in n.get("line_bboxes", [n["bbox"]])],
                    "role": roles[n["id"]], "column": n.get("column"), "notes": n.get("notes"),
                    "footnotes": fns, "links": self.links(n),
                }
                if n["kind"] == "box":
                    rec["bbox_matches_pdf"] = self.bbox_ok(pidx, n) if not n["id"].startswith("t") else None
                    p_raw = raw_preds.get(nid)
                    p_eff = effective.get(nid)
                    if nid in raw_preds or p_eff is not None:
                        if p_raw is not None:
                            st = "model_reviewed" if nid in correct else "model_draft"
                        elif nid in rejected:
                            st = "rejected"
                        else:
                            st = "none"
                        if p_raw is None and p_eff is not None:
                            st = "section_only"
                        rec.update({"decision_type": types.get(nid, "condition" if p_raw is not None else None),
                                    "predicate": p_eff, "predicate_status": st,
                                    "section_clause": p_eff is not None and p_eff != p_raw})
                        if st == "rejected" and nid in notes:
                            rec["review_note"] = notes[nid]["note"]
                    if received.get(nid) is not None:
                        rec["received_predicate"] = received[nid]
                        rec["received_status"] = "model_reviewed" if f"{nid}#received" in correct else "model_draft"
                rec = {k: v for k, v in rec.items() if v is not None}
                nodes.append(rec)
            for e in g["edges"]:
                edges.append({"src": f"{code}:{e['src']}", "dst": f"{code}:{e['dst']}",
                              "evidence": EVIDENCE.get(e.get("support"), e.get("support")),
                              "support": e.get("support")})

        node_ids = {n["id"] for n in nodes}
        by_id = {n["id"]: n for n in nodes}
        for r, srcs in gl.inherited.items():  # entry conditions include the linking boxes' (navigator)
            rec = by_id.get(r)
            if rec is None:
                continue
            rec["reached_from"] = srcs
            rec["link_condition"] = gl.link_conditions.get(r)
            if rec.get("predicate") is None and rec["link_condition"] is not None:
                rec["predicate"] = rec["link_condition"]
                rec["predicate_status"] = "inherited_from_link"
                rec.setdefault("decision_type", "condition")
        continuations = []
        for nid, kids in gl.children.items():
            for k in kids:
                if gl.nodes[k]["page"] != gl.nodes[nid]["page"] and nid in node_ids:
                    continuations.append({"src": nid, "dst": k, "page": gl.nodes[k]["page"]})
        entries = sorted(r for rs in gl.roots.values() for r in rs)

        pdf_bytes = self.spec.pdf.read_bytes()
        cover = self.doc[0].get_text()
        vm = VERSION_RE.search(cover)
        boxes = [n for n in nodes if "bbox_matches_pdf" in n]
        checked = [n for n in boxes if n["bbox_matches_pdf"] is not None]
        decision = [n for n in nodes if "predicate_status" in n]
        quality = {
            "pages": len(pages), "algorithm_pages": len(merged), "boxes": len(boxes),
            "boxes_text_found_in_pdf_at_bbox": f"{sum(n['bbox_matches_pdf'] for n in checked)}/{len(checked)}",
            "edges_by_evidence": dict(Counter(e["evidence"] for e in edges)),
            "decision_boxes": len(decision),
            "predicate_status": dict(Counter(n["predicate_status"] for n in decision)),
            "decision_types": dict(Counter(n.get("decision_type") for n in decision)),
            "entries": len(entries),
            "entries_with_predicate": sum(by_id.get(r, {}).get("predicate") is not None for r in entries),
            "entries_reached_by_link": sum(bool(by_id.get(r, {}).get("reached_from")) for r in entries),
            "roles": dict(Counter(n["role"] for n in nodes)),
            "links": dict(Counter(l["type"] for n in nodes for l in n["links"])),
            "footnote_refs_by_resolution": dict(Counter(f["resolved_by"] for n in nodes for f in n["footnotes"])),
            "clinician_validated": False,
        }
        return {
            "format": "nccn-guideline/1",
            "built": datetime.date.today().isoformat(),
            "guideline": {"slug": self.slug, "title": self.meta.get("title"), "category": self.meta.get("category"),
                          "version": vm.group(1) if vm else None, "version_date": vm.group(2) if vm else None,
                          "pdf_sha256": hashlib.sha256(pdf_bytes).hexdigest(), "pdf_pages": len(self.doc)},
            "sections": sections,
            "pages": pages, "nodes": nodes, "edges": edges, "continuations": continuations,
            "entries": entries, "schema": schema, "quality": quality,
            "notes": {
                "predicates": "Conditions were drafted and reviewed by a language model (model_reviewed), "
                              "not by clinicians. 'rejected' means the review rejected the draft; the box "
                              "then needs clinician judgement. 'section_only' means the box only requires "
                              "the patient to be in the page's guideline section.",
                "coordinates": "bbox and line_bboxes are PDF points with the origin at the page's top left; "
                               "pages[].size gives the page size.",
                "links": "page links name a page id from pages[]; a multi-page code such as PROS-F has "
                         "ids 'PROS-F 1 of 5' ... ; external_guideline links name another guideline's slug.",
            },
        }


ARCHIVE = ["predicates_draft.json", "predicates_all_draft.json", "nodes_for_predicates.tsv",
           "nodes_for_predicates_all.json"]


def archive(root):
    root = Path(root)
    (root / "archive").mkdir(exist_ok=True)
    moved = []
    for name in ARCHIVE:
        if (root / name).exists():
            (root / name).rename(root / "archive" / name)
            moved.append(name)
    print(f"{root.name}: archived {moved}")


def write(root):
    b = Bundler(root).build()
    path = Path(root) / "guideline.json"
    path.write_text(json.dumps(b, ensure_ascii=False, separators=(",", ":")))
    print(f"{Path(root).name}: {json.dumps(b['quality'])}")
    return b


if __name__ == "__main__":
    if sys.argv[1] == "archive":
        for r in sys.argv[2:]:
            archive(r)
    else:
        for r in sys.argv[1:]:
            write(r)
