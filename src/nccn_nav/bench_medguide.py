"""Legacy entry point: forwards to mg.score (one engine for every guideline).

  python -m nccn_nav.bench_medguide private/<slug> [dev|test]
"""
import sys

from .mg import score

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    score(sys.argv[1], *(sys.argv[2:3] or ["test"]))
