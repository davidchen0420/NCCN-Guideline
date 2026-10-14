"""Inputs and outputs for the Haiku steps (fact schema, predicates, predicate review).
The LLM writes JSON files; everything else (checks, merging, nulling) is code.

  python -m nccn_nav.llm_tasks export-schema private/<slug>       -> llm/schema_input.txt
  python -m nccn_nav.llm_tasks check-schema private/<slug>        schema problems + coverage
  python -m nccn_nav.llm_tasks export-preds private/<slug> [n] [missing|entries]
      -> llm/pred_input_<k>.jsonl (n pages each; m<k>: boxes without a predicate; e<k>: null entry boxes)
  python -m nccn_nav.llm_tasks import-preds private/<slug>        llm/pred_out_*.json -> predicates.json
  python -m nccn_nav.llm_tasks export-review private/<slug> [n]   -> llm/review_input_<k>.txt
  python -m nccn_nav.llm_tasks apply-review private/<slug>        null predicates the review rejects
  python -m nccn_nav.llm_tasks export-schema-extend private/<slug> -> llm/schema_extend_input.txt (open boxes)
  python -m nccn_nav.llm_tasks guard-schema private/<slug>        restore dropped names after the extension
  python -m nccn_nav.llm_tasks export-typed private/<slug>        -> llm/pred_typed_input_<k>.jsonl (open boxes)
  python -m nccn_nav.llm_tasks import-typed private/<slug>        -> predicates, node_types, received; review_input_r<k>
"""
import json
import re
import sys
from pathlib import Path

from .facts import schema_problems
from .navigator import Guideline
from .predicates import facts_used
from .sections import load as load_sections


def decision_nodes(gl):
    """Nodes that need a condition: entry boxes (to pick where a patient starts) and every
    child of a box with several children (to pick the branch). Single children follow."""
    need = {}
    for page, roots in gl.roots.items():
        for r in roots:
            need[r] = {"page": page, "parent": None}
    for nid, kids in gl.children.items():
        if len(kids) > 1:
            for k in kids:
                need.setdefault(k, {"page": gl.nodes[k]["page"], "parent": nid})
    return need


def _short(text, n=400):
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= n else text[:n] + " …"


def export_schema(root):
    root = Path(root)
    gl = Guideline(root)
    need = decision_nodes(gl)
    (root / "llm").mkdir(exist_ok=True)
    lines = []
    for nid, info in need.items():
        parent = gl.nodes[info["parent"]]["text"] if info["parent"] else "(entry box)"
        lines.append(f"{nid} | parent: {_short(parent, 160)} | box: {_short(gl.nodes[nid]['text'])}")
    (root / "llm" / "schema_input.txt").write_text("\n".join(lines))
    print(f"{len(lines)} decision boxes -> llm/schema_input.txt")


def check_schema(root):
    root = Path(root)
    schema = json.loads((root / "fact_schema.json").read_text())
    problems = schema_problems(schema)
    print(f"{len(schema['variables'])} raw variables, {len(schema.get('derived', {}))} derived; "
          f"{len(problems)} problems")
    for name, why in problems:
        print(f"  {name}: {why}")
    return problems


def export_preds(root, per_file=15, only_missing=""):
    """With only_missing ("missing"), export only decision boxes that have no predicate yet,
    as pred_input_m<k>.jsonl, so reviewed predicates are kept as they are."""
    root = Path(root)
    gl = Guideline(root)
    need = decision_nodes(gl)
    prefix = ""
    sections = load_sections(root)
    if only_missing == "entries":
        # Entry boxes still without a condition (and not rejected by review), shown with their
        # section so the condition can name the rest (e.g. metastatic status).
        have = json.loads((root / "predicates.json").read_text())
        status = root / "predicates_status.json"
        rejected = set(json.loads(status.read_text())["rejected"]) if status.exists() else set()
        need = {k: v for k, v in need.items() if v["parent"] is None and have.get(k) is None and k not in rejected}
        prefix = "e"
        for old in (root / "llm").glob("pred_input_e*.jsonl"):
            old.unlink()
    elif only_missing:
        have = json.loads((root / "predicates.json").read_text()) if (root / "predicates.json").exists() else {}
        need = {k: v for k, v in need.items() if k not in have}
        prefix = "m"
        for old in (root / "llm").glob("pred_input_m*.jsonl"):
            old.unlink()
    pages = list(dict.fromkeys(info["page"] for info in need.values()))
    out = []
    for k in range(0, len(pages), int(per_file)):
        chunk = pages[k:k + int(per_file)]
        lines = []
        for nid, info in need.items():
            if info["page"] in chunk:
                parent = gl.nodes[info["parent"]]["text"] if info["parent"] else "(entry box: where a patient starts)"
                sibs = [gl.nodes[s]["text"] for s in gl.children.get(info["parent"], []) if s != nid] if info["parent"] else []
                row = {"id": nid, "parent": _short(parent, 200), "box": _short(gl.nodes[nid]["text"], 600),
                       "siblings": [_short(s, 120) for s in sibs]}
                if sections and sections["pages"].get(info["page"]):
                    row["section"] = sections["pages"][info["page"]]
                lines.append(json.dumps(row, ensure_ascii=False))
        path = root / "llm" / f"pred_input_{prefix}{k // int(per_file)}.jsonl"
        path.write_text("\n".join(lines))
        out.append(path.name)
    print(f"{len(need)} decision boxes on {len(pages)} pages -> {out}")


