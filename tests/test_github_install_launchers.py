import hashlib
import json
import re
import os
import tempfile
import subprocess
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
REVERSE_TEST_WORKBENCH_RELEASE_BASE = (
    "https://github.com/Saitamasans/testing-skills/releases/download/"
    "reverse-test-workbench-v0.1.0/"
)
JS_TEST_MAPPER_RELEASE_BASES = tuple(
    "https://github.com/Saitamasans/testing-skills/releases/download/" + tag + "/"
    for tag in ("v0.1.1-rc.1", "v0.1.1-rc.2", "v0.1.1-rc.3", "v0.1.1-rc.4")
)
RAW_INSTALLER = (
    "https://raw.githubusercontent.com/Saitamasans/testing-skills/"
    "main/scripts/install.ps1"
)
NO_PUBLIC_INSTALLER_SKILLS = {
    "multi-source-test-audit",
}
SPECIALIZED_INSTALLERS = {
    "js-test-mapper": "install-js-test-mapper.cmd",
}
AUXILIARY_INSTALLERS = {"install-js-test-mapper-runtime.cmd"}
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
        expected = {"install-all.cmd"} | AUXILIARY_INSTALLERS | {
            SPECIALIZED_INSTALLERS.get(slug, f"install-{slug}.cmd")
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
                if slug in SPECIALIZED_INSTALLERS:
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

    def test_js_test_mapper_uses_standard_skill_plus_internal_runtime(self):
        launcher = self.installers / SPECIALIZED_INSTALLERS["js-test-mapper"]
        self.assertTrue(launcher.exists(), launcher)
        text = launcher.read_text(encoding="utf-8")
        self.assertIn("skills@1.5.23", text)
        self.assertIn("Saitamasans/testing-skills@v0.1.1-rc.5", text)
        self.assertIn("--skill js-test-mapper", text)
        self.assertIn("runtime-bootstrap.mjs", text)
        self.assertIn("TESTING_SKILLS_NO_PAUSE", text)
        for forbidden in ("powershell", "pwsh", "ExecutionPolicy", "Invoke-WebRequest", "DownloadFile", "Net.WebClient", "curl", "certutil", "bitsadmin", "EncodedCommand"):
            self.assertNotIn(forbidden.lower(), text.lower())
        self.assertFalse((self.installers / "install-js-test-mapper.ps1").exists())

    def test_js_test_mapper_installer_hides_success_logs_and_keeps_failure_logs(self):
        text = (self.installers / SPECIALIZED_INSTALLERS["js-test-mapper"]).read_text(encoding="utf-8")
        self.assertIn('>"%CLI_LOG%" 2>&1', text)
        self.assertIn('type "%CLI_LOG%"', text)
        self.assertIn('del /q "%CLI_LOG%"', text)
        self.assertIn('>"%RUNTIME_LOG%" 2>&1', text)
        self.assertIn('type "%RUNTIME_LOG%"', text)
        self.assertIn('del /q "%RUNTIME_LOG%"', text)
        self.assertIn('set "CLI_EXIT_CODE=%ERRORLEVEL%"', text)
        self.assertIn('set "RUNTIME_EXIT_CODE=%ERRORLEVEL%"', text)
        self.assertIn("[ERROR] Standard Skill installation failed.", text)
        self.assertIn("[ERROR] JS analysis Runtime preparation failed.", text)
        self.assertNotIn("SKILLS ASCII Logo", text)
        self.assertNotIn("Security Risk Assessments", text)
        self.assertNotIn("Installation Summary", text)

    def test_js_test_mapper_cmd_has_cross_platform_static_byte_contract(self):
        launcher = self.installers / SPECIALIZED_INSTALLERS["js-test-mapper"]
        raw = launcher.read_bytes()
        self.assertEqual(raw, raw.decode("ascii").encode("ascii"))
        self.assertGreater(raw.count(b"\r\n"), 0)
        self.assertNotIn(b"\xef\xbb\xbf", raw)
        self.assertNotRegex(raw, rb"[^\x09\x0a\x0d\x20-\x7e]")
        self.assertNotIn(b"\r\n\n", raw)
        self.assertEqual(0, raw.count(b"\n") - raw.count(b"\r\n"))
        self.assertEqual(0, raw.count(b"\x00"))
        text = raw.decode("ascii")
        self.assertIn("Saitamasans/testing-skills@v0.1.1-rc.5", text)
        self.assertIn("[OK] Installation successful.", text)
        self.assertIn("Please fully restart CC Switch / Codex before use.", text)

    @unittest.skipUnless(os.name == "nt", "requires Windows cmd.exe")
    def test_js_test_mapper_cmd_executes_with_windows_cmd(self):
        launcher = self.installers / SPECIALIZED_INSTALLERS["js-test-mapper"]
        with tempfile.TemporaryDirectory(prefix="js-test-mapper-cmd-") as temp:
            root = Path(temp)
            mock_npx = root / "npx.cmd"
            mock_npx.write_text(
                "@echo off\n"
                "set \"P=%USERPROFILE%\\.agents\\skills\\js-test-mapper\"\n"
                "mkdir \"%P%\" >nul 2>nul\n"
                "mkdir \"%P%\\agents\" >nul 2>nul\n"
                "mkdir \"%P%\\scripts\" >nul 2>nul\n"
                ">\"%P%\\SKILL.md\" echo fixture\n"
                ">\"%P%\\agents\\openai.yaml\" echo fixture\n"
                ">\"%P%\\scripts\\runtime-bootstrap.mjs\" echo process.exit(0);\n"
                "exit /b 0\n",
                encoding="ascii",
                newline="\r\n",
            )
            env = os.environ.copy()
            env["TESTING_SKILLS_NO_PAUSE"] = "1"
            env["USERPROFILE"] = str(root / "profile")
            env["PATH"] = str(root) + os.pathsep + env.get("PATH", "")
            result = subprocess.run(
                [os.environ.get("ComSpec", "cmd.exe"), "/d", "/c", str(launcher)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                timeout=30,
            )
        self.assertEqual(0, result.returncode)
        self.assertIn("[OK] Installation successful.", result.stdout)
        self.assertIn("Please fully restart CC Switch / Codex before use.", result.stdout)
        self.assertNotIn("not recognized as an internal or external command", (result.stdout or "") + (result.stderr or ""))

    def test_js_test_mapper_success_summary_is_bilingual_and_near_bottom(self):
        text = (self.installers / SPECIALIZED_INSTALLERS["js-test-mapper"]).read_text(encoding="utf-8")
        summary = text.index("[OK] Installation successful.")
        self.assertIn("Saitama AI Testing", text)
        self.assertIn("Web JS Reverse Test Mapper", text)
        self.assertIn("[OK] Installation successful.", text[summary:])
        self.assertIn("========================================================", text[summary:])
        self.assertIn("Saitama AI Testing", text)
        self.assertIn("[1/3] Installing standard Skill", text)
        self.assertIn("[2/3] Preparing JS analysis Runtime", text)
        self.assertIn("[3/3] Verifying installation", text)
        self.assertLess(summary, text.index(":node_error"))
        self.assertNotRegex(text, r"[^\x00-\x7f]")

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
        cls.install_doc = (ROOT / "docs/installation.md").read_text(encoding="utf-8")
        cls.guide_doc = (ROOT / "docs/skill-guides.md").read_text(encoding="utf-8")
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
                if slug == "reverse-test-workbench":
                    asset_url = (
                        REVERSE_TEST_WORKBENCH_RELEASE_BASE
                        + "install-reverse-test-workbench.cmd"
                    )
                    self.assertEqual(1, self.readme.count(asset_url))
                    continue
                if slug == "workbench-ui-acceptance-execution":
                    asset_url = WORKBENCH_UI_ACCEPTANCE_RELEASE_BASE + "install-workbench-ui-acceptance-execution.cmd"
                    self.assertEqual(1, self.readme.count(asset_url))
                    continue
                if slug == "js-test-mapper":
                    candidates = [base + "install-js-test-mapper.cmd" for base in JS_TEST_MAPPER_RELEASE_BASES]
                    self.assertEqual(1, sum(self.readme.count(url) for url in candidates))
                    asset_url = next(url for url in candidates if url in self.readme)
                    self.assertEqual(1, self.readme.count(asset_url))
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
            self.assertIn(phrase, self.install_doc)
        self.assertIn("scripts/install.ps1", self.install_doc)
        self.assertIn("-All", self.install_doc)
        self.assertIn("-Skill 'requirement-test-workbench'", self.install_doc)
        self.assertIn("启动器只读取本仓库的 HTTPS 安装脚本", self.install_doc)
        for slug in HIDDEN_README_SKILLS:
            self.assertNotIn(slug, self.readme)

    def test_public_fallback_runs_immutable_cmd_without_pausing_and_preserves_exit_code(self):
        fallback = self.install_doc.split("## 命令兜底：Windows 零 Node 安装", 1)[1].split(
            "## 高级方式：npx",
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
        install_guide = self.install_doc

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
        self.assertIn(start_marker, self.guide_doc)
        self.assertIn(end_marker, self.guide_doc)
        execution_guide = self.guide_doc.split(start_marker, 1)[1].split(
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
        skills_marker = '<a id="skills"></a>'
        self.assertEqual(1, self.readme.count(skills_marker))
        for target in [
            "docs/installation.md",
            "docs/skill-guides.md",
            "docs/development.md",
        ]:
            with self.subTest(target=target):
                self.assertIn(f"]({target})", self.readme)

    def test_readme_uses_concise_three_column_skill_overview(self):
        start_marker = '<a id="skills"></a>'
        end_marker = '## 快速使用'
        self.assertIn(start_marker, self.readme)
        self.assertIn(end_marker, self.readme)
        skill_overview = self.readme.split(start_marker, 1)[1].split(
            end_marker,
            1,
        )[0]

        header = "| Skill | 适合任务 | 安装 |"
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
            ("无需求-Web JS逆向测试建图", "js-test-mapper"),
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
                    asset_url = (
                        REVERSE_TEST_WORKBENCH_RELEASE_BASE
                        + "install-reverse-test-workbench.cmd"
                    )
                    self.assertEqual(1, cells[2].count(asset_url))
                    self.assertRegex(
                        cells[2],
                        rf"^\[!\[Install\]\([^)]+\)\]\({re.escape(asset_url)}\)$",
                    )
                    release_urls.append(asset_url)
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
                    self.assertEqual(1, self.readme.count(asset_url))
                    self.assertEqual(1, cells[2].count(asset_url))
                    self.assertRegex(
                        cells[2],
                        rf"^\[!\[Install\]\([^)]+\)\]\({re.escape(asset_url)}\)$",
                    )
                    release_urls.append(asset_url)
                    continue
                if slug == "js-test-mapper":
                    candidates = [base + "install-js-test-mapper.cmd" for base in JS_TEST_MAPPER_RELEASE_BASES]
                    self.assertEqual(1, sum(self.readme.count(url) for url in candidates))
                    asset_url = next(url for url in candidates if url in self.readme)
                    self.assertEqual(1, self.readme.count(asset_url))
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

        self.assertEqual(len(skill_specs), len(set(release_urls)))
        self.assertNotIn("npx skills add", skill_overview)
        self.assertNotIn("codex plugin", skill_overview)
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
        self.assertIn("! -name 'install-reverse-test-workbench.cmd'", workflow)
        self.assertIn("! -name 'install-js-test-mapper.cmd'", workflow)
        self.assertIn("! -name 'install-js-test-mapper-runtime.cmd'", workflow)
        self.assertIn('test "${#ordinary[@]}" -eq 7', workflow)
        self.assertIn('test "${#frozen_ordinary_names[@]}" -eq 7', workflow)
        self.assertIn("mapfile -t ordinary_names", workflow)
        self.assertIn("mapfile -t frozen_ordinary_names", workflow)
        self.assertIn(
            'diff -u <(printf \'%s\\n\' "${ordinary_names[@]}") '
            '<(printf \'%s\\n\' "${frozen_ordinary_names[@]}")',
            workflow,
        )
        self.assertNotIn(
            'cmp "$launcher" "build/frozen-installers/$(basename "$launcher")"',
            workflow,
        )
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
