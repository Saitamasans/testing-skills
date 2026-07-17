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
            (ROOT / "scripts/install.ps1").read_text(encoding="utf-8"),
            (ROOT / "scripts/install-all.ps1").read_text(encoding="utf-8"),
            (ROOT / "scripts/install-all.sh").read_text(encoding="utf-8"),
        ]
        for item in load_manifest(ROOT)["skills"]:
            package = ROOT / "skills" / item["slug"]
            self.assertTrue((package / "SKILL.md").exists())
            self.assertTrue((package / "agents/openai.yaml").exists())
            self.assertIn(item["slug"], readme)
            self.assertIn(item["slug"], installers[2])
        self.assertIn('Join-Path $PSScriptRoot "install.ps1"', installers[1])
        self.assertIn("-All", installers[1])
        self.assertNotIn("npx", installers[0] + installers[1])
        self.assertIn("scripts/install.ps1", readme)
        self.assertIn("-All", readme)
        self.assertIn("-Skill 'requirement-test-workbench'", readme)
        self.assertIn("npx skills add Saitamasans/testing-skills", readme)
        self.assertIn("CC Switch", readme)
        self.assertTrue((ROOT / "LICENSE").read_text(encoding="utf-8").startswith("MIT License"))

    def test_single_skill_commands_use_supported_selector(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertNotIn("--path", readme)
        self.assertIn(
            "npx skills add Saitamasans/testing-skills@web-api-test-execution-evidence -g -y",
            readme,
        )
        self.assertIn("-Skill 'web-api-test-execution-evidence'", readme)

    def test_only_five_packages_contain_renderer(self):
        manifest = load_manifest(ROOT)["skills"]
        for item in manifest:
            renderer = ROOT / "skills" / item["slug"] / "scripts/render-test-assets.mjs"
            self.assertEqual(bool(item["case_output"]), renderer.exists(), item["slug"])

    def test_public_execution_instructions_require_no_manual_runner_install(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        source = (ROOT / "skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md").read_text(encoding="utf-8")
        combined = readme + source
        self.assertIn("自动下载", combined)
        self.assertIn("无需 npm 账号", combined)
        self.assertNotIn("npm install --save-dev @saitamasans/testing-runner", combined)
        self.assertNotIn("npx @saitamasans/testing-runner", combined)


if __name__ == "__main__":
    unittest.main()