def import_preds(root):
    root = Path(root)
    schema = json.loads((root / "fact_schema.json").read_text())
    names = set(schema["variables"]) | set(schema.get("derived", {}))
    # Predicates already imported (and possibly nulled by review) are kept: outputs only fill ids
    # that have no entry yet, so a re-import never resurrects a rejected draft.
    preds = json.loads((root / "predicates.json").read_text()) if (root / "predicates.json").exists() else {}
    bad = []
    status = root / "predicates_status.json"
    rejected = set(json.loads(status.read_text())["rejected"]) if status.exists() else set()
    for f in sorted((root / "llm").glob("pred_out_*.json")):
        refill = f.name.startswith("pred_out_e")  # entry-box pass: may fill entries that are null
        for nid, pred in json.loads(f.read_text()).items():
            if nid in preds and not (refill and preds[nid] is None and nid not in rejected):
                continue
            unknown = facts_used(pred) - names if pred else set()
            if unknown:
                bad.append((nid, sorted(unknown)))
                pred = None  # predicates may only use schema variables
            preds[nid] = pred
    (root / "predicates.json").write_text(json.dumps(preds, indent=1))
    print(f"{len(preds)} predicates, {sum(p is not None for p in preds.values())} non-null, "
          f"{len(bad)} nulled for using variables outside the schema")


def export_review(root, per_file=60):
    root = Path(root)
    gl = Guideline(root)
    preds = json.loads((root / "predicates.json").read_text())
    need = decision_nodes(gl)
    status = root / "predicates_status.json"
    done = set()
    if status.exists():  # already reviewed in an earlier round
        st = json.loads(status.read_text())
        done = set(st["reviewed_correct"]) | set(st["rejected"])
    prefix = "n" if done else ""  # later rounds must not collide with earlier review_out files
    for old in (root / "llm").glob(f"review_input_{prefix}*.jsonl"):
        old.unlink()
    rows = []
    for nid, p in preds.items():
        if p is None or nid not in gl.nodes or nid in done:
            continue
        parent = need.get(nid, {}).get("parent")
        rows.append(json.dumps({"id": nid, "parent": _short(gl.nodes[parent]["text"], 200) if parent else "(entry box)",
                                "box": _short(gl.nodes[nid]["text"], 600), "predicate": p}, ensure_ascii=False))
    for k in range(0, len(rows), int(per_file)):
        (root / "llm" / f"review_input_{prefix}{k // int(per_file)}.jsonl").write_text("\n".join(rows[k:k + int(per_file)]))
    print(f"{len(rows)} predicates to review in {(len(rows) + int(per_file) - 1) // int(per_file)} files")


def apply_review(root):
    """Null predicates whose latest review verdict is not "correct". Verdict files are read in
    name order (first round, then "n" rounds, then "r" repair rounds), so a later verdict on a
    repaired predicate replaces the earlier one."""
    root = Path(root)
    preds = json.loads((root / "predicates.json").read_text())
    received_path = root / "received_predicates.json"
    received = json.loads(received_path.read_text()) if received_path.exists() else {}
    path = root / "predicates_status.json"
    latest = {}
    if path.exists():
        old = json.loads(path.read_text())
        latest.update({k: "correct" for k in old.get("reviewed_correct", [])})
        latest.update({k: "rejected" for k in old.get("rejected", [])})
    verdicts = {}
    for f in sorted((root / "llm").glob("review_out_*.json")):
        verdicts.update(json.loads(f.read_text()))
    latest.update({k: "correct" if v.get("verdict") == "correct" else "rejected" for k, v in verdicts.items()})
    nulled = 0
    for nid, v in latest.items():
        if v != "rejected":
            continue
        if nid.endswith("#received"):
            if received.get(nid[:-9]) is not None:
                received[nid[:-9]] = None
                nulled += 1
        elif preds.get(nid) is not None:
            preds[nid] = None  # rejected predicates are removed, never hand-patched
            nulled += 1
    (root / "predicates.json").write_text(json.dumps(preds, indent=1))
    if received:
        received_path.write_text(json.dumps(received, indent=1))
    status = {"reviewed_correct": sorted(k for k, v in latest.items() if v == "correct"),
              "rejected": sorted(k for k, v in latest.items() if v == "rejected")}
    path.write_text(json.dumps(status, indent=1))
    print(f"reviewed {len(latest)}, rejected and nulled {nulled}, "
          f"usable {sum(p is not None for p in preds.values())}/{len(preds)}")


