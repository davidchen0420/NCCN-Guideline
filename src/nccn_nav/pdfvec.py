"""Strategy E1: rebuild an NCCN algorithm page as a graph from the PDF's vector layer.

NCCN flow pages draw connectors as stroked line paths (width ~1.0) with small filled
triangles as arrowheads; thinner strokes (~0.75) are hyperlink underlines, and
unarrowed vertical strokes are brackets that group a multi-line box.
"""
import math
import re

import pymupdf

# Page references printed in boxes; `configure(spec)` narrows them to the guideline's prefixes.
LINK_RE = re.compile(r"\(([A-Z]{2,6}-[A-Z0-9]+(?: \d+ of \d+)?)\)")
# Header and footer bands on a 792x612 landscape page.
TOP, BOTTOM = 85, 555


def configure(spec):
    """Use the page-reference pattern of one guideline (guideline.Spec)."""
    global LINK_RE
    LINK_RE = spec.link_re


def _text_lines(page):
    lines = []
    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            spans = [s for s in line["spans"] if s["text"].strip()]
            body = max((s["size"] for s in spans), default=0)
            # Superscript footnote letters (smaller font, after the first span) become refs.
            refs = [
                r
                for s in spans[1:]
                if s["size"] <= body * 0.85
                for r in re.split(r"[,\s]+", s["text"].strip())
                if re.fullmatch(r"[a-z]{1,3}", r)
            ]
            text = "".join(
                s["text"] for s in line["spans"] if not (s in spans[1:] and s["size"] <= body * 0.85)
            ).strip()
            x0, y0, x1, y1 = line["bbox"]
            if text and TOP < y0 and y1 < BOTTOM:
                # A leading superscript (smaller font) marks the start of a footnote.
                marker = None
                if len(spans) > 1 and spans[0]["size"] <= spans[1]["size"] * 0.85:
                    marker = spans[0]["text"].strip()
                lines.append({"text": text, "bbox": [x0, y0, x1, y1], "marker": marker, "refs": refs})
    return sorted(lines, key=lambda l: (round(l["bbox"][0]), l["bbox"][1]))


def _bracket_of(line, brackets):
    """Key of the bracket grouping a line: the closest opening bar on its left, else the
    closest closing bar on its right."""
    x0, y0, x1, y1 = line["bbox"]
    mid = (y0 + y1) / 2
    hits = [
        (x0 - br["x"], i)
        for i, br in enumerate(brackets)
        if br["x"] - 2 <= x0 <= br["x"] + 30 and br["y0"] - 3 <= mid <= br["y1"] + 3 and not br.get("stem")
    ]
    if hits:
        return ("open", min(hits)[1])
    closing = [
        (br["x"] - x1, i)
        for i, br in enumerate(brackets)
        if br["x"] - 40 <= x1 <= br["x"] + 1 and br["y0"] - 3 <= mid <= br["y1"] + 3
    ]
    return ("close", min(closing)[1]) if closing else None


