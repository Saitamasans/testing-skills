import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tooling"))
from build_skills import load_manifest


class ReadmeAndPackagesTest(unittest.TestCase):
    def test_readme_paths_exist_and_install_commands_are_complete(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        for item in load_manifest(ROOT)["skills"]:
            package = ROOT / "skills" / item["slug"]
            self.assertTrue((package / "SKILL.md").exists())
            self.assertTrue((package / "agents/openai.yaml").exists())
            command = f"--path skills/{item['slug']}"
            self.assertEqual(1, readme.count(command), command)
        self.assertIn("npx skills add Saitamasans/testing-skills", readme)
        self.assertIn("CC Switch", readme)
        self.assertTrue((ROOT / "LICENSE").read_text(encoding="utf-8").startswith("MIT License"))

    def test_only_five_packages_contain_renderer(self):
        manifest = load_manifest(ROOT)["skills"]
        for item in manifest:
            renderer = ROOT / "skills" / item["slug"] / "scripts/render-test-assets.mjs"
            self.assertEqual(bool(item["case_output"]), renderer.exists(), item["slug"])


if __name__ == "__main__":
    unittest.main()
