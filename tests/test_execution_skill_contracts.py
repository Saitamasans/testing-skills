import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tooling"))
from build_skills import load_manifest, parse_frontmatter


class ExecutionSkillContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
      items = load_manifest(ROOT)["skills"]
      cls.item = next(item for item in items if item["slug"] == "web-api-test-execution-evidence")
      cls.source = ROOT / cls.item["source"]
      cls.text = cls.source.read_text(encoding="utf-8")
      cls.meta, cls.body = parse_frontmatter(cls.text)
      cls.generated_text = (ROOT / "skills" / cls.item["slug"] / "SKILL.md").read_text(encoding="utf-8")

    def test_trigger_boundary_and_independence(self):
        self.assertEqual("web-api-test-execution-evidence", self.meta["name"])
        description = self.meta["description"]
        self.assertTrue(description.startswith("Use when"))
        for phrase in [
            "automatically execute",
            "existing Web/API test cases",
            "evidence",
            "backfill results",
        ]:
            self.assertIn(phrase, description)
        for excluded in ["generate test cases", "clarify requirements", "audit case quality"]:
            self.assertIn(excluded, self.body)
        self.assertIn("独立第 8 个 Skill", self.body)
        self.assertIn("不生成测试用例", self.body)

    def test_execution_source_is_isolated_under_skill_sources(self):
        expected = Path("skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md")
        self.assertEqual(expected.as_posix(), self.item["source"])
        self.assertTrue((ROOT / expected).exists())
        self.assertFalse((ROOT / "Web-API测试用例自动执行与证据回填_Skill.md").exists())

    def test_preparation_safety_and_optional_seven_skill_recommendation(self):
        for phrase in [
            "准备材料清点",
            "缺失材料",
            "非标准 Excel 必须确认字段映射",
            "不要猜测正式服或测试服",
            "execution_contract_required",
            "test-case-execution-compiler",
        ]:
            self.assertIn(phrase, self.body)

    def test_execution_package_is_the_only_default_formal_input(self):
        for document in [self.text, self.generated_text]:
            for phrase in [
                "*.execution-package.zip", "package_status=READY", "semantic_compilation=skipped",
                "semantic_compiler=test-case-execution-compiler", "contract_version=1.0.0",
                "contract_incomplete", "package_validation_ms", "manifest_assembly_ms",
                "browser_id", "context_id", "context_close_status",
            ]:
                self.assertIn(phrase, document)
            self.assertIn("raw Excel", document)
            self.assertIn("deprecated", document)

    def test_black_box_inputs_are_classified_and_require_confirmation(self):
        input_reference = (
            ROOT / "skills" / self.item["slug"] / "references" / "input-and-readiness.md"
        ).read_text(encoding="utf-8")
        for document in [self.text, self.generated_text]:
            for phrase in [
                "普通十列测试用例（Test Cases）只描述测试意图，不等于机器执行清单",
                "只读页面探测",
                "用户确认后",
                "不能真实执行",
            ]:
                self.assertIn(phrase, document)

        for phrase in [
            "正式输入",
            "非正式输入",
            "标准十列测试用例（Test Cases）是人工测试意图输入",
            "缺少已确认定位器",
            "显式业务断言",
            "非标准 Excel 每次都展示字段映射预览",
        ]:
            self.assertIn(phrase, input_reference)

    def test_runner_commands_statuses_and_report_gate(self):
        for phrase in [
            'scripts\\testing-runner.ps1" plan',
            'scripts\\testing-runner.ps1" run',
            "run-result.json 是唯一判定来源",
            "Excel/HTML/JSON 一致性",
            "未执行",
            "通过",
            "不通过",
            "待定",
            "planned",
            "running",
            "completed",
            "blocked",
            "executor_error",
            "infrastructure_error",
            "manual_required",
        ]:
            self.assertIn(phrase, self.body)

    def test_complete_installation_and_execution_contract(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        for document in [self.text, self.generated_text, readme]:
            for phrase in [
                "GitHub Release 完整安装器",
                "Node 22.23.1",
                "Runner 1.1.2",
                "Playwright 1.61.1",
                "Chromium 1228",
                "headless shell 1228",
                "FFmpeg 1011",
                "无需系统安装 Node.js、npm、Git、Chrome、Excel 或 Python",
                "安装回执、回执绑定的 bundle 清单、固定组件身份和关键可执行/证据标记",
                "不会下载、安装或修改运行时",
                "installation_incomplete",
                "installation_corrupt",
                "-Repair",
                "scripts\\testing-runner.ps1",
            ]:
                self.assertIn(phrase, document)
            self.assertNotIn("scripts/testing-runner.mjs", document)
            self.assertNotIn("node <ABSOLUTE_SKILL_ROOT>", document)
            self.assertNotIn("首次运行下载", document)

        installer = (ROOT / "scripts" / "install-web-api-test-execution-evidence.ps1").read_text(
            encoding="utf-8"
        )
        for phrase in [
            "总字节=",
            "字节/秒=",
            "ETA=",
            "重试=",
            "续传偏移=",
            "SHA-256",
            "本地完整 smoke test",
            "安装完成，可以执行 Web/API 自动化测试",
        ]:
            self.assertIn(phrase, installer)
        self.assertEqual(1, installer.count("安装完成，可以执行 Web/API 自动化测试"))

    def test_runner_command_reference_uses_verified_launcher_without_downloads(self):
        source_reference = self.text.split(
            "<!-- reference: references/runner-commands.md -->", 1
        )[1].split("<!-- /reference -->", 1)[0]
        generated_reference = (
            ROOT / "skills" / self.item["slug"] / "references" / "runner-commands.md"
        ).read_text(encoding="utf-8")
        self.assertEqual(source_reference.strip(), generated_reference.strip())
        for document in [source_reference, generated_reference]:
            self.assertIn("scripts\\testing-runner.ps1", document)
            self.assertIn("installation_incomplete", document)
            self.assertIn("installation_corrupt", document)
            self.assertIn("-Repair", document)
            self.assertNotIn("testing-runner.mjs", document)
            self.assertNotIn("node <ABSOLUTE_SKILL_ROOT>", document)
            self.assertNotIn("启动或下载浏览器", document)

    def test_interactive_execution_is_visually_explained_by_default(self):
        for phrase in [
            "交互可见执行默认最大化浏览器并开启五阶段执行驾驶舱",
            "当前测试用例（Test Case）",
            "API-only 使用全屏执行看板",
            "正式 Web 证据 PNG 不包含执行面板",
            "--progress auto",
            "--progress off",
            "--browser headless",
        ]:
            self.assertIn(phrase, self.text)

    def test_complete_visible_execution_journey_is_packaged(self):
        command_reference = (
            ROOT / "skills" / self.item["slug"] / "references" / "runner-commands.md"
        ).read_text(encoding="utf-8")
        for document in [self.text, self.generated_text, command_reference]:
            for phrase in [
                "执行准备",
                "用例预告",
                "实时执行",
                "证据收集",
                "结果中心",
                "测试用例（Test Case）",
                "API 流水",
            ]:
                self.assertIn(phrase, document)

    def test_execution_skill_uses_verified_installed_runtime_only(self):
        combined = self.text + self.generated_text + (ROOT / "README.md").read_text(encoding="utf-8")
        for phrase in [
            "scripts\\testing-runner.ps1",
            "installation_incomplete",
            "installation_corrupt",
            "-Repair",
        ]:
            self.assertIn(phrase, combined)
        self.assertNotIn("npm install --save-dev @saitamasans/testing-runner", combined)
        self.assertNotIn("npx @saitamasans/testing-runner", combined)

        launcher = (ROOT / "skill-sources/web-api-test-execution-evidence/scripts/testing-runner.mjs").read_text(encoding="utf-8")
        self.assertIn("verifyInstalledRuntime", launcher)
        self.assertNotIn("prepareBrowserForCommand", launcher)

    def test_progressive_references_are_declared(self):
        for reference in [
            "references/input-and-readiness.md",
            "references/risk-credentials-and-data.md",
            "references/locators-assertions-and-rules.md",
            "references/ci-evidence-and-reporting.md",
            "references/runner-commands.md",
        ]:
            self.assertIn(reference, self.body)

    def test_generated_skill_does_not_append_generic_reference_footer(self):
        self.assertNotIn("\n按需读取 `references/", self.generated_text)

    def test_approval_examples_use_short_lived_placeholder(self):
        docs = [
            self.text,
            self.generated_text,
            (ROOT / "skills" / self.item["slug"] / "references/runner-commands.md").read_text(encoding="utf-8"),
            (ROOT / "packages/testing-runner/examples/ci/README.md").read_text(encoding="utf-8"),
        ]
        combined = "\n".join(docs)
        self.assertIn("--expires-at <ISO_EXPIRES_AT>", combined)
        self.assertIn("短期", combined)
        self.assertNotIn("2999-01-01T00:00:00.000Z", combined)

    def test_cross_state_web_cases_require_transition_discovery(self):
        required = [
            "起始状态 → 迁移动作 → 目标状态 → 终态业务断言",
            "transition_discovery_required",
            "状态迁移探测预览",
            "不回填正式 Excel/HTML",
            "重新生成 discovery/proposal hash",
            "重新经过第二次确认门禁",
            "目标状态 discovery 结果必须与正式 manifest 预览在第二次确认门禁一并确认",
        ]
        for document in [self.text, self.generated_text]:
            for phrase in required:
                self.assertIn(phrase, document)

    def test_action_conservation_and_core_path_gate_are_required(self):
        required = [
            "动作守恒矩阵",
            "mapped",
            "禁止把包含已确认迁移动作的整条用例",
            "完整可执行核心路径数",
            "不能进入 E4",
            "普通的“确认执行”不得被解释为接受核心业务目标降级",
        ]
        for document in [self.text, self.generated_text]:
            for phrase in required:
                self.assertIn(phrase, document)

    def test_partial_execution_cannot_claim_core_business_completion(self):
        required = [
            "部分执行",
            "核心流程未执行",
            "产物一致，只证明产物一致",
            "不证明核心业务目标已覆盖",
        ]
        for document in [self.text, self.generated_text]:
            for phrase in required:
                self.assertIn(phrase, document)

    def test_similar_state_transition_failures_are_prevented_before_approval(self):
        locator_reference = (
            ROOT / "skills" / self.item["slug"] / "references/locators-assertions-and-rules.md"
        ).read_text(encoding="utf-8")
        required = [
            "搜索首页 → 搜索结果页",
            "登录页 → 登录后工作台",
            "SPA 页面 → 弹窗或异步结果区域",
            "当前页 → 新标签页",
            "提交页 → 下载或确认页",
            "R2/R3",
            "Enter 不受支持时不得用点击替代",
            "第一次确认门禁前纠正",
        ]
        for document in [self.text, locator_reference]:
            for phrase in required:
                self.assertIn(phrase, document)


if __name__ == "__main__":
    unittest.main()