def _group_boxes(lines, brackets):
    """Lines behind the same opening bracket form one box; others merge when left-aligned
    and vertically adjacent."""
    groups = []  # each: {"bracket": idx|None, "lines": [...]}

    def bbox(group):
        bbs = [l["bbox"] for l in group["lines"]]
        return [min(b[0] for b in bbs), min(b[1] for b in bbs), max(b[2] for b in bbs), max(b[3] for b in bbs)]

    for line in sorted(lines, key=lambda l: (l["bbox"][1], l["bbox"][0])):
        x0, y0 = line["bbox"][:2]
        bracket = _bracket_of(line, brackets)
        target = None
        for group in groups:
            gx0, _, _, gy1 = bbox(group)
            if bracket is not None and group["bracket"] == bracket:
                target = group
            elif (
                bracket is None
                and group["bracket"] is None
                and abs(gx0 - x0) < 4
                and -6 < y0 - gy1 < 6
                # A box that ends in a page reference such as "(PROS-x)" is complete.
                and not re.search(LINK_RE.pattern + r"$", group["lines"][-1]["text"])
            ):
                target = group
            if target:
                break
        if target:
            target["lines"].append(line)
        else:
            groups.append({"bracket": bracket, "lines": [line]})

    # Absorb unbracketed groups (indented or short wrapped lines) that sit within a
    # bracket's vertical span and the bracketed group's column.
    for group in [g for g in groups if g["bracket"] is not None]:
        side, idx = group["bracket"]
        br = brackets[idx]
        for other in [g for g in groups if g["bracket"] is None]:
            ox0, oy0, ox1, oy1 = bbox(other)
            gx0 = bbox(group)[0]
            in_span = br["y0"] - 3 <= (oy0 + oy1) / 2 <= br["y1"] + 3
            in_column = gx0 - 2 <= ox0 <= gx0 + 15 and (side == "open" or ox1 <= br["x"] + 1)
            if in_span and in_column:
                group["lines"] += other["lines"]
                groups.remove(other)

    # A closing bar can be a tall collector beside several separate boxes: split its group
    # wherever the stacked lines leave a vertical gap.
    split = []
    for group in groups:
        if not group["bracket"] or group["bracket"][0] != "close":
            split.append(group)
            continue
        part, bottom = [], None
        for l in sorted(group["lines"], key=lambda l: l["bbox"][1]):
            if part and l["bbox"][1] - bottom > 12:
                split.append({**group, "lines": part})
                part = []
            part.append(l)
            bottom = l["bbox"][3] if len(part) == 1 else max(bottom, l["bbox"][3])
        split.append({**group, "lines": part})
    groups = split

    boxes = []
    for group in groups:
        text = " ".join(l["text"] for l in sorted(group["lines"], key=lambda l: (l["bbox"][1], l["bbox"][0])))
        # All-caps lines above the flow are column headers, not decision nodes.
        letters = re.sub(r"[^A-Za-z]", "", text)
        kind = "header" if len(letters) > 3 and letters[:-2].isupper() else "box"
        refs = sorted({r for l in group["lines"] for r in l["refs"]}, key=lambda r: (len(r), r))
        boxes.append({"text": text, "bbox": bbox(group), "kind": kind, "footnote_refs": refs,
                      "line_bboxes": [l["bbox"] for l in group["lines"]]})
    return sorted(boxes, key=lambda b: (b["bbox"][1], b["bbox"][0]))


def _parse_footnotes(lines, page_width):
    """Footnotes run in two columns; each starts with a superscript letter marker."""
    notes, current = {}, None
    for line in sorted(lines, key=lambda l: (l["bbox"][0] > page_width / 2, l["bbox"][1])):
        tabbed = re.match(r"([a-z]{1,3})\t", line["text"])
        marker = line["marker"] if line["marker"] and re.fullmatch(r"[a-z]{1,3}", line["marker"]) else None
        marker = marker or (tabbed.group(1) if tabbed else None)
        if marker:
            current = marker
            notes[current] = line["text"][len(current):].strip()
        elif current:
            notes[current] += " " + line["text"]
    return notes


def _merge_collinear(brackets):
    merged = []
    for br in sorted(brackets, key=lambda b: (round(b["x"]), b["y0"])):
        last = merged[-1] if merged else None
        if last and abs(last["x"] - br["x"]) < 1 and br["y0"] <= last["y1"] + 1:
            last["y1"] = max(last["y1"], br["y1"])
        else:
            merged.append(dict(br))
    return merged


def _dist_point_box(pt, bbox, pad=0):
    x, y = pt
    x0, y0, x1, y1 = bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad
    dx = max(x0 - x, 0, x - x1)
    dy = max(y0 - y, 0, y - y1)
    return math.hypot(dx, dy)


