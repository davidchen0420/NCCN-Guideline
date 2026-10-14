"""Strategy E1: rebuild an NCCN algorithm page as a graph from the PDF's vector layer.

NCCN flow pages draw connectors as stroked line paths (width ~1.0) with small filled
triangles as arrowheads; thinner strokes (~0.75) are hyperlink underlines, and
unarrowed vertical strokes are brackets that group a multi-line box.
"""
import math
import re

import pymupdf

from .layout import norm_hyphens, page_bands

# Footnote letters: a..z, then aa, bb, ... (some guidelines run on to aaaa).
MARK = r"[a-z]{1,4}"
MARK_RE = re.compile(MARK)
# Page references printed in boxes; `configure(spec)` narrows them to the guideline's prefixes.
LINK_RE = re.compile(r"\(([A-Z][A-Z0-9_/]{1,11}-[A-Z0-9]+(?: \d+ of \d+)?)\)")


def configure(spec):
    """Use the page-reference pattern of one guideline (guideline.Spec)."""
    global LINK_RE
    LINK_RE = spec.link_re


def _text_lines(page, bands=None):
    top, bottom = bands or page_bands(page)
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
                if re.fullmatch(MARK_RE, r)
            ]
            text = norm_hyphens("".join(
                s["text"] for s in line["spans"] if not (s in spans[1:] and s["size"] <= body * 0.85)
            )).strip()
            x0, y0, x1, y1 = line["bbox"]
            if text and top < y0 and y1 < bottom:
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
        if br["x"] - 40 <= x1 <= br["x"] + 4 and br["y0"] - 3 <= mid <= br["y1"] + 3  # line boxes can overhang the bar
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
                # Left-aligned, or a hanging indent / nested bullet just right of the box's edge.
                and -4 < x0 - gx0 < 16
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
        for other in sorted([g for g in groups if g["bracket"] is None],  # nearest first, so
                            key=lambda g: abs(bbox(g)[1] - bbox(group)[1])):  # absorbed lines chain
            ox0, oy0, ox1, oy1 = bbox(other)
            gx0 = bbox(group)[0]
            in_span = br["y0"] - 3 <= (oy0 + oy1) / 2 <= br["y1"] + 3
            in_column = gx0 - 2 <= ox0 <= gx0 + 15 and (side == "open" or ox1 <= br["x"] + 1)
            if side == "close" and not in_column:
                # Short lines of a closing-bracket block end far from the bar: they belong to it
                # when they share its column and touch its lines vertically.
                gx1 = bbox(group)[2]
                near = any(abs(oy0 - l["bbox"][3]) < 6 or abs(l["bbox"][1] - oy1) < 6 for l in group["lines"])
                in_column = ox0 < gx1 and ox1 > gx0 - 2 and ox1 <= br["x"] + 1 and near
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
                      "line_bboxes": [l["bbox"] for l in group["lines"]],
                      "line_texts": [l["text"] for l in group["lines"]]})
    return sorted(boxes, key=lambda b: (b["bbox"][1], b["bbox"][0]))


def _letter_key(m):
    return (len(m), m)  # footnote letters run a..z, then aa, bb, ...


