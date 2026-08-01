import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tooling"))
from build_skills import load_manifest, parse_frontmatter

ORIGINAL_SEVEN = {
    "single-api-test-full",
    "single-api-test-concise",
    "multi-api-flow-test",
    "requirement-test-workbench",
    "production-verification-test",
    "test-case-quality-audit",
    "requirement-clarification-test",
}


class SourceContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = load_manifest(ROOT)["skills"]
        cls.texts = {item["slug"]: (ROOT / item["source"]).read_text(encoding="utf-8") for item in cls.manifest}

    def test_exact_filenames_and_frontmatter(self):
        self.assertGreaterEqual(len(self.manifest), 1)
        self.assertEqual(10, len(self.manifest))
        for item in self.manifest:
            meta, _ = parse_frontmatter(self.texts[item["slug"]])
            self.assertEqual({"name", "description"}, set(meta))
            self.assertEqual(item["slug"], meta["name"])
        self.assertEqual(
            ORIGINAL_SEVEN | {"multi-source-test-audit"},
            {
                item["slug"]
                for item in self.manifest
                if not item.get("execution_skill") and not item.get("compiler_skill")
            },
        )

    def test_mutually_exclusive_route_and_confirmation_language(self):
        for slug, text in self.texts.items():
            self.assertIn("互斥路由", text, slug)
            self.assertIn("用户确认前", text, slug)
            self.assertNotIn("用户未确认前", text, slug)
            self.assertIn("最多一个", text, slug)

    def test_five_case_skills_have_dual_output_contract(self):
        for item in self.manifest:
            text = self.texts[item["slug"]]
            if item["case_output"]:
                for phrase in ["同一份报告 JSON", ".xlsx", ".html", "未执行 / 通过 / 不通过 / 待定", "localStorage"]:
                    self.assertIn(phrase, text, f"{item['slug']}: {phrase}")
            else:
                expected = (
                    "不生成新的正式业务用例"
                    if item.get("compiler_skill")
                    else "不生成正式测试用例"
                )
                self.assertIn(expected, text)

    def test_ability_contracts_are_preserved(self):
        contracts = json.loads((ROOT / "tooling/ability-contracts.json").read_text(encoding="utf-8"))
        for slug, required in contracts.items():
            for term in required:
                self.assertIn(term, self.texts[slug], f"{slug}: {term}")

    def test_requirement_clarification_has_false_positive_gates(self):
        text = self.texts["requirement-clarification-test"]
        required = [
            "问题生成门禁",
            "多个字段或指标各自的定义、阈值、分母或计算对象",
            "不要把不同指标之间的差异本身当成冲突",
            "按原文整体执行，不要把可由区间定义直接推出的边界拆成多个问题",
            "宁可少问但问准",
            "P0 必须满足",
        ]
        for phrase in required:
            self.assertIn(phrase, text)

    def test_requirement_clarification_is_domain_neutral_and_preserves_core_guards(self):
        text = self.texts["requirement-clarification-test"]
        forbidden_case_specific_terms = [
            "历史日期是否仍按",
            "仅支持单个",
            "去重用户数",
            "公屏欢迎语",
            "上麦",
            "房间",
            "首充",
            "流水",
        ]
        for term in forbidden_case_specific_terms:
            self.assertNotIn(term, text, term)

        core_guards = [
            "不把合理假设当作已确认规则",
            "不替产品编造金额、数量、时间、权限、状态、提示文案或业务规则",
            "只要仍有 P0 未关闭",
            "产品回答后要重新复审",
            "只有所有 P0 关闭后",
            "本 Skill 永远不生成测试用例",
            "降噪规则不得覆盖核心风险",
            "不能因为“可能复用”就跳过产品澄清",
            "共享同一业务事件、对象、归属关系或数据源",
        ]
        for guard in core_guards:
            self.assertIn(guard, text, guard)

    def test_requirement_workbench_emits_actual_results_and_independent_web_cases(self):
        text = self.texts["requirement-test-workbench"]
        columns = "用例 ID | 所属模块 | 用例标题 | 验证功能点 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 实际结果 | 执行结果"
        self.assertIn(columns, text)
        self.assertIn("实际结果默认“尚未执行”", text)
        self.assertIn("禁止依赖上一条用例的终态", text)
        self.assertIn("新建未登录浏览器会话并打开登录页", text)
        self.assertIn("建态 → 动作 → 断言", text)


if __name__ == "__main__":
    unittest.main()
