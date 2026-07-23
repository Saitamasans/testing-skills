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
        self.assertNotIn("-Skill 'web-api-test-execution-evidence'", readme)
        self.assertIn(
            "web-api-test-execution-evidence-v1.0.2/"
            "install-web-api-test-execution-evidence.cmd",
            readme,
        )

    def test_readme_documents_package_first_execution_workflow(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("10 个 Agent Skill", readme)
        self.assertIn("人工测试用例.xlsx", readme)
        self.assertIn("test-case-execution-compiler", readme)
        self.assertIn("*.execution-package.zip", readme)
        self.assertIn("execution_contract_required", readme)
        self.assertNotIn("上传十列 Excel 测试用例并输入：`调用第八个 Skill 执行`", readme)

    def test_only_five_packages_contain_renderer(self):
        manifest = load_manifest(ROOT)["skills"]
        for item in manifest:
            renderer = ROOT / "skills" / item["slug"] / "scripts/render-test-assets.mjs"
            self.assertEqual(bool(item["case_output"]), renderer.exists(), item["slug"])

    def test_public_execution_instructions_require_no_manual_runner_install(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        source = (ROOT / "skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md").read_text(encoding="utf-8")
        combined = readme + source
        self.assertIn("GitHub Release 完整安装器", combined)
        self.assertIn("不会下载、安装或修改运行时", combined)
        self.assertIn("无需 npm 账号", combined)
        self.assertNotIn("npm install --save-dev @saitamasans/testing-runner", combined)
        self.assertNotIn("npx @saitamasans/testing-runner", combined)

    def test_readme_distinguishes_complete_release_from_source_zip(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        install_section = readme.split('<a id="install"></a>', 1)[1].split(
            '<a id="usage-guides"></a>', 1
        )[0]
        for phrase in [
            "GitHub Release 完整安装器",
            "Source ZIP",
            "仅供开发者",
            "不能执行 Web/API 自动化测试",
            "安装完成，可以执行 Web/API 自动化测试",
            "无需系统安装 Node.js、npm、Git、Chrome、Excel 或 Python",
        ]:
            self.assertIn(phrase, install_section)
        self.assertNotIn("首次运行下载", install_section)

    def test_readme_has_windows_x64_three_step_execution_delivery(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        install_section = readme.split('<a id="install"></a>', 1)[1].split(
            '<a id="usage-guides"></a>', 1
        )[0]
        for phrase in [
            "Windows x64 三步使用",
            "install-web-api-test-execution-evidence.cmd",
            "web-api-test-execution-evidence-1.0.2-windows-x64.zip",
            "SHA256SUMS.txt",
            "重启 Codex",
            "把该 ZIP 交给第八个 Skill 执行",
            "-Repair",
            r"%USERPROFILE%\.testing-skills\installations\web-api-test-execution-evidence.json",
            r"%USERPROFILE%\.testing-skills\diagnostics\web-api-test-execution-evidence",
            "正常执行阶段不会下载 Node、Runner、Playwright 或 Chromium",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, install_section)

    def test_first_seven_skill_usage_guides_are_complete(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        start_marker = '<a id="usage-guides"></a>'
        end_marker = '<a id="compiler-guide"></a>'
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

    def test_multi_api_guide_separates_starting_input_from_formal_admission(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        start_heading = "### 3. 多接口链路用例生成（`multi-api-flow-test`）"
        end_heading = "### 4. 需求澄清与用例生成skill-工作台（`requirement-test-workbench`）"
        self.assertIn(start_heading, readme)
        self.assertIn(end_heading, readme)
        multi_api_guide = readme.split(start_heading, 1)[1].split(
            end_heading,
            1,
        )[0]

        for phrase in [
            "多个接口资料、业务流程/PRD、增量变更或相关源码中的任一种",
            "测试目标和期望交付",
            "资料不足时可以启动",
            "降级输出缺口与方向",
            "生成正式链路用例还需",
            "业务对象",
            "调用顺序",
            "传递字段",
            "可观测结果",
            "测试数据准备方式",
            "可判定预期",
            "可控数据影响",
            "正式服写操作另叠加生产门禁",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, multi_api_guide)

    def test_output_files_use_skill_specific_trigger_rules(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        start_marker = '<a id="outputs"></a>'
        end_heading = "## 本地开发"
        self.assertIn(start_marker, readme)
        self.assertIn(end_heading, readme)
        outputs = readme.split(start_marker, 1)[1].split(end_heading, 1)[0]

        for phrase in [
            "单接口完整版、单接口精炼版、多接口链路和正式服验证这 4 个 Skill "
            "在用户明确请求文件时",
            "`requirement-test-workbench` 在实际产出统一十列用例时，"
            "默认生成并验证 `.xlsx` 和 `.html`",
            "只有用户明确要求“不要文件”或“只在聊天中展示”时才跳过",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, outputs)
        self.assertNotIn(
            "5 个正式用例生成 Skill 在用户明确要求文件时",
            outputs,
        )


if __name__ == "__main__":
    unittest.main()
