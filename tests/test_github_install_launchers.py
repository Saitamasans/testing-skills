import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tooling"))
from build_skills import load_manifest


RELEASE_BASE = (
    "https://github.com/Saitamasans/testing-skills/releases/download/"
    "skill-installers-v1/"
)
RAW_INSTALLER = (
    "https://raw.githubusercontent.com/Saitamasans/testing-skills/"
    "main/scripts/install.ps1"
)


class GitHubInstallLauncherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.slugs = [item["slug"] for item in load_manifest(ROOT)["skills"]]
        cls.installers = ROOT / "installers"

    def test_exactly_one_all_and_eight_manifest_launchers_exist(self):
        expected = {"install-all.cmd"} | {
            f"install-{slug}.cmd" for slug in self.slugs
        }
        actual = (
            {path.name for path in self.installers.glob("*.cmd")}
            if self.installers.exists()
            else set()
        )
        self.assertEqual(expected, actual)

    def test_all_launcher_uses_fixed_all_selector_and_propagates_failures(self):
        launcher = self.installers / "install-all.cmd"
        self.assertTrue(launcher.exists(), launcher)
        text = launcher.read_text(encoding="utf-8")
        self._assert_common_launcher_contract(text)
        self.assertIn("-All", text)
        self.assertNotIn("-Skill", text)

    def test_single_launchers_use_one_fixed_manifest_selector(self):
        for slug in self.slugs:
            with self.subTest(slug=slug):
                launcher = self.installers / f"install-{slug}.cmd"
                self.assertTrue(launcher.exists(), launcher)
                text = launcher.read_text(encoding="utf-8")
                self._assert_common_launcher_contract(text)
                self.assertIn(f"-Skill '{slug}'", text)
                self.assertNotIn("-All", text)
                self.assertEqual(1, text.count("-Skill"))
                self.assertNotRegex(text, r"%(?:\*|[0-9])")

    def _assert_common_launcher_contract(self, text):
        self.assertEqual(1, len(re.findall(r"(?i)\bpowershell\.exe\b", text)))
        self.assertIn(RAW_INSTALLER, text)
        self.assertIn("scripts/install.ps1", text)
        self.assertIn("TESTING_SKILLS_NO_PAUSE", text)
        self.assertIn('set "INSTALL_EXIT_CODE=%ERRORLEVEL%"', text)
        self.assertIn("exit /b %INSTALL_EXIT_CODE%", text)
        self.assertRegex(text, r"(?m)^exit /b 0\s*$")
        self.assertNotRegex(
            text,
            r"(?im)^\s*(?:call\s+)?(?:node|npm|npx|git)(?:\.exe)?(?:\s|$)",
        )


class GitHubInstallReadmeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.readme = (ROOT / "README.md").read_text(encoding="utf-8")
        cls.slugs = [item["slug"] for item in load_manifest(ROOT)["skills"]]

    def test_readme_links_one_all_button_and_one_button_per_skill(self):
        all_url = RELEASE_BASE + "install-all.cmd"
        self.assertEqual(1, self.readme.count(all_url))
        self.assertIn("Install All 8 Skills", self.readme)
        for slug in self.slugs:
            with self.subTest(slug=slug):
                asset_url = RELEASE_BASE + f"install-{slug}.cmd"
                self.assertEqual(1, self.readme.count(asset_url))
        self.assertNotIn("/releases/latest/", self.readme)

    def test_readme_keeps_command_fallback_and_explains_download_boundary(self):
        for phrase in [
            "命令兜底",
            "GitHub 不能静默执行",
            "双击",
            "Windows 安全确认",
            "纯文本",
            ".agents\\skills",
            "无需管理员权限",
            "SmartScreen",
            "Release 资产发布后",
        ]:
            self.assertIn(phrase, self.readme)
        self.assertIn("scripts/install.ps1", self.readme)
        self.assertIn("-All", self.readme)
        self.assertIn("-Skill 'requirement-test-workbench'", self.readme)

    def test_readme_classifies_eighth_skill_new_user_materials(self):
        for phrase in [
            "第 8 个 Skill 使用前要准备什么",
            "强制资料",
            "条件强制资料",
            "辅助资料",
            "正式测试用例",
            "目标 Web/API 地址",
            "环境性质和执行授权",
            "测试账号或凭据来源",
            "接口文档",
            "测试数据和清理方案",
            "前后端源码",
            "执行前确认",
            "Node.js 20+",
            "需求文档、需求截图、原型和流程图不能代替正式测试用例",
            "requirement-test-workbench",
        ]:
            self.assertIn(phrase, self.readme)
        self.assertNotIn("Runner 仍需要 Node.js 20+ 和 npm", self.readme)


if __name__ == "__main__":
    unittest.main()
