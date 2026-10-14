"""Bundler tests. Run from the repo root: python -m unittest discover -s tests -t ."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from nccn_nav import dashboard  # noqa: E402
import make_parity_fixture  # noqa: E402

SAMPLE = ROOT / "src" / "nccn_nav" / "sample"


class BundleTest(unittest.TestCase):
    def test_bundle_graph(self):
        b = dashboard.build_bundle(SAMPLE)
        self.assertEqual(list(b["pages"]), ["SAMPLE-1", "SAMPLE-2"])
        self.assertEqual(b["roots"]["SAMPLE-1"], ["SAMPLE-1:n1"])
        # a leaf that refers to SAMPLE-2 continues on its entry box
        self.assertEqual(b["children"]["SAMPLE-1:n3"], ["SAMPLE-2:n1"])
        self.assertEqual(sorted(b["docs"]), ["MS-1", "SAMPLE-A", "ST-1"])
        self.assertEqual(len(b["docs"]["SAMPLE-A"]["pages"]), 2)
        self.assertEqual(b["docs"]["SAMPLE-A"]["title"], "Principles of Scoring")

    def test_html_is_self_contained(self):
        with tempfile.TemporaryDirectory() as d:
            out, _ = dashboard.build(SAMPLE, d)
            html = out.read_text()
            self.assertIn("SAMPLE-1", html)
            self.assertNotIn("/*BUNDLE*/null", html)
            self.assertNotRegex(html, r'(src|href)="https?://')

    def test_clean_strips_pdf_glyphs(self):
        self.assertEqual(dashboard.clean("ab\x0cc\x17d"), "abcd")
        self.assertEqual(dashboard.clean("a\x17b", keep_subbullet=True), "a\x17b")

    def test_titles(self):
        self.assertEqual(dashboard.smart_title("INITIAL RISK STAGING FOR CRPC AND M1 PSA"), "Initial Risk Staging for CRPC and M1 PSA")
        self.assertEqual(dashboard.doc_title("discussion", "MS-9", "Example stage 4: score 4+4\nmore text."), "Page 9")


class ParityFixtureTest(unittest.TestCase):
    def test_fixture_matches_python(self):
        fixture = json.loads((ROOT / "web" / "test" / "parity.json").read_text())
        self.assertEqual(fixture, json.loads(json.dumps(make_parity_fixture.build(), sort_keys=True)),
                         "web/test/parity.json is stale: run python tests/make_parity_fixture.py")


class RealDataTest(unittest.TestCase):
    DATA = ROOT / "data" / "prostate"

    @unittest.skipUnless((DATA / "merged_graphs.json").exists(), "processed data not present")
    def test_real_bundle(self):
        b = dashboard.build_bundle(self.DATA)
        self.assertEqual(len(b["pages"]), 18)
        valid = {f"{p}:{n['id']}" for p, g in b["pages"].items() for n in g["nodes"]}
        self.assertTrue(set(b["children"]) <= valid)
        self.assertIn("PROS-A", b["docs"])
        self.assertTrue(all(p["title"] for p in b["pages"].values()))


if __name__ == "__main__":
    unittest.main()
