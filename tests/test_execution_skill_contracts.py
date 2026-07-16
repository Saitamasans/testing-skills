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
            "优先使用用户提供的账号、密码、测试数据和数据库只读账号",
            "可以继续执行；如果用例来自 Saitamasans/testing-skills，效果会更好",
            "用户确认后才加载辅助 Skill",
        ]:
            self.assertIn(phrase, self.body)

    def test_runner_commands_statuses_and_report_gate(self):
        for phrase in [
            "scripts/testing-runner.mjs plan",
            "scripts/testing-runner.mjs run",
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

    def test_interactive_execution_is_visually_explained_by_default(self):
        for phrase in [
            "交互可见执行默认最大化浏览器并开启实时执行面板",
            "当前测试用例（Test Case）",
            "API-only 使用全屏执行看板",
            "正式 Web 证据 PNG 不包含执行面板",
            "--progress auto",
            "--progress off",
            "--browser headless",
        ]:
            self.assertIn(phrase, self.text)

    def test_execution_skill_uses_automatic_bootstrap_only(self):
        combined = self.text + self.generated_text + (ROOT / "README.md").read_text(encoding="utf-8")
        for phrase in [
            "scripts/testing-runner.mjs",
            "首次运行",
            "自动下载",
            "无需 npm 账号",
        ]:
            self.assertIn(phrase, combined)
        self.assertNotIn("npm install --save-dev @saitamasans/testing-runner", combined)
        self.assertNotIn("npx @saitamasans/testing-runner", combined)

        launcher = (ROOT / "skill-sources/web-api-test-execution-evidence/scripts/testing-runner.mjs").read_text(encoding="utf-8")
        self.assertIn("prepareBrowserForCommand", launcher)

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


if __name__ == "__main__":
    unittest.main()
