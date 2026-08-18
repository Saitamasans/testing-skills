import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "skills/reverse-test-workbench"
MIRROR = ROOT / "plugins/reverse-test-workbench/skills/reverse-test-workbench"


def package_files(root: Path) -> dict[Path, bytes]:
    return {
        path.relative_to(root): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


class ReverseTestWorkbenchDistributionTest(unittest.TestCase):
    def test_public_skill_is_complete_and_host_neutral(self):
        for relative in (
            "SKILL.md",
            "references/host-integration-contract.md",
            "references/execution-environment.md",
            "scripts/init_run_data.py",
            "assets/run-data.schema.json",
            "requirements-artifacts.txt",
        ):
            self.assertTrue((PUBLIC / relative).is_file(), relative)

        core = "\n".join(
            path.read_text(encoding="utf-8")
            for path in PUBLIC.rglob("*")
            if path.is_file() and path.suffix in {".md", ".py", ".json", ".txt"}
        )
        for forbidden in (
            "本 Plugin",
            "Codex 工作区",
            "bundled Python",
            "workspace-python",
            "plugin_version",
            "--plugin-version",
            "执行器/Plugin",
            "C:\\\\",
            "/Users/",
            "USERPROFILE",
        ):
            self.assertNotIn(forbidden, core)

    def test_codex_adapter_is_an_exact_optional_mirror(self):
        self.assertEqual(package_files(PUBLIC), package_files(MIRROR))
        readme = (ROOT / "plugins/reverse-test-workbench/README.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("可选 Codex 适配器", readme)
        self.assertIn("核心 Skill 不依赖 Codex", readme)


if __name__ == "__main__":
    unittest.main()
