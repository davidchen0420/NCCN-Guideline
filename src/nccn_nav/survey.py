"""Run the local (no-LLM) pipeline on many guidelines and report layout and extraction QA.
Numbers only, no guideline text, so the report can be shared.

  python -m nccn_nav.survey private [slug ...]   -> private/survey.json, printed table

Per guideline: page labels found, algorithm prefixes and pages, boxes and arrows, arrows
left unattached, red-flag pages, pages with boxes but no arrows (table- or list-style
pages), orphan boxes, and graph word coverage on algorithm pages (share of the page's words
found in the extracted boxes and footnotes, ignoring superscript letters; text chunks are excluded so this measures the
graph itself).
"""
import json
import sys
import traceback
from multiprocessing import Pool
from pathlib import Path

from . import pipeline
from .coverage import words
from .guideline import Spec
from .pdfvec import _text_lines


def _graph_coverage(spec, graphs):
    out = []
    for code, g in graphs.items():
        # The page's own text lines in the content band (superscript footnote letters split off).
        src = words(" ".join(l["text"] for l in _text_lines(spec.doc[spec.index_of(code)])))
        if not src:
            continue
        got = words(" ".join([n["text"] for n in g["nodes"]] + list(g.get("footnotes", {}).values())))
        out.append(sum(min(n, got[w]) for w, n in src.items()) / sum(src.values()))
    return out


def survey_one(root):
    root = Path(root)
    try:
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            graphs, flags = pipeline.run(root)
        spec = Spec(root)
        kinds = [spec.kind(i) for i in range(len(spec.doc))]
        boxes = [n for g in graphs.values() for n in g["nodes"] if n["kind"] == "box"]
        cov = _graph_coverage(spec, graphs)
        return {
            "slug": root.name, "pages": len(spec.doc), "labelled": len(spec.ids), "prefixes": spec.prefixes,
            "kinds": {k: kinds.count(k) for k in sorted(set(kinds))},
            "algorithm_pages": len(graphs), "boxes": len(boxes),
            "edges": sum(len(g["edges"]) for g in graphs.values()),
            "connectors": sum(g["n_connectors"] for g in graphs.values()),
            "unattached": sum(g["n_unattached"] for g in graphs.values()),
            "orphans": sum(n.get("role") == "orphan" for n in boxes),
            "flagged_pages": sum(bool(f) for f in flags.values()),
            "no_edge_pages": sum("no_edges" in f for f in flags.values()),
            "graph_coverage_mean": round(sum(cov) / len(cov), 3) if cov else None,
            "graph_coverage_min": round(min(cov), 3) if cov else None,
        }
    except Exception as e:  # report and keep going: one bad PDF must not stop the survey
        return {"slug": root.name, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-800:]}


def main(private, *slugs):
    private = Path(private)
    roots = [private / s for s in slugs] if slugs else sorted(p for p in private.iterdir()
                                                               if (p / "pdf" / f"{p.name}.pdf").exists())
    with Pool(4) as pool:
        rows = pool.map(survey_one, roots)
    out = private / "survey.json"
    old = {r["slug"]: r for r in json.loads(out.read_text())} if out.exists() else {}
    old.update({r["slug"]: r for r in rows})
    out.write_text(json.dumps(sorted(old.values(), key=lambda r: r["slug"]), indent=1))
    print(f"{'guideline':34} {'pages':>5} {'lab%':>4} {'alg':>4} {'boxes':>5} {'edges':>5} {'unatt':>5} "
          f"{'flag%':>5} {'noedge':>6} {'orph%':>5} {'cov':>5} {'covmin':>6}")
    for r in rows:
        if "error" in r:
            print(f"{r['slug'][:34]:34} ERROR {r['error'][:80]}")
            continue
        a = max(r["algorithm_pages"], 1)
        print(f"{r['slug'][:34]:34} {r['pages']:5} {100 * r['labelled'] / r['pages']:4.0f} {r['algorithm_pages']:4} "
              f"{r['boxes']:5} {r['edges']:5} {r['unattached']:5} {100 * r['flagged_pages'] / a:5.0f} "
              f"{r['no_edge_pages']:6} {100 * r['orphans'] / max(r['boxes'], 1):5.0f} "
              f"{r['graph_coverage_mean'] or 0:5.2f} {r['graph_coverage_min'] or 0:6.2f}")


if __name__ == "__main__":
    main(*sys.argv[1:])
