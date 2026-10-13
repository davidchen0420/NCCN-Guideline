"""Strategies A4/A5: a graph-walking engine an LLM agent drives one decision at a time.

The engine owns the state and moves along edges; the LLM only picks among the current
node's children. Each step shows the node's footnotes and node-scoped retrieved text.
With predicates (A5), children whose condition can be evaluated from structured facts are
chosen deterministically and the LLM is not asked.

CLI (state lives in <private>/nav_state/<session>.json):
  python -m nccn_nav.navigator <private> start <session> <PAGE> [--facts facts.json]
  python -m nccn_nav.navigator <private> show <session>
  python -m nccn_nav.navigator <private> choose <session> <child_id> "<one-line reason>"
  python -m nccn_nav.navigator <private> finish <session>
"""
import json
import os
import re
import sys
from pathlib import Path

from .predicates import evaluate
from .textlayer import Retriever


class Guideline:
    def __init__(self, private):
        self.private = Path(private)
        pages = json.loads((self.private / "e1_graphs.json").read_text())
        self.footnotes = json.loads((self.private / "footnotes.json").read_text())
        self.retriever = Retriever(json.loads((self.private / "chunks.json").read_text()))
        pred_path = self.private / "predicates.json"
        self.predicates = json.loads(pred_path.read_text()) if pred_path.exists() else {}
        self.nodes, self.children, self.roots = {}, {}, {}
        for page, g in pages.items():
            has_parent = {e["dst"] for e in g["edges"]}
            for n in g["nodes"]:
                if n["kind"] != "box":
                    continue
                nid = f"{page}:{n['id']}"
                self.nodes[nid] = {**n, "id": nid, "page": page}
                self.children.setdefault(nid, [])
            for e in g["edges"]:
                src, dst = f"{page}:{e['src']}", f"{page}:{e['dst']}"
                if src in self.nodes and dst in self.nodes:
                    self.children[src].append(dst)
            self.roots[page] = [
                f"{page}:{n['id']}" for n in g["nodes"]
                if n["kind"] == "box" and n["id"] not in has_parent and any(e["src"] == n["id"] for e in g["edges"])
            ]
        # A leaf that references another flow page continues on that page's entry nodes.
        for nid, node in self.nodes.items():
            if not self.children[nid]:
                for link in node.get("links", []):
                    allowed = os.environ.get("NAV_PAGES")
                    in_scope = not allowed or link in allowed.split(",")
                    if re.fullmatch(r"PROS-\d+", link) and link != node["page"] and in_scope:
                        self.children[nid] += self.roots.get(link, [])

    def context(self, nid, k=2):
        node = self.nodes[nid]
        if nid.endswith(":START"):
            return {}, []
        notes = {r: self.footnotes[r] for r in node.get("footnote_refs", []) if r in self.footnotes}
        # Principles pages cited in the node or its footnotes scope the retrieval.
        cited = set(re.findall(r"PROS-[A-N]\b", node["text"] + " " + " ".join(notes.values())))
        query = node["text"] + " " + " ".join(self.nodes[c]["text"] for c in self.children[nid])
        hits = self.retriever.search(query, k=k, pages=sorted(cited) or None)
        return notes, hits


def _state_path(private, session):
    path = Path(private) / "nav_state" / f"{session}.json"
    path.parent.mkdir(exist_ok=True)
    return path


def _facts_decide_next_branch(gl, kids, facts, depth=3):
    """True if the facts already resolve a branch shortly after a lone arrow, i.e. the case
    describes events after this recommendation, so the walk should continue."""
    frontier = list(kids)
    for _ in range(depth):
        nxt = []
        for node in frontier:
            grand = gl.children[node]
            if len(grand) > 1:
                verdicts = [evaluate(gl.predicates.get(c), facts) for c in grand]
                if verdicts.count(True) == 1 and None not in verdicts:
                    return True
            nxt += grand
        frontier = nxt
    return False