def review_notes(root):
    """Reviewer reasons for rejected predicates, with the rejected draft: {id: {"note", "draft"}}."""
    root = Path(root)
    drafts = {}
    for f in sorted((root / "llm").glob("pred_out_*.json")):
        drafts.update(json.loads(f.read_text()))
    notes = {}
    for f in sorted((root / "llm").glob("review_out_*.json")):
        for nid, v in json.loads(f.read_text()).items():
            if v.get("verdict") != "correct":
                notes[nid] = {"note": v.get("note", ""), "draft": drafts.get(nid)}
            else:
                notes.pop(nid, None)
    return notes


def _footnotes(gl, nid, n=300):
    from .pdfvec import footnote_text

    node = gl.nodes[nid]
    texts = [footnote_text(gl.footnotes, node["page"], m) for m in node.get("footnote_refs", [])]
    return _short(" | ".join(t for t in texts if t), n)


def _heading(gl, page):
    """The page's own heading (the bold title above its flowchart), which often states which
    patients the page is for when its entry box is a workup list."""
    return next((n["text"] for n in gl.page_headers.get(page, [])), "")


def _open_boxes(root, gl):
    """Decision boxes without a usable condition and without a type from the typed pass."""
    preds = json.loads((root / "predicates.json").read_text())
    return {k: v for k, v in decision_nodes(gl).items() if preds.get(k) is None}


def export_schema_extend(root):
    root = Path(root)
    gl = Guideline(root)
    notes = review_notes(root)
    sections = load_sections(root)
    lines = []
    for nid, info in _open_boxes(root, gl).items():
        parent = gl.nodes[info["parent"]]["text"] if info["parent"] else f"(entry box; page heading: {_short(_heading(gl, info['page']), 160)})"
        sec = (sections or {}).get("pages", {}).get(info["page"]) or ""
        note = notes.get(nid, {}).get("note", "")
        lines.append(f"{nid} | {sec} | parent: {_short(parent, 160)} | box: {_short(gl.nodes[nid]['text'], 300)} | "
                     f"footnotes: {_footnotes(gl, nid)} | review: {note}")
    (root / "llm" / "schema_extend_input.txt").write_text("\n".join(lines))
    backup = root / "fact_schema_v1.json"
    if not backup.exists():
        backup.write_text((root / "fact_schema.json").read_text())
    print(f"{len(lines)} open decision boxes -> llm/schema_extend_input.txt")


def guard_schema(root):
    """After the extension pass: restore anything the model dropped (names, enum values) from
    fact_schema_v1.json, keep the guideline_section variable, and report schema problems."""
    from .sections import build as build_sections

    root = Path(root)
    old = json.loads((root / "fact_schema_v1.json").read_text())
    try:
        new = json.loads((root / "fact_schema.json").read_text())
        assert isinstance(new.get("variables"), dict)
    except (json.JSONDecodeError, AssertionError):
        new = old
    new.setdefault("derived", {})
    restored = 0
    for part in ("variables", "derived"):
        for name, var in old.get(part, {}).items():
            have = new["variables"].get(name) or new["derived"].get(name)
            if have is None:
                new[part][name] = var
                restored += 1
            elif var.get("values") and have.get("values") is not None:
                have["values"] = list(dict.fromkeys(var["values"] + have["values"]))
    (root / "fact_schema.json").write_text(json.dumps(new, indent=1, ensure_ascii=False))
    build_sections(root)
    added = len(new["variables"]) + len(new["derived"]) - len(old["variables"]) - len(old.get("derived", {}))
    print(f"{root.name}: +{added} variables/derived, {restored} restored, {len(schema_problems(new))} problems")


