"""Legacy entry point for the prostate MedGUIDE benchmark. The engine and scoring now live in
mg.py (one engine for every guideline: entry chosen from the facts, derived variables applied,
gold-free option mapping, dev/test split). This wrapper only forwards to it.

  python -m nccn_nav.bench_medguide private/prostate [dev|test]
"""
import sys

from .mg import score

if __name__ == "__main__":
    score(sys.argv[1] if len(sys.argv) > 1 else "private/prostate", *(sys.argv[2:3] or ["test"]))
