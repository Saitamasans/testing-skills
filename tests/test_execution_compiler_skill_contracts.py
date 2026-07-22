import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tooling"))
from build_skills import load_manifest, parse_frontmatter


class ExecutionCompilerSkillContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.item = next(item for item in load_manifest(ROOT)["skills"] if item["slug"] == "test-case-execution-compiler")
        cls.source = ROOT / cls.item["source"]
        cls.text = cls.source.read_text(encoding="utf-8")
        cls.meta, cls.body = parse_frontmatter(cls.text)

    def test_frontmatter_and_scope_are_exact(self):
        self.assertEqual("test-case-execution-compiler", self.meta["name"])
        self.assertEqual(
            "Use when users want to convert existing human-readable Web UI test cases into a validated, reviewable Execution Package for later execution by web-api-test-execution-evidence; do not use to redesign test coverage, execute browsers, audit general case quality, or generate new business test cases.",
            self.meta["description"],
        )
        for phrase in ["不生成新的正式业务用例", "不修改原始用例", "不执行浏览器", "不使用 Playwright", "不猜测未知前置状态", "不根据 Excel 顺序制造依赖"]:
            self.assertIn(phrase, self.body)

    def test_single_zip_and_source_of_truth_contract(self):
        for phrase in ["人工用例是业务事实来源", "Execution Package 是可重新生成的衍生产物", "原用例变化后旧包失效", "用户最终只管理一个 ZIP", "操作系统临时目录"]:
            self.assertIn(phrase, self.body)

    def test_browser_dependencies_are_absent(self):
        package = (ROOT / "packages/testing-contract-compiler/package.json").read_text(encoding="utf-8")
        self.assertNotIn("playwright", package.casefold())
        self.assertNotIn("chromium", package.casefold())

    def test_skill_asset_is_the_runtime_contract_schema(self):
        skill_schema = json.loads((self.source.parent / "assets/execution-contract.schema.json").read_text(encoding="utf-8"))
        runtime_schema = json.loads((ROOT / "packages/testing-contract-compiler/schemas/execution-contract.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(runtime_schema, skill_schema)


if __name__ == "__main__":
    unittest.main()