def extract_page_graph(doc, index):
    page = doc[index]
    segments, heads, brackets = [], [], []
    for g in page.get_drawings():
        r = g["rect"]
        if r.y0 < TOP or r.y1 > BOTTOM:
            continue
        if g["type"] == "f" and r.width < 10 and r.height < 10:
            heads.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))
        elif g["type"] == "s" and (g.get("width") or 0) >= 0.9:
            for item in g["items"]:
                if item[0] == "l":
                    segments.append((tuple(item[1]), tuple(item[2])))

    def head_dist(pt):
        return min((math.hypot(pt[0] - h[0], pt[1] - h[1]) for h in heads), default=99)

    connectors = []
    for a, b in segments:
        da, db = head_dist(a), head_dist(b)
        ha, hb = da < 8, db < 8
        if ha and hb and min(da, db) < 0.5 * max(da, db):
            # Both ends near a head: one belongs to another arrow ending on the same bar
            # (e.g. a junction's exit arrow); the end touching its own head is the closer one.
            ha, hb = da < db, db < da
        if abs(a[0] - b[0]) < 1 and not (ha != hb and abs(a[1] - b[1]) > 6):
            # Vertical strokes are box brackets (an arrow may touch one mid-way, splitting it);
            # a vertical stroke with an arrowhead at exactly one end is a downward/upward arrow.
            brackets.append({"x": a[0], "y0": min(a[1], b[1]), "y1": max(a[1], b[1])})
        elif ha != hb:
            connectors.append((b, a) if ha else (a, b))  # (tail, head)

    # Bent arrows (loop-backs drawn as several segments meeting at corners, arrowhead only on the
    # last piece): walk back from the tail through segments that join it end to end.
    def extend(tail, used):
        for _ in range(8):
            nxt = None
            for seg in segments:
                if seg in used:
                    continue
                for end, other in ((seg[0], seg[1]), (seg[1], seg[0])):
                    if math.hypot(end[0] - tail[0], end[1] - tail[1]) < 1.5 and head_dist(other) >= 8:
                        nxt = (seg, other)
                        break
                if nxt:
                    break
            if not nxt:
                return tail
            used.add(nxt[0])
            tail = nxt[1]
        return tail

    head_segments = {}
    for a, b in segments:
        head_segments[(a, b)] = True
    connectors = [(extend(t, {seg for seg in segments if t in seg and h in seg}), h) for t, h in connectors]

    brackets = _merge_collinear(brackets)
    # Everything below the lowest connector or bracket is the footnote block.
    flow_bottom = max([max(t[1], h[1]) for t, h in connectors] + [b["y1"] for b in brackets] + [TOP]) + 25
    lines = _text_lines(page)
    # Footnote lines: below the flow, or starting with a superscript letter marker at the left
    # margin (footnote blocks can sit beside the lower part of a flow).
    def is_note(l):
        marked = l["marker"] and re.fullmatch(r"[a-z]{1,3}", l["marker"]) and l["bbox"][0] < 40
        return l["bbox"][1] > flow_bottom or marked or (re.match(r"[a-z]{1,3}\t", l["text"]) and l["bbox"][0] < 40)

    note_top = min([l["bbox"][1] for l in lines if is_note(l)] + [BOTTOM])
    note_lines = [l for l in lines if is_note(l) or (l["bbox"][1] >= note_top and l["bbox"][0] < 40)]
    flow_lines = [l for l in lines if l not in note_lines]
    footnotes = _parse_footnotes(note_lines, page.rect.width)
    # A bar that arrows start from on its right is a fan-out stem, not an opening bracket: the
    # boxes to its right are separate branches (NSCLC/colon draw these close to the text).
    for br in brackets:
        br["stem"] = sum(br["x"] - 2 <= t[0] <= br["x"] + 10 and br["y0"] - 3 <= t[1] <= br["y1"] + 3
                         and h[0] > t[0] for t, h in connectors) >= 2
    boxes = _group_boxes(flow_lines, brackets)
    flow_top = min([min(t[1], h[1]) for t, h in connectors] + [b["y0"] for b in brackets] + [BOTTOM])
    for box in boxes:
        if box["kind"] == "header" and box["bbox"][3] > flow_top:
            box["kind"] = "box"  # all-caps text inside the flow (e.g. "PSADT >10 mo") is a node
    for box in boxes:
        # Position-based ids stay stable when extraction rules change elsewhere on the page, so
        # review verdicts and predicates keyed by id survive re-extraction.
        box["id"] = f"n{round(box['bbox'][1])}_{round(box['bbox'][0])}"
        box["links"] = LINK_RE.findall(box["text"])

    def nearest(pt, side):
        # Tail attaches to a box on its left; head attaches to a box (or bracket) on its right.
        cands = []
        for box in boxes:
            x0, _, x1, _ = box["bbox"]
            if side == "src" and any(abs(lb[2] - pt[0]) < 12 and lb[1] - 3 <= pt[1] <= lb[3] + 3
                                     for lb in box.get("line_bboxes", [])):
                # The arrow starts at the end of one line inside a multi-line box
                # ("... or Cabozantinib --> Progression").
                cands.append((0, box["id"]))
                continue
            leaves_vertically = x0 <= pt[0] <= x1 and not (box["bbox"][1] <= pt[1] <= box["bbox"][3])
            if side == "src" and x1 > pt[0] + 15 and not leaves_vertically:
                continue
            enters_vertically = x0 <= pt[0] <= x1 and not (box["bbox"][1] <= pt[1] <= box["bbox"][3])
            if side == "dst" and x0 < pt[0] - 15 and not enters_vertically:
                continue
            cands.append((_dist_point_box(pt, box["bbox"], pad=2), box["id"]))
        return min(cands)[1] if cands and min(cands)[0] < 60 else None

    def bracket_sources(pt):
        # A tail starting at a closing bracket comes from every box that bracket encloses.
        for br in brackets:
            if abs(pt[0] - br["x"]) < 10 and br["y0"] - 3 <= pt[1] <= br["y1"] + 3:
                enclosed = [
                    b["id"] for b in boxes
                    if 0 <= br["x"] - b["bbox"][2] <= 60 and b["bbox"][1] < br["y1"] and b["bbox"][3] > br["y0"]
                ]
                if enclosed:
                    return enclosed
        return []

    def bracket_owner(pt):
        # An arrowhead touching an opening bracket points at the box that bracket encloses.
        for br in brackets:
            if abs(pt[0] - br["x"]) < 10 and br["y0"] - 3 <= pt[1] <= br["y1"] + 3:
                owned = [
                    b for b in boxes
                    if 0 <= b["bbox"][0] - br["x"] <= 30 and b["bbox"][1] < br["y1"] and b["bbox"][3] > br["y0"]
                ]
                if owned:
                    return max(owned, key=lambda b: min(b["bbox"][3], br["y1"]) - max(b["bbox"][1], br["y0"]))["id"]
        return None

    def bar_at(pt):
        for k, br in enumerate(brackets):
            if abs(pt[0] - br["x"]) < 10 and br["y0"] - 3 <= pt[1] <= br["y1"] + 3:
                return k
        return None

    # Junction bars: several arrows end on one vertical bar and arrows leave it again (e.g. many
    # treatment rows collecting into one "Surveillance" box). An arrow into the bar continues to
    # wherever the bar's outgoing arrows go.
    # Only bars with arrows both arriving and leaving are junctions (a bar with only leaving
    # arrows is a fan-out stem or a closing bracket drawn from the boxes on its left).
    arriving = {bar_at(head) for _, head in connectors if bar_at(head) is not None and not bracket_owner(head)}
    leaving = {}
    for tail, head in connectors:
        if bar_at(tail) in arriving:
            leaving.setdefault(bar_at(tail), []).append(head)

    def targets(head, depth=0):
        owner = bracket_owner(head)
        if owner:
            return [owner]
        k = bar_at(head)
        if k is not None and k in leaving and depth < 3:
            return [t for h in leaving[k] for t in targets(h, depth + 1)]
        t = nearest(head, "dst")
        return [t] if t else []

    edges, unattached = set(), 0
    for tail, head in connectors:
        if bar_at(tail) in leaving:
            continue  # the junction's own exit arrow is folded into the arrows entering it
        dsts = targets(head)
        sources = bracket_sources(tail) or [nearest(tail, "src")]
        if not dsts or None in sources:
            unattached += 1  # a drawn arrow with no box at one end: a red flag for review
        for s in sources:
            for t in dsts:
                if s and t and s != t:
                    edges.add((s, t))

    return {
        "page_index": index,
        "nodes": boxes,
        "edges": [{"src": s, "dst": t} for s, t in sorted(edges)],
        "footnotes": footnotes,
        "n_connectors": len(connectors),
        "n_brackets": len(brackets),
        "n_unattached": unattached,
    }


def page_footnotes(spec):
    """Footnotes per page code: {flow or footnote page code: {letter: text}}. Letters are not
    unique across pages (the same letter can mean different notes), so lookups go through
    `footnote_text`, which prefers the node's own page and its "<code>A" footnote page."""
    out = {}
    for i, code in spec.ids.items():
        kind = spec.kind(i)
        if kind == "footnotes":
            page = spec.doc[i]
            out.setdefault(code, {}).update(_parse_footnotes(_text_lines(page), page.rect.width))
        elif kind == "algorithm":
            out.setdefault(code, {}).update(extract_page_graph(spec.doc, i)["footnotes"])
    return out


def footnote_text(store, page, letter):
    for code in (page, page + "A"):
        if letter in store.get(code, {}):
            return store[code][letter]
    prefix = page.split("-")[0] + "-"
    for code, notes in store.items():  # same letter elsewhere in the same section
        if code.startswith(prefix) and letter in notes:
            return notes[letter]
    return None