def _reconvergence(gl, kids, depth=3):
    """First node reachable from every child within `depth` steps, if any."""
    reach = []
    for kid in kids:
        seen, frontier = [], [kid]
        for _ in range(depth):
            frontier = [c for n in frontier for c in gl.children[n]]
            seen += frontier
        reach.append(seen)
    common = [n for n in reach[0] if all(n in r for r in reach[1:])]
    return common[0] if common else None


def _auto_step(gl, state):
    """A5: follow children whose predicates decide the branch from structured facts."""
    while True:
        kids = gl.children[state["at"]]
        if not kids or not state.get("facts"):
            return
        here = gl.nodes[state["at"]]
        passthrough = (
            state["at"] in gl.predicates
            or here.get("links")
            or (state["path"] and state["path"][-1]["by"] == "entry")
            or _facts_decide_next_branch(gl, kids, state["facts"])
        )
        if len(kids) == 1 and kids[0] not in gl.predicates and passthrough:
            # A lone unconditional arrow out of a condition or referral box needs no decision.
            # Arrows out of a recommendation box lead to later events, so stop there.
            state["path"].append({"node": kids[0], "by": "single-arrow"})
            state["at"] = kids[0]
            continue
        verdicts = {c: evaluate(gl.predicates.get(c), state["facts"]) for c in kids}
        true = [c for c, v in verdicts.items() if v is True]
        if len(true) == 1 and all(v is not None for v in verdicts.values()):
            state["path"].append({"node": true[0], "by": "predicate"})
            state["at"] = true[0]
            continue
        merge = _reconvergence(gl, kids) if len(kids) > 1 and None in verdicts.values() and not true else None
        if merge:
            # Undecidable branch whose arms rejoin: skip to the join, recording the gap.
            state["path"].append({"node": merge, "by": "reconverge", "unresolved": kids})
            state["at"] = merge
            continue
        return


def render(gl, state):
    nid = state["at"]
    node = gl.nodes[nid]
    notes, hits = gl.context(nid)
    out = [f"AT {nid}: {node['text']}"]
    for r, t in notes.items():
        out.append(f"  footnote {r}: {t[:400]}")
    for h in hits:
        out.append(f"  [{h['page']}] {h['text'][:500]}")
    kids = gl.children[nid]
    if kids:
        out.append("CHOOSE ONE NEXT STEP:")
        for c in kids:
            out.append(f"  {c}: {gl.nodes[c]['text']}")
    else:
        out.append("LEAF: no further steps. Run finish.")
    return "\n".join(out)


def main(argv):
    private, cmd, session = argv[0], argv[1], argv[2]
    gl = Guideline(private)
    path = _state_path(private, session)
    if cmd == "start":
        page = argv[3]
        facts = json.loads(Path(argv[argv.index("--facts") + 1]).read_text()) if "--facts" in argv else None
        roots = gl.roots[page]
        state = {"at": None, "path": [], "facts": facts}
        if len(roots) == 1:
            state["at"] = roots[0]
            state["path"].append({"node": roots[0], "by": "entry"})
        else:
            # Several entry boxes (e.g. survival bands): treat them as the first choice.
            state["at"] = f"{page}:START"
            gl.nodes[state["at"]] = {"text": f"Entry of {page}", "page": page}
            gl.children[state["at"]] = roots
        _auto_step(gl, state)
    else:
        state = json.loads(path.read_text())
        if state["at"].endswith(":START"):
            page = state["at"].split(":")[0]
            gl.nodes[state["at"]] = {"text": f"Entry of {page}", "page": page}
            gl.children[state["at"]] = gl.roots[page]
    if cmd == "choose":
        child, reason = argv[3], argv[4] if len(argv) > 4 else ""
        if child not in gl.children[state["at"]]:
            print(f"ERROR: {child} is not a child of {state['at']}")
            return
        state["path"].append({"node": child, "by": "llm", "reason": reason})
        state["at"] = child
        _auto_step(gl, state)
    if cmd == "finish":
        print(json.dumps({"final": state["at"], "path": [p["node"] for p in state["path"]],
                          "steps_by": [p["by"] for p in state["path"]]}))
    else:
        print(render(gl, state))
    path.write_text(json.dumps(state))


if __name__ == "__main__":
    main(sys.argv[1:])
