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

    def test_first_seven_skill_usage_guides_are_complete(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        start_marker = '<a id="usage-guides"></a>'
        end_marker = '<a id="execution-guide"></a>'
        self.assertIn(start_marker, readme)
        self.assertIn(end_marker, readme)
        usage_guides = readme.split(start_marker, 1)[1].split(end_marker, 1)[0]

        guide_specs = [
            (1, "single-api-test-full"),
            (2, "single-api-test-concise"),
            (3, "multi-api-flow-test"),
            (4, "requirement-test-workbench"),
            (5, "production-verification-test"),
            (6, "test-case-quality-audit"),
            (7, "requirement-clarification-test"),
        ]
        headings = list(re.finditer(r"(?m)^### ([1-7])\. .+$", usage_guides))
        self.assertEqual(
            [str(number) for number, _ in guide_specs],
            [match.group(1) for match in headings],
        )

        for index, (number, slug) in enumerate(guide_specs):
            section_start = headings[index].start()
            section_end = (
                headings[index + 1].start()
                if index + 1 < len(headings)
                else len(usage_guides)
            )
            section = usage_guides[section_start:section_end]
            with self.subTest(number=number, slug=slug):
                self.assertIn(f"`{slug}`", section)
                for label in [
                    "**最少准备：**",
                    "**按场景补充：**",
                    "**调用示例：**",
                ]:
                    self.assertEqual(1, section.count(label), label)
                example = section.split("**调用示例：**", 1)[1]
                self.assertIn(f"`{slug}`", example)


if __name__ == "__main__":
    unittest.main()
