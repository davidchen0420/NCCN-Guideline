"""Re-extract pages that carry algorithm content but were typed as footnote pages.

A page spec (data/<slug>/page_specs/<PAGE>.json) is what a reviewer writes after reading the PDF
page: where each box is, which arrows join them, which boxes are conditions and what they mean
over the guideline's own schema. This module measures the boxes from the PDF (text, line boxes,
footnote letters), checks the conditions against the schema, and rewrites guideline.json:

  python -m nccn_nav.page_spec lines "Guideline/Treatment/Rectal Cancer.pdf" 14   # text lines with boxes, to pick regions
  python -m nccn_nav.page_spec apply data/rectal [spec.json ...]                  # default: every spec of the guideline
  python -m nccn_nav.page_spec show data/rectal REC-3A                            # boxes, arrows, wiring of a page
  python -m nccn_nav.page_spec wire data/rectal --all                              # leaf boxes naming a page without a continuation
  python -m nccn_nav.page_spec quality data/rectal                                # recompute the quality block only

Spec format (JSON):
  page        page id in guideline.json ("REC-3A")
  relabel     [{page, code}, ...] pages whose printed code was misread (given before the page is rewritten)
  note        why the page is an algorithm page (kept as pages[].reextracted)
  footnotes   {letter: text} replacing the page's footnote texts (footnote pages often hold algorithm
              text inside a footnote entry; list every letter the boxes cite)
  section     guideline section of the page (multi-disease guidelines), default null
  boxes       [{key, region: [x0, y0, x1, y1] (PDF points, origin top left; lines whose centre lies inside),
                header: true for column headings, role, decision_type (condition|option|other), predicate,
                predicate_status (model_reviewed only after the reviewer checked it against the box; default none),
                received_predicate, links (override of the page references found in the text), extra_links
                (added to them, e.g. an external guideline), entry: true,
                text / marks (override of the measured text / footnote letters)}]
  edges       [[key, key], ...]   arrows (all read from the page image)
  entries     [node id, ...] instead of boxes: the page has its boxes but no entry box; name where patients enter
  extra_edges [[node id, node id, reason], ...]   arrows on other pages that the earlier extraction missed
              and that lead into this page (full node ids)

Boxes without edges stay loose (links and notes). Entry boxes are the boxes without a parent that
have an arrow (or entry: true). Page references in leaf boxes become continuations into the entry
boxes of the referenced algorithm page, and every leaf box elsewhere that references the new page
continues into its entry boxes (the rule the navigator and bundle.py use). Re-applying a spec
replaces the page's earlier boxes.
"""
import argparse
import datetime
import json
import re
import sys
from collections import Counter
from pathlib import Path

from .bundle import PAGE_REF_RE, _cover, _tokens
from .predicates import facts_used  # noqa: F401  (used by tests)

OPS = {"==", "!=", ">", ">=", "<", "<=", "in", "not_in"}
MARK_RE = re.compile(r"^[a-z]{1,3}$")


