import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tooling"))
from build_skills import BANNER, EXECUTION_BANNER, build_all, load_manifest, parse_frontmatter

ORIGINAL_SEVEN = {
    "single-api-test-full": "\u5355\u63a5\u53e3\u7528\u4f8b\u751f\u6210\u4e0e\u5bf9\u9f50_\u5b8c\u6574\u7248Skill_v0.3.md",
    "single-api-test-concise": "\u7cbe\u70bc\u7248_\u5355\u63a5\u53e3\u7528\u4f8b\u4e0e\u5bf9\u9f50skill_v0.3.md",
    "multi-api-flow-test": "\u591a\u63a5\u53e3\u94fe\u8def\u6d4b\u8bd5\u7528\u4f8b\u751f\u6210skill_v0.6_\u7cbe\u70bc\u6267\u884c\u7248.md",
    "requirement-test-workbench": "\u6839\u636e\u9700\u6c42-\u7528\u4f8b\u751f\u6210_skill.md",
    "production-verification-test": "\u6b63\u5f0f\u670d\u9a8c\u8bc1-\u7528\u4f8b\u751f\u6210 Skill.md",
    "test-case-quality-audit": "\u6d4b\u8bd5\u7528\u4f8b-\u5ba1\u8ba1\u4e0e\u8bc4_Skill_V1.md",
    "requirement-clarification-test": "\u6d4b\u8bd5\u89c6\u89d2-\u9700\u6c42\u6f84\u6e05 Skill.md",
}


class BuildSkillsTest(unittest.TestCase):
    def test_manifest_has_exactly_eight_unique_skills_with_original_seven_sources(self):
        items = load_manifest(ROOT)["skills"]
        self.assertEqual(8, len(items))
        self.assertEqual(8, len({item["slug"] for item in items}))
        self.assertEqual(5, sum(bool(item["case_output"]) for item in items))
        self.assertEqual(1, sum(bool(item.get("execution_skill")) for item in items))
        by_slug = {item["slug"]: item for item in items}
        for slug, source in ORIGINAL_SEVEN.items():
            self.assertEqual(source, by_slug[slug]["source"])
            self.assertFalse(by_slug[slug].get("execution_skill", False))
        self.assertFalse(by_slug["web-api-test-execution-evidence"]["case_output"])
        self.assertTrue(by_slug["web-api-test-execution-evidence"]["execution_skill"])

    def test_generated_packages_match_sources(self):
        outputs = build_all(ROOT)
        self.assertGreaterEqual(len(outputs), 14)
        for item in load_manifest(ROOT)["skills"]:
            generated = ROOT / "skills" / item["slug"] / "SKILL.md"
            source_meta, source_body = parse_frontmatter((ROOT / item["source"]).read_text(encoding="utf-8"))
            generated_meta, generated_body = parse_frontmatter(generated.read_text(encoding="utf-8"))
            self.assertEqual(source_meta, generated_meta)
            expected_banner = EXECUTION_BANNER if item["slug"] == "web-api-test-execution-evidence" else BANNER
            self.assertIn(expected_banner, generated_body)
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
            elif item["slug"] == "web-api-test-execution-evidence":
                references = [
                    generated.parent / "references/input-and-readiness.md",
                    generated.parent / "references/risk-credentials-and-data.md",
                    generated.parent / "references/locators-assertions-and-rules.md",
                    generated.parent / "references/ci-evidence-and-reporting.md",
                    generated.parent / "references/runner-commands.md",
                ]
                self.assertTrue(all(reference.exists() for reference in references))
                combined = generated_body + "".join(reference.read_text(encoding="utf-8") for reference in references)
                for phrase in ["run-result.json 是唯一判定来源", "非标准 Excel 必须确认字段映射", "npx @saitamasans/testing-runner@1.0.0 run"]:
                    self.assertIn(phrase, combined)
                self.assertLessEqual(len(generated.read_text(encoding="utf-8").splitlines()), 500)
            else:
                self.assertIn(source_body.strip(), generated_body)
            self.assertTrue((generated.parent / "agents/openai.yaml").exists())

    def test_check_mode_detects_no_drift(self):
        build_all(ROOT)
        build_all(ROOT, check=True)

    def test_execution_skill_bundles_launcher_resources(self):
        build_all(ROOT)
        source_root = ROOT / "skill-sources/web-api-test-execution-evidence"
        package_root = ROOT / "skills/web-api-test-execution-evidence"
        for relative in [
            "scripts/testing-runner.mjs",
            "scripts/runner-bootstrap-lib.mjs",
        ]:
            self.assertEqual(
                (source_root / relative).read_bytes(),
                (package_root / relative).read_bytes(),
                relative,
            )


if __name__ == "__main__":
    unittest.main()
