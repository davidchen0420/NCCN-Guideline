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


class CanonicalBuildTest(unittest.TestCase):
    DATA = ROOT / "data"

    @unittest.skipUnless((DATA / "prostate" / "guideline.json").exists(), "canonical data not present")
    def test_offline_build_embeds_guideline_json(self):
        with tempfile.TemporaryDirectory() as d:
            out, g = dashboard.build(self.DATA / "prostate", d)
            html = out.read_text()
            self.assertEqual(out.name, "prostate-oncocarta.html")
            self.assertIn('"format": "nccn-guideline/1"', html)
            self.assertIn("viewer_examples", html)
            self.assertNotIn("/*GUIDELINE*/null", html)

    def test_library_build_points_at_data(self):
        with tempfile.TemporaryDirectory() as d:
            out = dashboard.build_library(self.DATA, Path(d) / "built" / "oncocarta.html")
            html = out.read_text()
            self.assertIn("window.__LIBRARY__={", html)
            self.assertIn("window.__GUIDELINE__=null", html)


class AtlasBuildTest(unittest.TestCase):
    DATA = ROOT / "data"

    @unittest.skipUnless((DATA / "index.json").exists(), "canonical data not present")
    def test_every_guideline_sits_in_one_site(self):
        sites = json.loads((ROOT / "src" / "nccn_nav" / "atlas_sites.json").read_text())
        index = [g["slug"] for g in json.loads((self.DATA / "index.json").read_text())["guidelines"]]
        listed = [slug for s in sites["sites"] for slug in s["guidelines"]]
        self.assertEqual(sorted(listed), sorted(index), "atlas_sites.json and data/index.json disagree")
        self.assertEqual(len(listed), len(set(listed)))

    @unittest.skipUnless((DATA / "prostate" / "guideline.json").exists(), "canonical data not present")
    def test_atlas_pages_links_and_citations(self):
        a = dashboard.build_atlas(self.DATA)
        self.assertEqual(a["format"], "oncocarta-atlas/1")
        site_ids = {s["id"] for s in a["sites"]}
        for g in a["guidelines"]:
            self.assertIn(g["site"], site_ids, g["slug"])
            n = len(g["pages"])
            for x, y in g["links"]:
                self.assertTrue(0 <= x < n and 0 <= y < n and x != y, g["slug"])
            for pages in g["ext"].values():
                self.assertTrue(all(0 <= i < n for i in pages))
        p = next(g for g in a["guidelines"] if g["slug"] == "prostate")
        self.assertEqual(p["pages"][0]["id"], "PROS-1")
        self.assertEqual(p["pages"][0].get("e"), 1, "PROS-1 is a start page")
        self.assertIn("survivorship", p["ext"])
        self.assertIn([0, 1], p["links"], "PROS-1 leads to PROS-2")

    def _isolated_data(self, d):
        """A copy of data/ (symlinked) with no real PDFs beside it, e.g. in Guideline/."""
        data = Path(d) / "data"
        data.mkdir()
        for c in self.DATA.iterdir():
            (data / c.name).symlink_to(c)
        return data

    @unittest.skipUnless((DATA / "index.json").exists(), "canonical data not present")
    def test_local_pdfs_are_found_by_name_and_listed_by_path(self):
        with tempfile.TemporaryDirectory() as d:
            data = self._isolated_data(d)
            pdfs = Path(d) / "nccn"
            pdfs.mkdir()
            (pdfs / "prostate.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
            (pdfs / "unrelated.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
            found = dashboard.find_pdfs(data, [pdfs])
            self.assertEqual(found.get("prostate"), pdfs / "prostate.pdf")
            self.assertNotIn("unrelated", found)
            out = dashboard.build_library(data, Path(d) / "built" / "oncocarta.html", pdf_roots=[pdfs])
            self.assertIn('"prostate":"../nccn/prostate.pdf"', out.read_text())

    @unittest.skipUnless((DATA / "index.json").exists(), "canonical data not present")
    def test_guideline_packs_round_trip(self):
        import base64, gzip, re
        with tempfile.TemporaryDirectory() as d:
            out = dashboard.write_packs(self.DATA, Path(d) / "guidelines")
            body = (out / "prostate.js").read_text()
            m = re.fullmatch(r'\(window\.__OC_PACKS=window\.__OC_PACKS\|\|\{\}\)\["prostate"\]="([A-Za-z0-9+/=]+)";\n', body)
            self.assertIsNotNone(m)
            g = json.loads(gzip.decompress(base64.b64decode(m.group(1))))
            self.assertEqual(g["guideline"]["slug"], "prostate")
            self.assertTrue(g.get("viewer_examples"), "example patients travel with the guideline")
            self.assertEqual(len(list(out.glob("*.js"))), len(json.loads((self.DATA / "index.json").read_text())["guidelines"]))
            before = (out / "prostate.js").stat().st_mtime_ns
            dashboard.write_packs(self.DATA, out)
            self.assertEqual((out / "prostate.js").stat().st_mtime_ns, before, "unchanged packs are not rewritten")

    @unittest.skipUnless((DATA / "index.json").exists(), "canonical data not present")
    def test_guideline_folder_next_to_data_is_searched(self):
        with tempfile.TemporaryDirectory() as d:
            data = self._isolated_data(d)
            pdf = Path(d) / "Guideline" / "Treatment" / "prostate.pdf"
            pdf.parent.mkdir(parents=True)
            pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")
            self.assertEqual(dashboard.find_pdfs(data).get("prostate"), pdf)

    @unittest.skipUnless((DATA / "index.json").exists(), "canonical data not present")
    def test_library_page_embeds_the_atlas(self):
        with tempfile.TemporaryDirectory() as d:
            html = dashboard.build_library(self.DATA, Path(d) / "built" / "oncocarta.html").read_text()
            self.assertIn("window.__ATLAS__={", html)
            self.assertIn('"packs":"guidelines/"', html)
            self.assertTrue((Path(d) / "built" / "guidelines" / "prostate.js").exists())
            self.assertNotIn("/*ATLAS*/null", html)


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
