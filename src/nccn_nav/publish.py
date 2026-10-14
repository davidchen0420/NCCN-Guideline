"""Copy every guideline's canonical bundle into data/ for front-end use.

  python -m nccn_nav.publish private data

writes data/<slug>/guideline.json for every private/<slug>/guideline.json and data/index.json
(one row per guideline: slug, title, category, version, path, quality counts).
"""
import json
import shutil
import sys
from pathlib import Path


def publish(private, out):
    private, out = Path(private), Path(out)
    rows = []
    for src in sorted(private.glob("*/guideline.json")):
        b = json.loads(src.read_text())
        g = b["guideline"]
        dst = out / g["slug"] / "guideline.json"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        rows.append({"slug": g["slug"], "title": g["title"], "category": g["category"], "version": g["version"],
                     "version_date": g["version_date"], "pdf_sha256": g["pdf_sha256"],
                     "path": f"{g['slug']}/guideline.json", "built": b["built"], "quality": b["quality"]})
    (out / "index.json").write_text(json.dumps({"format": "nccn-guideline-index/1", "guidelines": rows}, indent=1))
    print(f"published {len(rows)} guidelines to {out}")


if __name__ == "__main__":
    publish(*sys.argv[1:3])