# ---------------------------------------------------------------------------------------------
# PDF lines
def page_lines(page):
    """Text lines of a PDF page: {bbox, text, marks, y}. Footnote letters (superscripts) are
    separated from the text, as the extraction of the algorithm pages does."""
    out = []
    for b in page.get_text("dict")["blocks"]:
        for ln in b.get("lines", []):
            spans = ln["spans"]
            if not spans:
                continue
            size = sorted(s["size"] for s in spans)[len(spans) // 2]
            text, marks = "", []
            for s in spans:
                if s["flags"] & 1 or s["size"] < 0.8 * size:
                    marks += [m for m in re.split(r"[,\s]+", s["text"]) if m]
                else:
                    text += s["text"]
            text = re.sub(r"[ \t]+", " ", text).strip()
            if text or marks:
                out.append({"bbox": [round(v, 1) for v in ln["bbox"]], "text": text, "marks": marks})
    return out


def _centre(b):
    return (b[0] + b[2]) / 2, (b[1] + b[3]) / 2


def lines_in(lines, region):
    x0, y0, x1, y1 = region
    hit = []
    for ln in lines:
        cx, cy = _centre(ln["bbox"])
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            hit.append(ln)
    # reading order: top to bottom, then left to right (a footnote letter shares its line)
    return sorted(hit, key=lambda l: (round(l["bbox"][1] / 4), l["bbox"][0]))


def measure(lines, region):
    hit = lines_in(lines, region)
    if not hit:
        raise ValueError(f"no text lines in region {region}")
    texts = [l["text"] for l in hit if l["text"]]
    marks = []
    for l in hit:
        for m in l["marks"]:
            if MARK_RE.match(m) and m not in marks:
                marks.append(m)
    bbox = [min(l["bbox"][0] for l in hit), min(l["bbox"][1] for l in hit),
            max(l["bbox"][2] for l in hit), max(l["bbox"][3] for l in hit)]
    return {"text": " ".join(texts), "lines": texts, "bbox": bbox,
            "line_bboxes": [l["bbox"] for l in hit if l["text"]], "marks": marks}


# ---------------------------------------------------------------------------------------------
# schema checks
def _schema_values(schema):
    """{name: set of allowed enum values or None} over variables and derived variables."""
    out = {}
    for name, v in schema["variables"].items():
        out[name] = set(v["values"]) if v.get("type") == "enum" and v.get("values") else None
    for name, d in schema.get("derived", {}).items():
        vals = {r["then"] for r in d.get("rules", []) if isinstance(r.get("then"), str)}
        if isinstance(d.get("else"), str):
            vals.add(d["else"])
        out[name] = vals if d.get("type") == "enum" else None
    return out


def check_predicate(pred, schema_values, where):
    if pred is None:
        return
    for key in ("all", "any"):
        if key in pred:
            for p in pred[key]:
                check_predicate(p, schema_values, where)
            return
    if "not" in pred:
        return check_predicate(pred["not"], schema_values, where)
    name, op, value = pred.get("fact"), pred.get("op"), pred.get("value")
    if name not in schema_values:
        raise ValueError(f"{where}: unknown variable {name!r}")
    if op not in OPS:
        raise ValueError(f"{where}: bad operator {op!r}")
    allowed = schema_values[name]
    if allowed is not None:
        for v in (value if op in ("in", "not_in") else [value]):
            if v not in allowed:
                raise ValueError(f"{where}: {name} has no value {v!r} (allowed {sorted(allowed)})")


# ---------------------------------------------------------------------------------------------
class Pack:
    """One guideline.json being edited."""

    def __init__(self, data_dir, pdf=None):
        import pymupdf
        from .dashboard import find_pdfs
        self.dir = Path(data_dir)
        self.path = self.dir / "guideline.json"
        self.g = json.loads(self.path.read_text())
        self.slug = self.g["guideline"]["slug"]
        if pdf is None:
            pdf = find_pdfs(str(self.dir.parent)).get(self.slug)
        if pdf is None:
            raise SystemExit(f"{self.slug}: source PDF not found (see dashboard.find_pdfs)")
        self.doc = pymupdf.open(pdf)
        self.pages = {p["id"]: p for p in self.g["pages"]}
        self.touched = set()      # page ids rewritten by this run
        self.linked_entries = set()

    # ---- links --------------------------------------------------------------------------------
    def resolve(self, prefix, rest, part=None):
        code = f"{prefix}-{rest}"
        cands = [p for p in self.g["pages"] if p["code"] == code]
        if not cands:
            return None
        pg = cands[int(part) - 1] if part and int(part) <= len(cands) else cands[0]
        return {"code": code, "part": int(part) if part else None, "type": "page", "page": pg["id"], "pdf_page": pg["pdf_page"]}

    def links_of(self, text, override=None):
        if override is not None:
            return override
        out, seen = [], set()
        for m in PAGE_REF_RE.finditer(text):
            link = self.resolve(m.group(1), m.group(2), m.group(3))
            if link and (link["code"], link["part"]) not in seen:
                seen.add((link["code"], link["part"]))
                out.append(link)
        return out

    def footnote(self, pid, own, mark):
        """{mark, page, text, resolved_by} like bundle.py: the page's own letter, else the nearest
        page of the same prefix that defines it (the least certain case), else no text."""
        if mark in own:
            return {"mark": mark, "page": pid, "text": own[mark], "resolved_by": "own_page"}
        code = self.pages[pid]["code"]
        same = [p for p in self.g["pages"] if p["code"].startswith(code.split("-")[0] + "-") and p["id"] != pid
                and p["kind"] in ("algorithm", "footnotes") and mark in (p.get("footnotes") or {})]
        if same:
            order = [p["id"] for p in self.g["pages"]]
            here = order.index(pid)
            best = min(same, key=lambda p: abs(order.index(p["id"]) - here))
            return {"mark": mark, "page": best["id"], "text": best["footnotes"][mark], "resolved_by": "nearest_same_prefix"}
        return {"mark": mark, "page": None, "text": None, "resolved_by": None}

    def bbox_ok(self, pdf_page, node):
        """bundle.py's check that the box's text is printed at its position (page 1-based)."""
        lines = page_lines(self.doc[pdf_page - 1])
        x0, y0, x1, y1 = node["bbox"]
        inside = " ".join(l["text"] for l in lines_in(lines, [x0 - 2, y0 - 2, x1 + 2, y1 + 2]))
        if not _tokens(node["text"]):
            return re.sub(r"\s+", "", node["text"]) in re.sub(r"\s+", "", inside)
        return _cover(node["text"], inside) >= 0.9

    def relabel(self, old_id, code, nodes_from=None):
        """Give a page its printed code. The page-label detector reads a reference printed inside
        the flowchart (a box "WILMS-11") instead of the label in the corner ("WILMS-5"), so two
        pages shared one code and the first lost its boxes. The page becomes <code> (a single page
        of that code), its boxes <code>:<local>, and every link, edge, continuation and entry that
        named it follows; page links in the guideline that mention the code are re-resolved."""
        g = self.g
        if old_id not in self.pages and code in self.pages:
            return  # done by an earlier run
        page = self.pages[old_id]
        if old_id == code:
            return
        if code in self.pages:
            raise ValueError(f"relabel: page {code} already exists")
        page.update({"id": code, "code": code, "part": None, "parts": None})
        self.pages = {p["id"]: p for p in g["pages"]}
        remap = {}
        for n in g["nodes"]:
            if n["page"] != old_id and n["page"] != nodes_from:
                continue
            moved = n["page"] == nodes_from
            n["page"] = code
            new = code + ":" + n["id"].split(":", 1)[1]
            if new != n["id"]:
                remap[n["id"]] = new
                n["id"] = new
            if moved:  # boxes extracted from this page but filed under the page that shared its code
                n["pdf_page"] = page["pdf_page"]
                if "bbox_matches_pdf" in n and n["bbox_matches_pdf"] is not None:
                    n["bbox_matches_pdf"] = self.bbox_ok(page["pdf_page"], n)
        f = lambda x: remap.get(x, x)
        for e in g["edges"]:
            e["src"], e["dst"] = f(e["src"]), f(e["dst"])
        for c in g["continuations"]:
            c["src"], c["dst"] = f(c["src"]), f(c["dst"])
            if c["page"] in (old_id, nodes_from):
                c["page"] = code
        g["entries"] = sorted({f(e) for e in g["entries"]})
        sec = g.get("sections")
        if sec and old_id in sec["pages"]:
            sec["pages"][code] = sec["pages"].pop(old_id)
        for n in g["nodes"]:
            for l in n["links"]:
                if l.get("page") == old_id:
                    l["page"] = code
        self.touched.add(code)
        self.relinked = getattr(self, "relinked", set()) | {code}

    def relink(self):
        """Re-resolve the page links of every box whose text names a relabelled code."""
        g = self.g
        codes = getattr(self, "relinked", set())
        if not codes:
            return
        pat = re.compile(r"\b(?:%s)\b" % "|".join(re.escape(c) for c in sorted(codes)))
        for n in g["nodes"]:
            if not pat.search(n["text"]):
                continue
            keep = [l for l in n["links"] if l.get("type") != "page"]
            n["links"] = self.links_of(n["text"]) + keep
            # stale continuations of this box (it may have pointed at the wrong page) are rebuilt by wire()
            g["continuations"] = [c for c in g["continuations"] if c["src"] != n["id"]]
            self.touched.add(n["page"])

    # ---- apply a spec ---------------------------------------------------------------------------
    def drop_page(self, pid):
        g = self.g
        prefix = pid + ":"
        g["nodes"] = [n for n in g["nodes"] if n["page"] != pid]
        g["edges"] = [e for e in g["edges"] if not e["src"].startswith(prefix)]
        g["continuations"] = [c for c in g["continuations"] if not c["src"].startswith(prefix) and not c["dst"].startswith(prefix)]
        g["entries"] = [e for e in g["entries"] if not e.startswith(prefix)]

    def apply(self, spec):
        g = self.g
        pid = spec["page"]
        page = self.pages[pid]
        if "entries" in spec and "boxes" not in spec:
            # an algorithm page that has its boxes but no entry box: name the box(es) patients enter at
            ids = {n["id"]: n for n in g["nodes"] if n["page"] == pid}
            for e in spec["entries"]:
                if e not in ids:
                    raise ValueError(f"{pid}: entry {e} is not a box of the page")
                ids[e]["role"] = "entry" if ids[e]["role"] in ("leaf", "step", "decision", "note", "link") else ids[e]["role"]
            g["entries"] = sorted(set(g["entries"]) | set(spec["entries"]))
            page["entry_fixed"] = spec.get("note", "entry box named from the PDF page")
            self.touched.add(pid)
            return
        if "boxes" not in spec:  # a relabel only: the page keeps the boxes it was given
            page.setdefault("kind_before", page["kind"])
            page["reextracted"] = spec.get("note", "page relabelled")
            self.touched.add(pid)
            return
        pdf_page = self.doc[page["pdf_page"] - 1]
        lines = page_lines(pdf_page)
        sv = _schema_values(g["schema"])
        self.drop_page(pid)

        footnotes = dict(spec["footnotes"]) if spec.get("footnotes") is not None else dict(page.get("footnotes") or {})
        nodes, by_key = [], {}
        for b in spec["boxes"]:
            m = measure(lines, b["region"])
            text = b.get("text", m["text"])
            marks = b.get("marks", m["marks"])
            nid = f"{page['code']}:n{round(m['bbox'][1])}_{round(m['bbox'][0])}"
            if nid in {n["id"] for n in nodes}:
                raise ValueError(f"{pid}: duplicate node id {nid} (box {b['key']})")
            node = {
                "id": nid, "page": pid, "pdf_page": page["pdf_page"], "text": text, "lines": m["lines"],
                "bbox": m["bbox"], "line_bboxes": m["line_bboxes"],
                "footnotes": [self.footnote(pid, footnotes, k) for k in marks],
                "links": [] if b.get("header") else self.links_of(text, b.get("links")) + b.get("extra_links", []),
            }
            if not b.get("header"):
                inside = " ".join(l["text"] for l in lines_in(lines, [m["bbox"][0] - 2, m["bbox"][1] - 2, m["bbox"][2] + 2, m["bbox"][3] + 2]))
                # scoring.norm drops page references, so a box that is only a reference is checked verbatim
                node["bbox_matches_pdf"] = (_cover(text, inside) >= 0.9 if _tokens(text)
                                            else re.sub(r"\s+", "", text) in re.sub(r"\s+", "", inside))
            by_key[b["key"]] = (b, node)
            nodes.append(node)

        kids, parents = {}, {}
        edges = []
        for a, c in spec["edges"]:
            if a not in by_key or c not in by_key:
                raise ValueError(f"{pid}: edge {a}->{c} names an unknown box")
            ia, ic = by_key[a][1]["id"], by_key[c][1]["id"]
            kids.setdefault(ia, []).append(ic)
            parents.setdefault(ic, []).append(ia)
            edges.append({"src": ia, "dst": ic, "evidence": "image_checked", "support": "verified"})

        for b, node in by_key.values():
            nid = node["id"]
            if b.get("header"):
                role = "page_heading"
            elif b.get("role"):
                role = b["role"]
            elif nid not in kids and nid not in parents:
                role = "link" if PAGE_REF_RE.fullmatch(node["text"].strip(" ()")) else "note"
            elif nid not in parents:
                role = "entry"
            elif len(kids.get(nid, [])) > 1:
                role = "decision"
            elif nid in kids:
                role = "step"
            else:
                role = "leaf"
            node["role"] = role
            if b.get("header"):
                continue
            dt = b.get("decision_type")
            pred = b.get("predicate")
            check_predicate(pred, sv, f"{pid} {b['key']}")
            check_predicate(b.get("received_predicate"), sv, f"{pid} {b['key']} received")
            status = b.get("predicate_status", "model_reviewed" if pred is not None else "none")
            if pred is None and status != "none":
                raise ValueError(f"{pid} {b['key']}: status {status} without a predicate")
            if dt:
                node["decision_type"] = dt
                if pred is not None:
                    node["predicate"] = pred
                node["predicate_status"] = status
                node["section_clause"] = False
            elif pred is not None:
                raise ValueError(f"{pid} {b['key']}: a predicate needs a decision_type")
            if b.get("received_predicate") is not None:
                node["received_predicate"] = b["received_predicate"]
                node["received_status"] = "model_reviewed"

        # page record
        page.setdefault("kind_before", page["kind"])
        page["kind"] = "algorithm"
        page["footnotes"] = footnotes
        heads = sorted((n for b, n in by_key.values() if b.get("header")), key=lambda n: (n["bbox"][1], n["bbox"][0]))
        page["heading"] = heads[0]["text"] if heads else (nodes[0]["text"] if nodes else "")
        page["section"] = spec.get("section")
        page["reextracted"] = spec.get("note", "algorithm content typed as a footnote page; boxes, arrows and conditions written from the PDF page")
        sec = g.get("sections")
        if sec is not None:
            sec["pages"].setdefault(pid, spec.get("section"))

        g["nodes"] += nodes
        g["edges"] += edges
        for src, dst, why in spec.get("extra_edges", []):
            ids = {n["id"]: n for n in g["nodes"]}
            if src not in ids or dst not in ids:
                raise ValueError(f"{pid}: extra edge {src}->{dst} names an unknown node")
            if not any(e["src"] == src and e["dst"] == dst for e in g["edges"]):
                g["edges"].append({"src": src, "dst": dst, "evidence": "image_checked", "support": "verified", "note": why})
                if ids[src]["role"] == "leaf":
                    ids[src]["role"] = "step"
        roots = [n["id"] for b, n in by_key.values() if not b.get("header") and (
            (n["id"] not in parents and n["id"] in kids) or b.get("entry"))]
        for b, n in by_key.values():
            if b.get("entry"):
                n["role"] = "entry"
        g["entries"] = sorted(set(g["entries"]) | set(roots))
        self.touched.add(pid)
        # multi-disease guidelines: the page's section is ANDed into each entry box's condition
        # (sections.entry_predicates); an entry without a condition gets the section clause alone only
        # when it is the page's single entry and no other page links to the page
        section = spec.get("section")
        if section and sec is not None:
            clause = {"fact": sec["variable"], "op": "==", "value": section}
            linked = any(l.get("page") == pid and n["page"] != pid for n in g["nodes"] for l in n["links"])
            for b, n in by_key.values():
                if n["id"] not in roots:
                    continue
                if n.get("predicate") is not None:
                    n["predicate"] = {"all": [clause, n["predicate"]]}
                    n["section_clause"] = True
                elif len(roots) == 1 and not linked and n.get("decision_type") != "other":
                    n["predicate"], n["predicate_status"], n["section_clause"] = clause, "section_only", True
                    n.setdefault("decision_type", "other")

    # ---- continuations ----------------------------------------------------------------------------
    def children(self):
        kids = {}
        for e in self.g["edges"]:
            kids.setdefault(e["src"], []).append(e["dst"])
        return kids

    def wire(self):
        """Leaf boxes that reference an algorithm page continue into its entry boxes. Done for
        the boxes of the touched pages (outgoing) and for every leaf that references a touched
        page (incoming); other continuations are left as they were."""
        g = self.g
        kids = self.children()
        algo = {p["id"] for p in g["pages"] if p["kind"] == "algorithm"}
        entries_of = {}
        for e in g["entries"]:
            entries_of.setdefault(e.split(":")[0], []).append(e)
        have = {(c["src"], c["dst"]) for c in g["continuations"]}
        added = []
        for n in g["nodes"]:
            if n["id"] in kids or n["page"] not in algo or n["role"] in ("note", "page_heading", "column_header"):
                continue
            for l in n["links"]:
                tgt = l.get("page")
                if l.get("type") != "page" or tgt not in algo or tgt == n["page"]:
                    continue
                if n["page"] not in self.touched and tgt not in self.touched:
                    continue
                for e in entries_of.get(tgt, []):
                    if (n["id"], e) not in have:
                        have.add((n["id"], e))
                        added.append({"src": n["id"], "dst": e, "page": tgt})
                        self.linked_entries.add(e)
        g["continuations"] += added
        return added

    def link_conditions(self):
        """reached_from / link_condition of the entry boxes that gained a continuation (bundle.py,
        navigator._inherit_link_conditions): the condition of the nearest box with a predicate
        on the path to each linking box, several links being alternatives."""
        g = self.g
        by_id = {n["id"]: n for n in g["nodes"]}
        parents = {}
        for e in g["edges"]:
            parents.setdefault(e["dst"], []).append(e["src"])
        cross = {}
        for c in g["continuations"]:
            cross.setdefault(c["dst"], []).append(c["src"])

        def nearest(nid, seen):
            if nid in seen:
                return None
            seen.add(nid)
            if by_id[nid].get("predicate") is not None:
                return by_id[nid]["predicate"]
            ups = [nearest(p, seen) for p in parents.get(nid, []) if by_id[p]["page"] == by_id[nid]["page"]]
            ups = [u for u in ups if u is not None]
            return ups[0] if len(ups) == 1 else ({"any": ups} if ups else None)

        for r in sorted(self.linked_entries | {e for e in g["entries"] if e.split(":")[0] in self.touched}):
            srcs = cross.get(r, [])
            rec = by_id.get(r)
            if rec is None or not srcs:
                continue
            conds = [c for c in (nearest(s, set()) for s in srcs) if c is not None]
            rec["reached_from"] = sorted(set(srcs))
            if conds:
                rec["link_condition"] = conds[0] if len(conds) == 1 else {"any": conds}
                # a recommendation page (decision_type "other") is not a condition on the patient: it keeps
                # reached_from / link_condition for display but takes no inherited predicate
                if (rec.get("predicate") is None and rec.get("predicate_status") != "rejected"
                        and rec.get("decision_type") != "other"):
                    rec["predicate"] = rec["link_condition"]
                    rec["predicate_status"] = "inherited_from_link"
                    rec.setdefault("decision_type", "condition")

    # ---- quality ----------------------------------------------------------------------------------
    def quality(self):
        g = self.g
        nodes = g["nodes"]
        by_id = {n["id"]: n for n in nodes}
        boxes = [n for n in nodes if "bbox_matches_pdf" in n]
        checked = [n for n in boxes if n["bbox_matches_pdf"] is not None]
        decision = [n for n in nodes if "predicate_status" in n]
        entries = g["entries"]
        q = dict(g["quality"])
        q.update({
            "pages": len(g["pages"]),
            "algorithm_pages": sum(p["kind"] == "algorithm" for p in g["pages"]),
            "boxes": len(boxes),
            "boxes_text_found_in_pdf_at_bbox": f"{sum(n['bbox_matches_pdf'] for n in checked)}/{len(checked)}",
            "edges_by_evidence": dict(Counter(e["evidence"] for e in g["edges"])),
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
        })
        reex = sorted(p["id"] for p in g["pages"] if p.get("reextracted"))
        if reex:
            q["reextracted_pages"] = reex
        return q

    def save(self):
        g = self.g
        g["quality"] = self.quality()
        if g["quality"].get("reextracted_pages"):
            g.setdefault("notes", {})["reextracted_pages"] = (
                "Pages listed in quality.reextracted_pages were typed as footnote pages (or had no boxes) although they hold "
                "flowcharts. Their boxes, arrows and conditions were written from the PDF page by a language-model reviewer "
                "(data/<slug>/page_specs/<page>.json, nccn_nav.page_spec) and are not clinician-validated; arrows are "
                "image_checked, conditions model_reviewed or none. pages[].kind_before keeps the earlier kind.")
        g["built"] = datetime.date.today().isoformat()
        self.path.write_text(json.dumps(g, ensure_ascii=False, separators=(",", ":")))
        index = self.dir.parent / "index.json"
        if index.exists():
            idx = json.loads(index.read_text())
            for row in idx["guidelines"]:
                if row["slug"] == self.slug:
                    row["quality"] = g["quality"]
                    row["built"] = g["built"]
            index.write_text(json.dumps(idx, indent=1))


def load_specs(data_dir, names=None):
    d = Path(data_dir) / "page_specs"
    paths = [Path(n) for n in names] if names else sorted(d.glob("*.json"))
    return [json.loads(p.read_text()) for p in paths]


def show(data_dir, pid):
    """Print a page's boxes, arrows, continuations, entries and the boxes that link to it."""
    g = json.loads((Path(data_dir) / "guideline.json").read_text())
    for n in g["nodes"]:
        if n["page"] != pid:
            continue
        pr = json.dumps(n.get("predicate"), separators=(",", ":")) if n.get("predicate") else ""
        print(n["id"], n["role"], n.get("decision_type", ""), n.get("predicate_status", ""), [round(v) for v in n["bbox"]],
              repr(n["text"][:100]), pr[:160], [l.get("page") or l.get("code") for l in n["links"]],
              "bbox_mismatch" if n.get("bbox_matches_pdf") is False else "")
    for e in g["edges"]:
        if e["src"].startswith(pid + ":"):
            print("  edge", e["src"].split(":", 1)[1], "->", e["dst"].split(":", 1)[1], e["evidence"])
    for c in g["continuations"]:
        if c["src"].startswith(pid + ":"):
            print("  continues", c["src"], "->", c["dst"])
        elif c["dst"].startswith(pid + ":"):
            print("  entered from", c["src"])
    print("  entries", [e for e in g["entries"] if e.startswith(pid + ":")])
    print("  linked from", [(n["id"], n["text"][:40]) for n in g["nodes"] if n["page"] != pid and any(l.get("page") == pid for l in n["links"])])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("lines")
    a.add_argument("pdf")
    a.add_argument("page", type=int)
    a.add_argument("--region", nargs=4, type=float)
    b = sub.add_parser("apply")
    b.add_argument("data")
    b.add_argument("specs", nargs="*")
    b.add_argument("--pdf")
    sh = sub.add_parser("show")
    sh.add_argument("data")
    sh.add_argument("page")
    w = sub.add_parser("wire")
    w.add_argument("data")
    w.add_argument("--all", action="store_true", help="wire every leaf box of the guideline, not only those of the pages in a spec")
    w.add_argument("--pdf")
    c = sub.add_parser("quality")
    c.add_argument("data")
    c.add_argument("--write", action="store_true")
    c.add_argument("--pdf")
    args = ap.parse_args(argv)
    if args.cmd == "lines":
        import pymupdf
        for ln in sorted(page_lines(pymupdf.open(args.pdf)[args.page - 1]), key=lambda l: (l["bbox"][1], l["bbox"][0])):
            if args.region and not lines_in([ln], args.region):
                continue
            x0, y0, x1, y1 = ln["bbox"]
            sup = f"^{{{','.join(ln['marks'])}}}" if ln["marks"] else ""
            print(f"y={y0:6.1f}-{y1:6.1f} x={x0:6.1f}-{x1:6.1f} | {ln['text']!r}{sup}")
        return
    if args.cmd == "show":
        show(args.data, args.page)
        return
    pack = Pack(args.data, args.pdf)
    if args.cmd == "apply":
        specs = load_specs(args.data, args.specs)
        for s in specs:
            for r in s.get("relabel", []):
                pack.relabel(r["page"], r["code"], r.get("nodes_from"))
        for s in specs:
            pack.apply(s)
        pack.relink()
        added = pack.wire()
        pack.link_conditions()
        pack.save()
        print(f"{pack.slug}: {len(specs)} pages rewritten, {len(added)} continuations added")
        print(json.dumps(pack.g["quality"]))
    elif args.cmd == "wire":
        pack.touched = {p["id"] for p in pack.g["pages"] if p["kind"] == "algorithm"} if args.all else set()
        added = pack.wire()
        pack.link_conditions()
        pack.save()
        print(f"{pack.slug}: {len(added)} continuations added")
    else:
        q = pack.quality()
        print(json.dumps(q, indent=1))
        if args.write:
            pack.save()


if __name__ == "__main__":
    main(sys.argv[1:])
