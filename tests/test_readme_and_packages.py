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
        installers = [
            (ROOT / "scripts/install-all.ps1").read_text(encoding="utf-8"),
            (ROOT / "scripts/install-all.sh").read_text(encoding="utf-8"),
        ]
        for item in load_manifest(ROOT)["skills"]:
            package = ROOT / "skills" / item["slug"]
            self.assertTrue((package / "SKILL.md").exists())
            self.assertTrue((package / "agents/openai.yaml").exists())
            command = f"npx skills add Saitamasans/testing-skills@{item['slug']} -g -y"
            self.assertEqual(1, readme.count(command), command)
            for installer in installers:
                self.assertIn(item["slug"], installer)
        self.assertIn("npx skills add Saitamasans/testing-skills", readme)
        self.assertIn("CC Switch", readme)
        self.assertTrue((ROOT / "LICENSE").read_text(encoding="utf-8").startswith("MIT License"))

    def test_single_skill_commands_use_supported_selector(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        scripts = "\n".join([
            (ROOT / "scripts/install-all.ps1").read_text(encoding="utf-8"),
            (ROOT / "scripts/install-all.sh").read_text(encoding="utf-8"),
        ])
        self.assertNotIn("--path", readme + scripts)
        self.assertIn(
            "npx skills add Saitamasans/testing-skills@web-api-test-execution-evidence -g -y",
            readme,
        )
        self.assertIn("Saitamasans/testing-skills@$skill", scripts)

    def test_only_five_packages_contain_renderer(self):
        manifest = load_manifest(ROOT)["skills"]
        for item in manifest:
            renderer = ROOT / "skills" / item["slug"] / "scripts/render-test-assets.mjs"
            self.assertEqual(bool(item["case_output"]), renderer.exists(), item["slug"])


if __name__ == "__main__":
    unittest.main()
