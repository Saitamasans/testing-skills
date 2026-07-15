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
            "npx @saitamasans/testing-runner@1.0.0 plan",
            "npx @saitamasans/testing-runner@1.0.0 run",
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


if __name__ == "__main__":
    unittest.main()