def _parse_footnotes(lines, page_width):
    """Footnotes run in two columns; each starts with a letter marker: a superscript, a letter
    and a tab, or (in some guidelines) a plain letter and a space at a hanging indent."""
    notes, current = {}, None
    # Columns start where marker lines start (they need not split at the page midline).
    starts = []
    for x in sorted(l["bbox"][0] for l in lines
                    if (l["marker"] and MARK_RE.fullmatch(l["marker"])) or re.match(MARK + r"[\t ]", l["text"])):
        if not starts or x - starts[-1] > 40:
            starts.append(x)
    starts = starts or [0, page_width / 2]

    def column(l):
        return max([i for i, x in enumerate(starts) if x <= l["bbox"][0] + 8] or [0])

    ordered = sorted(lines, key=lambda l: (column(l), l["bbox"][1]))
    for k, line in enumerate(ordered):
        if re.match(r"(Footnotes?|References|Continued)\b", line["text"]):
            current = None  # navigation lines ("Footnotes on AE-7A", "Continued") end a note
            continue
        tabbed = re.match(r"(" + MARK + r")\t", line["text"])
        marker = line["marker"] if line["marker"] and re.fullmatch(MARK_RE, line["marker"]) else None
        marker = marker or (tabbed.group(1) if tabbed else None)
        plain = re.match(r"(([a-z])\2{0,3}) +(?=\S)", line["text"])  # a..z, aa, bb, ...
        if not marker and plain:
            # A plain letter counts only if it continues the sequence and the next line of the
            # column is indented past it (hanging indent) or starts another note.
            nxt = next((l for l in ordered[k + 1:] if column(l) == column(line)), None)
            hanging = nxt is None or nxt["bbox"][0] > line["bbox"][0] + 2 or re.match(r"([a-z])\1{0,3} ", nxt["text"])
            if hanging and (current is None or _letter_key(plain.group(1)) > _letter_key(current)):
                marker = plain.group(1)
        if marker:
            current = marker
            notes[current] = line["text"][len(current):].strip()
        elif current:
            notes[current] += " " + line["text"]
    return notes


