import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tooling"))
from build_skills import load_manifest, parse_frontmatter


class SourceContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = load_manifest(ROOT)["skills"]
        cls.texts = {item["slug"]: (ROOT / item["source"]).read_text(encoding="utf-8") for item in cls.manifest}

    def test_exact_filenames_and_frontmatter(self):
        self.assertEqual(7, len(self.manifest))
        for item in self.manifest:
            meta, _ = parse_frontmatter(self.texts[item["slug"]])
            self.assertEqual({"name", "description"}, set(meta))
            self.assertEqual(item["slug"], meta["name"])

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
                self.assertIn("不生成正式测试用例", text)

    def test_ability_contracts_are_preserved(self):
        contracts = json.loads((ROOT / "tooling/ability-contracts.json").read_text(encoding="utf-8"))
        for slug, required in contracts.items():
            for term in required:
                self.assertIn(term, self.texts[slug], f"{slug}: {term}")


if __name__ == "__main__":
    unittest.main()
