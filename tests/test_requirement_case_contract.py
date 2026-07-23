import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tooling"))
from build_skills import build_all


CONTRACT = ROOT / "skill-sources" / "shared" / "requirement-test-case-output-contract.md"
WORKBENCH_SOURCE = ROOT / "根据需求-用例生成_skill.md"
GRAYBOX_SOURCE = ROOT / "增强版-灰盒测试用例生成_Skill.md"
CLARIFICATION_SOURCE = ROOT / "测试视角-需求澄清 Skill.md"
CASE_COLUMNS = [
    "用例 ID",
    "所属模块",
    "用例标题",
    "验证功能点",
    "前置条件",
    "测试步骤",
    "预期结果",
    "优先级",
    "执行结果（通过 / 不通过 / 未执行）",
    "备注",
]


class RequirementCaseContractTest(unittest.TestCase):
    def test_shared_contract_is_the_single_source_of_truth(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        for column in CASE_COLUMNS:
            self.assertIn(column, contract)
        for source in (WORKBENCH_SOURCE, GRAYBOX_SOURCE):
            text = source.read_text(encoding="utf-8")
            self.assertEqual(1, text.count("<!-- include:requirement-test-case-output-contract -->"))
            self.assertNotIn("| 实际结果 |", text)

    def test_builder_compiles_contract_into_both_self_contained_packages(self):
        build_all(ROOT)
        contract = CONTRACT.read_text(encoding="utf-8").strip()
        for slug in ("requirement-test-workbench", "enhanced-graybox-test-case-generation"):
            generated = (ROOT / "skills" / slug / "SKILL.md").read_text(encoding="utf-8")
            self.assertIn(contract, generated)
            self.assertNotIn("<!-- include:requirement-test-case-output-contract -->", generated)
            self.assertNotIn("| 实际结果 |", generated)

    def test_clarification_skill_has_no_formal_case_columns_and_routes_after_p0(self):
        text = CLARIFICATION_SOURCE.read_text(encoding="utf-8")
        self.assertNotIn("正式用例表仅输出", text)
        self.assertNotIn("实际结果", text)
        self.assertIn("P0 关闭后", text)
        self.assertIn("requirement-test-workbench", text)
        self.assertIn("适用的正式用例生成 Skill", text)

    def test_graybox_defaults_to_manual_cases_not_code_audit(self):
        text = GRAYBOX_SOURCE.read_text(encoding="utf-8")
        required = [
            "供测试人员手工执行",
            "正式测试用例是第一核心交付物",
            "代码分析不是独立交付目标",
            "读到足以提高测试用例准确度即可",
            "完整代码证据",
            "不输出深度代码审计报告",
        ]
        for phrase in required:
            self.assertIn(phrase, text)
        section = text.split("## 输出分层与文件交付", 1)[1].split("## 典型调用", 1)[0]
        order = [
            "输入质量与准入结论",
            "当前需求基线摘要",
            "高价值需求与实现差异摘要",
            "正式测试用例 Excel",
            "聊天中的核心用例说明",
            "回归范围",
            "待确认问题",
            "待动态验证线索",
            "未覆盖风险",
        ]
        positions = [section.index(item) for item in order]
        self.assertEqual(positions, sorted(positions))

    def test_graybox_declares_all_ten_code_analysis_stop_conditions(self):
        text = GRAYBOX_SOURCE.read_text(encoding="utf-8")
        start = text.index("## 代码分析停止条件")
        stop = text.index("## ", start + 3)
        section = text[start:stop]
        for phrase in [
            "主要用户入口",
            "实际接口和主要参数",
            "关键权限和数据归属校验",
            "核心状态变化",
            "主要数据保存位置",
            "缓存或异步链路",
            "前后端和多端差异",
            "受影响旧功能和回归范围",
            "需要动态验证的风险",
            "可执行测试步骤和预期",
        ]:
            self.assertIn(phrase, section)

    def test_graybox_assets_use_the_shared_columns(self):
        template = json.loads(
            (ROOT / "skill-sources" / "enhanced-graybox-test-case-generation" / "assets" / "graybox-report-template.json").read_text(encoding="utf-8")
        )
        self.assertEqual(CASE_COLUMNS, template["sheets"][0]["columns"])


if __name__ == "__main__":
    unittest.main()