def _split_alternatives(boxes, connectors, brackets):
    """Split a box whose "or"-separated alternatives each start their own arrow (a bracket of
    options leading to different next steps) into one box per alternative. A segment without
    its own arrow stays with the next segment that has one ("A or B -> X" keeps A with B).
    Returns (boxes, groups of ids that came from one box)."""
    out, groups = [], []
    for box in boxes:
        lines = sorted(zip(box.get("line_bboxes", []), box.get("line_texts", [])), key=lambda l: l[0][1])
        segs, cur = [], []
        for bb, text in lines:
            if text.strip().lower() == "or":
                if cur:
                    segs.append(cur)
                cur = []
            else:
                cur.append((bb, text))
        if cur:
            segs.append(cur)
        if len(segs) < 2:
            out.append(box)
            continue

        spans = [(min(b[1] for b, _ in sg), max(b[3] for b, _ in sg)) for sg in segs]
        x1s = [max(b[2] for b, _ in sg) for sg in segs]

        def reach(k):
            # How far right of alternative k an arrow may start and still be its own.
            y0, y1 = spans[k]
            blockers = [o["bbox"][0] for o in boxes if o is not box and o["bbox"][0] > x1s[k] - 5
                        and o["bbox"][1] < y1 and o["bbox"][3] > y0]
            return x1s[k] - 15, min([x1s[k] + 80] + blockers)

        def owners(t):
            """Alternatives an arrow tail belongs to: all those a nearby bracket bar under the
            tail spans, else the one beside it."""
            for br in brackets:
                if abs(t[0] - br["x"]) < 10 and br["y0"] - 3 <= t[1] <= br["y1"] + 3:
                    covered = {k for k, (y0, y1) in enumerate(spans) if br["y0"] - 3 <= (y0 + y1) / 2 <= br["y1"] + 3
                               and reach(k)[0] <= br["x"] <= reach(k)[1]}
                    if covered:
                        return covered
            for k, (y0, y1) in enumerate(spans):
                lo, hi = reach(k)
                if lo <= t[0] <= hi and y0 - 4 <= t[1] <= y1 + 4:
                    return {k}
            return set()

        clusters = []
        for t, h in connectors:
            own = owners(t) if h[0] > t[0] else set()
            if not own:
                continue
            for c in [c for c in clusters if c & own]:
                own |= c
                clusters.remove(c)
            clusters.append(own)
        if len(clusters) < 2:
            out.append(box)
            continue
        # Alternatives without an arrow of their own join the next arrow's group ("A or B -> X");
        # trailing ones stand alone (e.g. "or Clinical trials" with no next step).
        label = {k: i for i, c in enumerate(sorted(clusters, key=min)) for k in c}
        merged, pending = {}, []
        for k in range(len(segs)):
            if k in label:
                merged.setdefault(label[k], []).extend(pending + segs[k])
                pending = []
            else:
                pending += segs[k]
        merged = [merged[i] for i in sorted(merged)] + ([pending] if pending else [])
        ids = []
        for seg in merged:
            bbs = [b for b, _ in seg]
            bbox = [min(b[0] for b in bbs), min(b[1] for b in bbs), max(b[2] for b in bbs), max(b[3] for b in bbs)]
            text = " ".join(t for _, t in seg)
            part = {**box, "text": text, "bbox": bbox, "line_bboxes": bbs, "line_texts": [t for _, t in seg],
                    "id": f"n{round(bbox[1])}_{round(bbox[0])}", "links": LINK_RE.findall(text)}
            out.append(part)
            ids.append(part["id"])
        groups.append(set(ids))
    return out, groups


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
    drawings = page.get_drawings()
    top, bottom = bands = page_bands(page, drawings)
    for g in drawings:
        r = g["rect"]
        if r.y0 < top or r.y1 > bottom:
            continue
        if g["type"] == "f" and r.width < 10 and r.height < 10:
            heads.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))
        elif g["type"] == "s" and (g.get("width") or 0) >= 0.9:
            for item in g["items"]:
                if item[0] == "l":
                    segments.append((tuple(item[1]), tuple(item[2])))

    def head_dist(pt):
        return min((math.hypot(pt[0] - h[0], pt[1] - h[1]) for h in heads), default=99)

    def head_on_axis(end, other):
        """The arrowhead at `end` continues this vertical stroke (not a horizontal arrow that
        merely touches a bracket there)."""
        h = min(heads, key=lambda h: math.hypot(end[0] - h[0], end[1] - h[1]))
        beyond = (h[1] - other[1]) * (end[1] - other[1]) > 0 and abs(h[1] - other[1]) >= abs(end[1] - other[1]) - 2
        return abs(h[0] - end[0]) < 2 and beyond

    connectors = []
    for a, b in segments:
        da, db = head_dist(a), head_dist(b)
        ha, hb = da < 8, db < 8
        if ha and hb and min(da, db) < 0.5 * max(da, db):
            # Both ends near a head: one belongs to another arrow ending on the same bar
            # (e.g. a junction's exit arrow); the end touching its own head is the closer one.
            ha, hb = da < db, db < da
        vertical_arrow = (abs(a[0] - b[0]) < 1 and ha != hb and abs(a[1] - b[1]) > 6
                          and head_on_axis(a if ha else b, b if ha else a))
        if abs(a[0] - b[0]) < 1 and not vertical_arrow:
            # Vertical strokes are box brackets (an arrow may touch one mid-way, splitting it);
            # a vertical stroke whose own arrowhead sits on its axis is a downward/upward arrow.
            brackets.append({"x": a[0], "y0": min(a[1], b[1]), "y1": max(a[1], b[1])})
        elif ha != hb:
            connectors.append((b, a) if ha else (a, b))  # (tail, head)

    # Bent arrows (loop-backs drawn as several segments meeting at corners, arrowhead only on the
    # last piece): walk back from the tail through segments that meet it at a right angle. A
    # segment that other arrows start from (a fan-out stem) or that is itself an arrow is never
    # followed, so straight arrows sharing a stem keep their own tails.
    arrow_segments = {seg for seg in segments if (head_dist(seg[0]) < 8) != (head_dist(seg[1]) < 8)}

    def on_segment(pt, seg):
        (x0, y0), (x1, y1) = seg
        if abs(x0 - x1) < 1:
            return abs(pt[0] - x0) < 1.5 and min(y0, y1) - 1.5 <= pt[1] <= max(y0, y1) + 1.5
        if abs(y0 - y1) < 1:
            return abs(pt[1] - y0) < 1.5 and min(x0, x1) - 1.5 <= pt[0] <= max(x0, x1) + 1.5
        return False

    def extend(tail, leg):
        tails = [t for t, _ in connectors if t != tail]
        for _ in range(8):
            leg_vertical = abs(leg[0][0] - leg[1][0]) < 1
            nxt = None
            for seg in segments:
                if seg == leg or seg in arrow_segments:
                    continue
                if (abs(seg[0][0] - seg[1][0]) < 1) == leg_vertical:
                    continue  # not a corner
                if any(on_segment(t, seg) for t in tails):
                    continue  # a stem other arrows start from
                for end, other in ((seg[0], seg[1]), (seg[1], seg[0])):
                    if math.hypot(end[0] - tail[0], end[1] - tail[1]) < 1.5 and head_dist(other) >= 8:
                        nxt = (seg, other)
                        break
                if nxt:
                    break
            if not nxt:
                return tail
            leg, tail = nxt
        return tail

    connectors = [(extend(t, next((seg for seg in segments if t in seg and h in seg), (t, h))), h)
                  for t, h in connectors]

    brackets = _merge_collinear(brackets)
    # Everything below the lowest connector or bracket is the footnote block.
    # A page with no connectors or brackets (a list or prose page) has no flow to bound it: only
    # marker-led lines are footnotes there.
    flow_bottom = (max([max(t[1], h[1]) for t, h in connectors] + [b["y1"] for b in brackets]) + 25
                   if connectors or brackets else bottom)
    lines = _text_lines(page, bands)
    # Footnote lines: below the flow, or starting with a superscript letter marker at the left
    # margin (footnote blocks can sit beside the lower part of a flow).
    margin = 0.05 * page.rect.width  # footnotes start at the left page margin

    def is_note(l):
        marked = l["marker"] and re.fullmatch(MARK_RE, l["marker"]) and l["bbox"][0] < margin
        return l["bbox"][1] > flow_bottom or marked or (re.match(MARK + r"\t", l["text"]) and l["bbox"][0] < margin)

    note_top = min([l["bbox"][1] for l in lines if is_note(l)] + [bottom])
    note_lines = [l for l in lines if is_note(l) or (l["bbox"][1] >= note_top and l["bbox"][0] < margin)]
    flow_lines = [l for l in lines if l not in note_lines]
    footnotes = _parse_footnotes(note_lines, page.rect.width)
    # A bar that arrows start from on its right is a fan-out stem, not an opening bracket: the
    # boxes to its right are separate branches (NSCLC/colon draw these close to the text).
    for br in brackets:
        br["stem"] = sum(br["x"] - 2 <= t[0] <= br["x"] + 10 and br["y0"] - 3 <= t[1] <= br["y1"] + 3
                         and h[0] > t[0] for t, h in connectors) >= 2
    boxes = _group_boxes(flow_lines, brackets)
    flow_top = min([min(t[1], h[1]) for t, h in connectors] + [b["y0"] for b in brackets] + [bottom])
    for box in boxes:
        if box["kind"] == "header" and box["bbox"][3] > flow_top:
            box["kind"] = "box"  # all-caps text inside the flow (e.g. "PSADT >10 mo") is a node
    for box in boxes:
        # Position-based ids stay stable when extraction rules change elsewhere on the page, so
        # review verdicts and predicates keyed by id survive re-extraction.
        box["id"] = f"n{round(box['bbox'][1])}_{round(box['bbox'][0])}"
        box["links"] = LINK_RE.findall(box["text"])
    boxes, split_groups = _split_alternatives(boxes, connectors, brackets)

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
            # An arrow may leave or enter a box through its top or bottom edge (within 10pt).
            near_edge = 0 < box["bbox"][1] - pt[1] <= 10 or 0 < pt[1] - box["bbox"][3] <= 10
            leaves_vertically = x0 <= pt[0] <= x1 and near_edge
            if side == "src" and x1 > pt[0] + 15 and not leaves_vertically:
                continue
            enters_vertically = x0 <= pt[0] <= x1 and near_edge
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

    # An arrow into a bracket of alternatives reaches every alternative.
    for group in split_groups:
        for s_, t_ in list(edges):
            if t_ in group and s_ not in group:
                edges |= {(s_, g) for g in group}

    return {
        "page_index": index,
        "page_size": [page.rect.width, page.rect.height],
        "content_band": [round(top, 1), round(bottom, 1)],
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
