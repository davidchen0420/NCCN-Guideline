"""Inputs and outputs for the Haiku steps (fact schema, predicates, predicate review).
The LLM writes JSON files; everything else (checks, merging, nulling) is code.

  python -m nccn_nav.llm_tasks export-schema private/<slug>       -> llm/schema_input.txt
  python -m nccn_nav.llm_tasks check-schema private/<slug>        schema problems + coverage
  python -m nccn_nav.llm_tasks export-preds private/<slug> [n]    -> llm/pred_input_<k>.txt (n pages each)
  python -m nccn_nav.llm_tasks import-preds private/<slug>        llm/pred_out_*.json -> predicates.json
  python -m nccn_nav.llm_tasks export-review private/<slug> [n]   -> llm/review_input_<k>.txt
  python -m nccn_nav.llm_tasks apply-review private/<slug>        null predicates the review rejects
"""
import json
import re
import sys
from pathlib import Path

from .facts import schema_problems
from .navigator import Guideline
from .predicates import facts_used


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
    if only_missing:
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
                lines.append(json.dumps({"id": nid, "parent": _short(parent, 200), "box": _short(gl.nodes[nid]["text"], 600),
                                         "siblings": [_short(s, 120) for s in sibs]}, ensure_ascii=False))
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
    for f in sorted((root / "llm").glob("pred_out_*.json")):
        for nid, pred in json.loads(f.read_text()).items():
            if nid in preds:
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
    root = Path(root)
    preds = json.loads((root / "predicates.json").read_text())
    verdicts = {}
    for f in sorted((root / "llm").glob("review_out_*.json")):
        verdicts.update(json.loads(f.read_text()))
    nulled = 0
    for nid, v in verdicts.items():
        if nid in preds and preds[nid] is not None and v.get("verdict") != "correct":
            preds[nid] = None  # rejected predicates are removed, never hand-patched
            nulled += 1
    (root / "predicates.json").write_text(json.dumps(preds, indent=1))
    status = {"reviewed_correct": sorted(k for k, v in verdicts.items() if v.get("verdict") == "correct"),
              "rejected": sorted(k for k, v in verdicts.items() if v.get("verdict") != "correct")}
    path = root / "predicates_status.json"
    if path.exists():  # keep earlier rounds' verdicts
        old = json.loads(path.read_text())
        for key in status:
            status[key] = sorted(set(status[key]) | set(old.get(key, [])))
    (root / "predicates_status.json").write_text(json.dumps(status, indent=1))
    print(f"reviewed {len(verdicts)}, rejected and nulled {nulled}, "
          f"usable {sum(p is not None for p in preds.values())}/{len(preds)}")


if __name__ == "__main__":
    cmd, root, *rest = sys.argv[1:]
    {"export-schema": export_schema, "check-schema": check_schema, "export-preds": export_preds,
     "import-preds": import_preds, "export-review": export_review, "apply-review": apply_review}[cmd](root, *rest)
