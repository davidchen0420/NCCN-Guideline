"""Dashboard tests: bundle shape, JS/Python predicate parity, and parity with Guideline's graph logic.
Run from the repo root: python -m unittest discover -s tests -t . (needs node for the parity test)."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from nccn_nav import dashboard  # noqa: E402
from nccn_nav.facts import derive  # noqa: E402
from nccn_nav.predicates import evaluate  # noqa: E402

SAMPLE = ROOT / "src" / "nccn_nav" / "sample"
CASES = [{"score": 12, "age": 70}, {"score": 3}, {}, {"score": 10, "age": 64}, {"age": None},
         {"score": {"min": 8}, "age": {"min": 60, "max": 70}}, {"score": "x", "age": "unknown"}, {"stage": "late"}]


class BundleTest(unittest.TestCase):
    def test_bundle_graph(self):
        b = dashboard.build_bundle(SAMPLE)
        self.assertEqual(list(b["pages"]), ["SAMPLE-1", "SAMPLE-2"])
        self.assertEqual(b["roots"]["SAMPLE-1"], ["SAMPLE-1:n1"])
        # the leaf that refers to SAMPLE-2 continues on its entry box
        self.assertEqual(b["children"]["SAMPLE-1:n3"], ["SAMPLE-2:n1"])
        self.assertEqual(b["principles"], ["SAMPLE-A"])

    def test_html_written_and_self_contained(self):
        with tempfile.TemporaryDirectory() as d:
            out, _ = dashboard.build(SAMPLE, d)
            html = out.read_text()
            self.assertIn("SAMPLE-1", html)
            self.assertNotIn("/*BUNDLE*/", html)
            self.assertNotIn("src=\"http", html)


@unittest.skipUnless(shutil.which("node"), "node not installed")
class PredicateParityTest(unittest.TestCase):
    def test_js_matches_python(self):
        preds = json.loads((SAMPLE / "predicates.json").read_text())
        preds["compound"] = {"all": [{"fact": "score", "op": ">=", "value": 5},
                                     {"not": {"fact": "age", "op": "in", "value": [1, 2]}}]}
        preds["interval"] = {"all": [{"fact": "score", "op": ">=", "value": 10}, {"fact": "age", "op": "<", "value": 65}]}
        preds["not_in"] = {"fact": "stage", "op": "not_in", "value": ["early"]}
        preds["any"] = {"any": [{"fact": "score", "op": "==", "value": 3}, {"fact": "age", "op": "!=", "value": 70}]}
        js = ("const {evaluate}=require(process.argv[1]);const [p,c]=JSON.parse(process.argv[2]);"
              "console.log(JSON.stringify(Object.values(p).map(x=>c.map(f=>evaluate(x,f)))))")
        out = subprocess.run(["node", "-e", js, str(ROOT / "src/nccn_nav/predicates.js"), json.dumps([preds, CASES])],
                             capture_output=True, text=True, check=True).stdout
        expected = [[evaluate(p, f) for f in CASES] for p in preds.values()]
        self.assertEqual(json.loads(out), expected)

    def test_derive_matches_python(self):
        schema = json.loads((SAMPLE / "fact_schema.json").read_text())
        js = ("const {derive}=require(process.argv[1]);const [s,c]=JSON.parse(process.argv[2]);"
              "console.log(JSON.stringify(c.map(f=>derive(f,s))))")
        out = subprocess.run(["node", "-e", js, str(ROOT / "src/nccn_nav/predicates.js"), json.dumps([schema, CASES])],
                             capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(out), [derive(f, schema) for f in CASES])


class RealDataTest(unittest.TestCase):
    DATA = ROOT / "data" / "prostate"

    @unittest.skipUnless((DATA / "merged_graphs.json").exists(), "processed data not present")
    def test_real_bundle(self):
        b = dashboard.build_bundle(self.DATA)
        self.assertEqual(len(b["pages"]), 18)
        valid = {f"{p}:{n['id']}" for p, g in b["pages"].items() for n in g["nodes"]}
        self.assertTrue(set(b["children"]) <= valid)
        self.assertTrue(all(isinstance(k, str) for k in b["roots"]))


if __name__ == "__main__":
    unittest.main()
