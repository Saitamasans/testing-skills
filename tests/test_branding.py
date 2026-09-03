import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tooling"))

from branding import load_brand, origin_alias, origin_text
from sync_branding import expected_files, sync


class BrandingTest(unittest.TestCase):
    def test_alias_mapping_is_exact_and_stable(self):
        brand = load_brand(ROOT)
        manifest = json.loads((ROOT / "tooling/skills-manifest.json").read_text(encoding="utf-8"))
        aliases = []
        for item in manifest["skills"]:
            slug = item["slug"]
            digest = hashlib.sha256(f"{slug}:ORIGIN.txt".encode("utf-8")).digest()
            expected = brand["aliases"][int.from_bytes(digest, "big") % 4]
            self.assertEqual(expected, origin_alias(slug, ROOT))
            self.assertEqual(origin_text(slug, ROOT), (ROOT / "skills" / slug / "ORIGIN.txt").read_text(encoding="utf-8"))
            aliases.append(expected)
        self.assertGreaterEqual(len(set(aliases)), 3)

    def test_branding_is_presentation_only(self):
        changed = subprocess.run(
            ["git", "diff", "--name-only", "HEAD", "--"],
            cwd=ROOT, check=True, capture_output=True, text=True,
        ).stdout.splitlines()
        forbidden = [
            path for path in changed
            if path.endswith(("SKILL.md", "openai.yaml"))
            or "schema" in Path(path).name.lower()
            or path.startswith("runtimes/")
        ]
        self.assertEqual([], forbidden)

    def test_expected_branding_files_are_in_sync(self):
        sync(ROOT, check=True)
        self.assertEqual(18, len(expected_files(ROOT)))


if __name__ == "__main__":
    unittest.main()
