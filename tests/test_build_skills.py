import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tooling"))
from build_skills import BANNER, build_all, load_manifest, parse_frontmatter


class BuildSkillsTest(unittest.TestCase):
    def test_manifest_has_exactly_seven_unique_skills(self):
        items = load_manifest(ROOT)["skills"]
        self.assertEqual(7, len(items))
        self.assertEqual(7, len({item["slug"] for item in items}))
        self.assertEqual(5, sum(bool(item["case_output"]) for item in items))

    def test_generated_packages_match_sources(self):
        outputs = build_all(ROOT)
        self.assertGreaterEqual(len(outputs), 14)
        for item in load_manifest(ROOT)["skills"]:
            generated = ROOT / "skills" / item["slug"] / "SKILL.md"
            source_meta, source_body = parse_frontmatter((ROOT / item["source"]).read_text(encoding="utf-8"))
            generated_meta, generated_body = parse_frontmatter(generated.read_text(encoding="utf-8"))
            self.assertEqual(source_meta, generated_meta)
            self.assertIn(BANNER, generated_body)
            if item["slug"] == "single-api-test-full":
                references = [
                    generated.parent / "references/file-output-and-case-writing.md",
                    generated.parent / "references/test-design-and-dedup.md",
                ]
                self.assertTrue(all(reference.exists() for reference in references))
                combined = generated_body + "".join(reference.read_text(encoding="utf-8") for reference in references)
                for phrase in ["表格文件完整版规范", "各 Sheet 固定字段", "测试用例编写规则", "最终输出要求"]:
                    self.assertIn(phrase, combined)
                self.assertLessEqual(len(generated.read_text(encoding="utf-8").splitlines()), 600)
            else:
                self.assertIn(source_body.strip(), generated_body)
            self.assertTrue((generated.parent / "agents/openai.yaml").exists())

    def test_check_mode_detects_no_drift(self):
        build_all(ROOT)
        build_all(ROOT, check=True)


if __name__ == "__main__":
    unittest.main()