def export_typed(root, per_file=40):
    root = Path(root)
    gl = Guideline(root)
    notes = review_notes(root)
    sections = load_sections(root)
    for old in (root / "llm").glob("pred_typed_input_*.jsonl"):
        old.unlink()
    rows = []
    for nid, info in _open_boxes(root, gl).items():
        parent = gl.nodes[info["parent"]]["text"] if info["parent"] else "(entry box: where a patient starts)"
        sibs = [gl.nodes[s]["text"] for s in gl.children.get(info["parent"], []) if s != nid] if info["parent"] else []
        if not info["parent"]:
            sibs = [gl.nodes[s]["text"] for s in gl.roots.get(info["page"], []) if s != nid]
        row = {"id": nid, "parent": _short(parent, 200), "box": _short(gl.nodes[nid]["text"], 600),
               "siblings": [_short(s, 120) for s in sibs]}
        sec = (sections or {}).get("pages", {}).get(info["page"])
        if sec:
            row["section"] = sec
        fn = _footnotes(gl, nid)
        if fn:
            row["footnotes"] = fn
        if not info["parent"]:
            row["page_heading"] = _short(_heading(gl, info["page"]), 200)
        if nid in notes and notes[nid]["draft"] is not None:
            row["rejected"] = {"condition": notes[nid]["draft"], "reason": notes[nid]["note"]}
        rows.append(json.dumps(row, ensure_ascii=False))
    for k in range(0, len(rows), int(per_file)):
        (root / "llm" / f"pred_typed_input_{k // int(per_file)}.jsonl").write_text("\n".join(rows[k:k + int(per_file)]))
    print(f"{root.name}: {len(rows)} open boxes in {(len(rows) + int(per_file) - 1) // int(per_file)} files")


def import_typed(root):
    """Typed pass outputs -> predicates.json (fills null entries only), node_types.json and
    received_predicates.json; then writes review inputs ("r" round) for every new condition."""
    root = Path(root)
    gl = Guideline(root)
    schema = json.loads((root / "fact_schema.json").read_text())
    names = set(schema["variables"]) | set(schema.get("derived", {}))
    preds = json.loads((root / "predicates.json").read_text())
    types_path, rec_path = root / "node_types.json", root / "received_predicates.json"
    types = json.loads(types_path.read_text()) if types_path.exists() else {}
    received = json.loads(rec_path.read_text()) if rec_path.exists() else {}
    new, bad = {}, 0
    for f in sorted((root / "llm").glob("pred_typed_out_*.json")):
        for nid, v in json.loads(f.read_text()).items():
            if not isinstance(v, dict) or nid not in gl.nodes:
                continue
            types[nid] = v.get("type") if v.get("type") in ("condition", "option", "other") else "other"
            for key, store in (("predicate", preds), ("received", received)):
                p = v.get(key)
                if p is not None and facts_used(p) - names:
                    p, bad = None, bad + 1
                if key == "predicate" and preds.get(nid) is not None:
                    continue  # never replaces a reviewed condition
                store[nid] = p
                if p is not None:
                    new[nid if key == "predicate" else f"{nid}#received"] = p
    for nid in decision_nodes(gl):
        if preds.get(nid) is not None:
            types.setdefault(nid, "condition")
    preds = {k: v for k, v in preds.items()}
    (root / "predicates.json").write_text(json.dumps(preds, indent=1))
    types_path.write_text(json.dumps(types, indent=1))
    rec_path.write_text(json.dumps(received, indent=1))
    need = decision_nodes(gl)
    rows = []
    for key, p in new.items():
        nid = key.split("#")[0]
        parent = need.get(nid, {}).get("parent")
        box = gl.nodes[nid]["text"]
        if key.endswith("#received"):
            box = f"[condition = the patient already received this option] {box}"
        rows.append(json.dumps({"id": key, "parent": _short(gl.nodes[parent]["text"], 200) if parent else "(entry box)",
                                "box": _short(box, 600), "predicate": p}, ensure_ascii=False))
    for old in (root / "llm").glob("review_input_r*.jsonl"):
        old.unlink()
    for k in range(0, len(rows), 60):
        (root / "llm" / f"review_input_r{k // 60}.jsonl").write_text("\n".join(rows[k:k + 60]))
    print(f"{root.name}: {len(new)} new conditions to review, {bad} nulled for unknown variables, "
          f"types {dict(__import__('collections').Counter(types.values()))}")


if __name__ == "__main__":
    cmd, root, *rest = sys.argv[1:]
    {"export-schema": export_schema, "check-schema": check_schema, "export-preds": export_preds,
     "import-preds": import_preds, "export-review": export_review, "apply-review": apply_review,
     "export-schema-extend": export_schema_extend, "guard-schema": guard_schema,
     "export-typed": export_typed, "import-typed": import_typed}[cmd](root, *rest)
