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
                self.assertIn(f'set "INSTALL_SELECTOR=-Skill {slug}"', text)
                self.assertNotIn("-All", text)
                self.assertEqual(1, text.count("-Skill"))
                self.assertNotRegex(text, r"%(?:\*|[0-9])")

    def _assert_common_launcher_contract(self, text):
        self.assertIn(r"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe", text)
        self.assertIn(r"%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe", text)
        self.assertIn("TESTING_SKILLS_INSTALLER_SCRIPT", text)
        self.assertIn('"%POWERSHELL_EXE%"', text)
        self.assertNotRegex(text, r"(?im)^\s*powershell\.exe\s")
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

    def test_readme_distinguishes_node_requirements_by_workflow(self):
        start_marker = '<a id="install"></a>'
        end_marker = '<a id="usage-guides"></a>'
        self.assertIn(start_marker, self.readme)
        self.assertIn(end_marker, self.readme)
        install_guide = self.readme.split(start_marker, 1)[1].split(
            end_marker,
            1,
        )[0]

        for phrase in [
            "安装 8 个 Skill 无需安装 Node.js、npm、npx 或 Git",
            "前 5 个用例生成 Skill 实际生成 `.xlsx` 和 `.html` 文件时，"
            "需要可用的 Node.js 运行环境",
            "第 8 个 `web-api-test-execution-evidence` 的 Runner 真正执行 "
            "Web/API 用例时，需要 Node.js 20+",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, install_guide)
        self.assertNotIn("只有第 8 个", install_guide)

    def test_readme_eighth_skill_guide_contains_required_materials(self):
        start_marker = '<a id="execution-guide"></a>'
        end_marker = '<a id="outputs"></a>'
        self.assertIn(start_marker, self.readme)
        self.assertIn(end_marker, self.readme)
        execution_guide = self.readme.split(start_marker, 1)[1].split(
            end_marker,
            1,
        )[0]

        for phrase in [
            "第 8 个 Skill 专项指南",
            "什么时候使用",
            "什么时候不应使用",
            "每次执行都要准备",
            "按场景补充",
            "可选参考",
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
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, execution_guide)
        self.assertNotIn("条件强制资料", self.readme)
        self.assertNotIn("Runner 仍需要 Node.js 20+ 和 npm", self.readme)

    def test_readme_has_stable_navigation_anchors(self):
        anchors = [
            "skills",
            "install",
            "usage-guides",
            "execution-guide",
            "outputs",
        ]
        skills_marker = '<a id="skills"></a>'
        self.assertEqual(1, self.readme.count(skills_marker))
        skills_position = self.readme.index(skills_marker)
        top_navigation = self.readme[:skills_position]
        link_positions = []
        anchor_positions = []

        for anchor in anchors:
            with self.subTest(anchor=anchor):
                marker = f'<a id="{anchor}"></a>'
                link = f"](#{anchor})"
                self.assertEqual(1, self.readme.count(marker))
                self.assertEqual(1, self.readme.count(link))
                self.assertIn(link, top_navigation)
                link_positions.append(top_navigation.index(link))
                anchor_positions.append(self.readme.index(marker))

        self.assertEqual(sorted(link_positions), link_positions)
        self.assertEqual(sorted(anchor_positions), anchor_positions)

    def test_readme_uses_concise_three_column_skill_overview(self):
        start_marker = '<a id="skills"></a>'
        end_marker = '<a id="install"></a>'
        self.assertIn(start_marker, self.readme)
        self.assertIn(end_marker, self.readme)
        skill_overview = self.readme.split(start_marker, 1)[1].split(
            end_marker,
            1,
        )[0]

        header = "| Skill | 适合任务 | Windows 安装 |"
        self.assertEqual(1, skill_overview.count(header))
        lines = skill_overview.splitlines()
        header_index = lines.index(header)
        self.assertEqual("|---|---|---|", lines[header_index + 1])
        rows = []
        for line in lines[header_index + 2 :]:
            if not line.startswith("|"):
                break
            rows.append(line)

        skill_specs = [
            ("单接口完整版", "single-api-test-full"),
            ("单接口精炼版", "single-api-test-concise"),
            ("多接口链路测试", "multi-api-flow-test"),
            ("需求测试工作台", "requirement-test-workbench"),
            ("正式服验证", "production-verification-test"),
            ("用例质量审计", "test-case-quality-audit"),
            ("需求澄清", "requirement-clarification-test"),
            ("自动执行与证据回填", "web-api-test-execution-evidence"),
        ]
        self.assertEqual(len(skill_specs), len(rows))
        release_urls = []
        for row, (short_name, slug) in zip(rows, skill_specs):
            with self.subTest(slug=slug):
                cells = [cell.strip() for cell in row.strip("|").split("|")]
                self.assertEqual(3, len(cells))
                self.assertIn(short_name, cells[0])
                self.assertIn("<br>", cells[0])
                self.assertIn(f"`{slug}`", cells[0])
                self.assertIsNotNone(
                    re.fullmatch(r"[^。！？]+[。！？]", cells[1]),
                    cells[1],
                )
                asset_url = RELEASE_BASE + f"install-{slug}.cmd"
                self.assertEqual(1, self.readme.count(asset_url))
                self.assertEqual(1, cells[2].count(asset_url))
                self.assertRegex(
                    cells[2],
                    rf"^\[!\[Install\]\([^)]+\)\]\({re.escape(asset_url)}\)$",
                )
                release_urls.append(asset_url)

        self.assertEqual(len(skill_specs), len(set(release_urls)))
        self.assertNotIn(
            "| 中文名称 | Package | 类型 | 适用场景 | 安装 |",
            self.readme,
        )
        self.assertNotIn("> Production-ready testing skills", self.readme)


if __name__ == "__main__":
    unittest.main()
