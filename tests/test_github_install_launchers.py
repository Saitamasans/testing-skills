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
RUNTIME_RELEASE_BASE = (
    "https://github.com/Saitamasans/testing-skills/releases/download/"
    "web-api-test-execution-evidence-v1.0.2/"
)
MULTI_SOURCE_RUNTIME_RELEASE_BASE = (
    "https://github.com/Saitamasans/testing-skills/releases/download/"
    "multi-source-test-audit-v0.1.4/"
)
WORKBENCH_UI_ACCEPTANCE_RELEASE_BASE = (
    "https://github.com/Saitamasans/testing-skills/releases/download/"
    "workbench-ui-acceptance-execution-v0.1.0/"
)
RAW_INSTALLER = (
    "https://raw.githubusercontent.com/Saitamasans/testing-skills/"
    "main/scripts/install.ps1"
)
NO_PUBLIC_INSTALLER_SKILLS = {
    "multi-source-test-audit",
}
HIDDEN_README_SKILLS = {
    "web-api-test-execution-evidence",
    "test-case-execution-compiler",
}


class GitHubInstallLauncherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.slugs = [item["slug"] for item in load_manifest(ROOT)["skills"]]
        cls.installers = ROOT / "installers"

    def test_exactly_one_all_and_manifest_launchers_exist(self):
        expected = {"install-all.cmd"} | {
            f"install-{slug}.cmd"
            for slug in self.slugs
            if slug not in NO_PUBLIC_INSTALLER_SKILLS
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
        self._assert_common_launcher_contract(text, immutable=True)
        self.assertIn("-All", text)
        self.assertNotIn("-Skill", text)

    def test_single_launchers_use_one_fixed_manifest_selector(self):
        for slug in self.slugs:
            with self.subTest(slug=slug):
                if slug in NO_PUBLIC_INSTALLER_SKILLS:
                    self.assertFalse((self.installers / f"install-{slug}.cmd").exists())
                    continue
                launcher = self.installers / f"install-{slug}.cmd"
                self.assertTrue(launcher.exists(), launcher)
                text = launcher.read_text(encoding="utf-8")
                self._assert_common_launcher_contract(
                    text,
                    immutable=slug == "web-api-test-execution-evidence",
                )
                self.assertIn(f'set "INSTALL_SELECTOR=-Skill {slug}"', text)
                self.assertNotIn("-All", text)
                self.assertEqual(1, text.count("-Skill"))
                self.assertNotRegex(text, r"%(?:\*|[0-9])")

    def _assert_common_launcher_contract(self, text, *, immutable=False):
        self.assertIn(r"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe", text)
        self.assertIn(r"%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe", text)
        self.assertIn('"%POWERSHELL_EXE%"', text)
        self.assertNotRegex(text, r"(?im)^\s*powershell\.exe\s")
        if immutable:
            self.assertNotIn("TESTING_SKILLS_INSTALLER_SCRIPT", text)
            self.assertNotIn(RAW_INSTALLER, text)
            self.assertIn("web-api-test-execution-evidence-v1.0.2", text)
            self.assertIn("Get-FileHash", text)
            self.assertRegex(text, r"(?i)SHA256=[a-f0-9]{64}")
        else:
            self.assertIn("TESTING_SKILLS_INSTALLER_SCRIPT", text)
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

    def test_readme_links_one_button_per_public_skill(self):
        self.assertNotIn(RUNTIME_RELEASE_BASE + "install-all.cmd", self.readme)
        self.assertNotIn("Install All 8 Skills", self.readme)
        for slug in self.slugs:
            with self.subTest(slug=slug):
                if slug in HIDDEN_README_SKILLS:
                    self.assertNotIn(slug, self.readme)
                    continue
                if slug in NO_PUBLIC_INSTALLER_SKILLS:
                    asset_url = MULTI_SOURCE_RUNTIME_RELEASE_BASE + "install-multi-source-test-audit.cmd"
                    self.assertEqual(1, self.readme.count(asset_url))
                    continue
                if slug == "workbench-ui-acceptance-execution":
                    asset_url = WORKBENCH_UI_ACCEPTANCE_RELEASE_BASE + "install-workbench-ui-acceptance-execution.cmd"
                    self.assertEqual(2, self.readme.count(asset_url))
                    continue
                asset_url = RELEASE_BASE + f"install-{slug}.cmd"
                self.assertEqual(1, self.readme.count(asset_url))
        self.assertNotIn(
            RELEASE_BASE + "install-web-api-test-execution-evidence.cmd",
            self.readme,
        )
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
        self.assertIn("启动器只读取本仓库的 HTTPS 安装脚本", self.readme)
        for slug in HIDDEN_README_SKILLS:
            self.assertNotIn(slug, self.readme)

    def test_public_fallback_runs_immutable_cmd_without_pausing_and_preserves_exit_code(self):
        fallback = self.readme.split("### 命令兜底：Windows 零 Node 安装", 1)[1].split(
            "### 高级方式：npx",
            1,
        )[0]
        self.assertIn(
            WORKBENCH_UI_ACCEPTANCE_RELEASE_BASE
            + "install-workbench-ui-acceptance-execution.cmd",
            fallback,
        )
        self.assertEqual(1, fallback.count("TESTING_SKILLS_NO_PAUSE"))
        self.assertEqual(1, fallback.count("$env:ComSpec"))
        self.assertEqual(1, fallback.count("exit $exitCode"))
        self.assertEqual(1, fallback.count("[guid]::NewGuid()"))
        self.assertIn("scripts/install.ps1", fallback)
        self.assertIn("-Skill 'requirement-test-workbench'", fallback)

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
            "第 7 个 `requirement-clarification-test` 实际生成需求澄清 `.xlsx` 文件时，"
            "需要可用的 Node.js 运行环境",
            "前 5 个用例生成 Skill 实际生成 `.xlsx` 和 `.html` 文件时，"
            "仍需要可用的 Node.js 运行环境",
            "不内置独立 runner",
            "执行时复用当前 AI 环境已有的浏览器控制能力",
            "Codex 按适配器配置获取锁定版本的官方 Playwright MCP",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, install_guide)
        for slug in HIDDEN_README_SKILLS:
            self.assertNotIn(slug, install_guide)

    def test_readme_workbench_execution_guide_contains_required_materials(self):
        start_marker = '<a id="workbench-ui-acceptance-guide"></a>'
        end_marker = '<a id="multi-source-audit-guide"></a>'
        self.assertIn(start_marker, self.readme)
        self.assertIn(end_marker, self.readme)
        execution_guide = self.readme.split(start_marker, 1)[1].split(
            end_marker,
            1,
        )[0]

        for phrase in [
            "测试工作台-用例执行专项指南",
            "什么时候使用",
            "什么时候不应使用",
            "最少准备",
            "执行与报告规则",
            "测试环境地址",
            "账号、权限和前置数据",
            "关键步骤截图",
            "workbench-ui-acceptance-execution",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, execution_guide)

    def test_readme_has_stable_navigation_anchors(self):
        anchors = [
            "skills",
            "install",
            "usage-guides",
            "workbench-ui-acceptance-guide",
            "multi-source-audit-guide",
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
            ("单接口用例生成-完整版", "single-api-test-full"),
            ("单接口用例生成-精炼版", "single-api-test-concise"),
            ("多接口链路用例生成", "multi-api-flow-test"),
            ("测试工作台-生成用例", "requirement-test-workbench"),
            ("测试工作台-用例执行", "workbench-ui-acceptance-execution"),
            ("正式服-主流程用例生成", "production-verification-test"),
            ("用例质量审计", "test-case-quality-audit"),
            ("需求澄清", "requirement-clarification-test"),
            ("多源测试-审计", "multi-source-test-audit"),
            ("无需求-UI逆向测试工作台", "reverse-test-workbench"),
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
                if slug == "reverse-test-workbench":
                    self.assertIn(
                        "npx skills add Saitamasans/testing-skills@reverse-test-workbench -g -y",
                        cells[2],
                    )
                    self.assertIn("Codex 可选适配器", cells[2])
                    continue
                if slug == "multi-source-test-audit":
                    asset_url = MULTI_SOURCE_RUNTIME_RELEASE_BASE + "install-multi-source-test-audit.cmd"
                    self.assertEqual(1, cells[2].count(asset_url))
                    self.assertRegex(
                        cells[2],
                        rf"^\[!\[Install\]\([^)]+\)\]\({re.escape(asset_url)}\)$",
                    )
                    release_urls.append(asset_url)
                    continue
                if slug == "workbench-ui-acceptance-execution":
                    asset_url = WORKBENCH_UI_ACCEPTANCE_RELEASE_BASE + "install-workbench-ui-acceptance-execution.cmd"
                    self.assertEqual(2, self.readme.count(asset_url))
                    self.assertEqual(1, cells[2].count(asset_url))
                    self.assertRegex(
                        cells[2],
                        rf"^\[!\[Install\]\([^)]+\)\]\({re.escape(asset_url)}\)$",
                    )
                    release_urls.append(asset_url)
                    continue
                asset_url = RELEASE_BASE + f"install-{slug}.cmd"
                self.assertEqual(1, self.readme.count(asset_url))
                self.assertEqual(1, cells[2].count(asset_url))
                self.assertRegex(
                    cells[2],
                    rf"^\[!\[Install\]\([^)]+\)\]\({re.escape(asset_url)}\)$",
                )
                release_urls.append(asset_url)

        self.assertEqual(len(skill_specs) - 1, len(set(release_urls)))
        self.assertNotIn(
            "| 中文名称 | Package | 类型 | 适用场景 | 安装 |",
            self.readme,
        )
        self.assertNotIn("> Production-ready testing skills", self.readme)


class GitHubInstallerReleaseWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (
            ROOT / ".github" / "workflows" / "publish-installers.yml"
        ).read_text(encoding="utf-8")

    def test_workflow_validates_public_entries_without_mutating_frozen_release(self):
        workflow = self.workflow

        for phrase in [
            "push:",
            "branches: [main]",
            "installers/*.cmd",
            "GH_TOKEN: ${{ github.token }}",
            "web-api-test-execution-evidence-v1.0.2",
            "gh release download",
            "install-all.cmd",
            "SHA256SUMS.txt",
            "workflow_run:",
            "Publish verified eighth Skill runtime",
            "github.event.workflow_run.conclusion == 'success'",
            "install-web-api-test-execution-evidence.cmd",
            'gh api "repos/$GITHUB_REPOSITORY/releases/tags/skill-installers-v1"',
            "build/frozen-installers/SHA256SUMS.txt",
            "frozen skill-installers-v1 remains unchanged",
            "runtime release is missing or not immutable; public installer entry is unchanged",
            'if [[ "$GITHUB_EVENT_NAME" == "workflow_run" ]]',
            "ref: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.sha }}",
        ]:
            self.assertIn(phrase, workflow)
        self.assertIn("! -name 'install-web-api-test-execution-evidence.cmd'", workflow)
        self.assertIn("! -name 'install-workbench-ui-acceptance-execution.cmd'", workflow)
        for forbidden in [
            "contents: write",
            "gh release upload skill-installers-v1",
            "gh release delete-asset skill-installers-v1",
            "gh release edit skill-installers-v1",
            "--clobber",
        ]:
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, workflow)

    def test_repository_docs_publish_auditable_windows_x64_runtime_entry(self):
        notes_path = ROOT / "docs" / "release" / "skill-installers-v1.md"
        self.assertTrue(notes_path.exists())
        notes = notes_path.read_text(encoding="utf-8")

        self.assertIn('"docs/release/skill-installers-v1.md"', self.workflow)
        self.assertNotIn("gh release edit skill-installers-v1", self.workflow)
        for phrase in [
            "Windows x64 三步使用",
            "install-web-api-test-execution-evidence.cmd",
            "web-api-test-execution-evidence-1.0.2-windows-x64.zip",
            "SHA256SUMS.txt",
            "调用第八个 Skill 执行",
            "-Repair",
            r"%USERPROFILE%\.testing-skills\installations\web-api-test-execution-evidence.json",
            r"%USERPROFILE%\.testing-skills\diagnostics\web-api-test-execution-evidence",
            "正常执行阶段不会下载 Node、Runner、Playwright 或 Chromium",
            "此不可变历史 Release 仅提供前七个 Skill 的独立启动器",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, notes)

    def test_checked_out_source_is_reachable_from_origin_main(self):
        workflow = self.workflow
        fetch = "git fetch --no-tags origin main"
        ancestry = 'git merge-base --is-ancestor "$source_commit" "refs/remotes/origin/main"'

        self.assertIn(fetch, workflow)
        self.assertIn('source_commit="$(git rev-parse HEAD)"', workflow)
        self.assertIn(ancestry, workflow)
        self.assertLess(workflow.index(fetch), workflow.index(ancestry))

    def test_runtime_and_frozen_installer_releases_are_verified_without_mutation(self):
        workflow = self.workflow
        metadata_query = 'gh api "repos/$GITHUB_REPOSITORY/releases/tags/$RUNTIME_TAG"'
        readiness_checks = [
            "value.tag_name !== tag",
            "value.draft !== false",
            "value.immutable !== true",
        ]
        frozen_query = 'gh api "repos/$GITHUB_REPOSITORY/releases/tags/skill-installers-v1"'

        self.assertIn(metadata_query, workflow)
        self.assertIn(
            'if git fetch --force origin "refs/tags/$RUNTIME_TAG:refs/tags/$RUNTIME_TAG"; then',
            workflow,
        )
        for phrase in readiness_checks:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, workflow)
        self.assertIn(frozen_query, workflow)
        self.assertGreater(workflow.index(frozen_query), workflow.index(metadata_query))
        self.assertIn("value.immutable !== true", workflow[workflow.index(frozen_query):])
        self.assertIn("sha256sum -c SHA256SUMS.txt", workflow)
        self.assertIn("runtime release is missing or not immutable; public installer entry is unchanged", workflow)
        self.assertIn("successful runtime workflow did not publish the required immutable release", workflow)
        self.assertNotIn("gh release delete-asset", workflow)
        self.assertNotIn("gh release upload", workflow)


if __name__ == "__main__":
    unittest.main()
