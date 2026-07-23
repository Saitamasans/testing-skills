import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "enhanced-graybox-host-share"
REPORT = FIXTURE / "expected-report.json"
EXPECTED_DIFFERENCES = {f"D{number:02d}" for number in range(1, 13)}
CASE_COLUMNS = [
    "用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件",
    "测试步骤", "预期结果", "优先级", "执行结果（通过 / 不通过 / 未执行）", "备注",
]


class GrayboxSyntheticAcceptanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(REPORT.read_text(encoding="utf-8"))
        cls.cases = next(sheet for sheet in cls.report["sheets"] if sheet["name"] == "正式测试用例")
        cls.differences = next(sheet for sheet in cls.report["sheets"] if sheet["name"] == "需求与实现差异")

    def test_all_twelve_seeded_differences_are_detected_and_transformed(self):
        implementation = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((FIXTURE / "implementation").iterdir())
            if path.is_file()
        )
        seeded = set(re.findall(r"DIFF:(D\d{2})", implementation))
        detected = {row["values"][0] for row in self.differences["rows"]}
        self.assertEqual(EXPECTED_DIFFERENCES, seeded)
        self.assertEqual(EXPECTED_DIFFERENCES, detected)
        for row in self.differences["rows"]:
            self.assertRegex(row["values"][2], r"正式用例|待产品确认|待动态验证")

    def test_report_has_eighteen_nonduplicative_manual_cases(self):
        self.assertEqual(CASE_COLUMNS, self.cases["columns"])
        self.assertEqual(18, len(self.cases["rows"]))
        titles = [row["values"][2] for row in self.cases["rows"]]
        self.assertEqual(len(titles), len(set(titles)))
        self.assertFalse(any(token in " ".join(titles).lower() for token in ["null三连", "空值三连", "未传三连"]))
        for index, row in enumerate(self.cases["rows"], start=1):
            values = row["values"]
            self.assertEqual(str(index), values[0])
            self.assertEqual("未执行", values[8])
            self.assertRegex(values[4], r"账号|房主|管理员|数据|比例|环境")
            self.assertRegex(values[5], r"1\.")
            self.assertRegex(values[6], r"1\.")
            self.assertNotRegex(values[5], r"Controller|Service|Repository|\.kt|\.swift|#\w+")

    def test_requirement_truth_and_safety_language_are_preserved(self):
        serialized = json.dumps(self.report, ensure_ascii=False)
        self.assertNotIn("已确认Bug", serialized)
        self.assertNotIn("已确认 Bug", serialized)
        self.assertNotIn("已复现", serialized)
        self.assertNotIn("UNRELATED", serialized)
        decimal_case = next(row for row in self.cases["rows"] if row["values"][0] == "5")["values"]
        self.assertIn("接口拒绝小数", decimal_case[6])

    def test_excel_and_html_render_with_shared_contract(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is required for renderer acceptance")
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [node, str(ROOT / "tooling" / "test-case-renderer.mjs"), "--input", str(REPORT), "--output-dir", directory, "--basename", "host-share"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
                env={**os.environ, "TESTING_SKILLS_FORCE_PORTABLE_XLSX": "1"},
            )
            self.assertEqual(0, result.returncode, result.stderr)
            xlsx = Path(directory) / "host-share.xlsx"
            html = Path(directory) / "host-share.html"
            self.assertTrue(xlsx.is_file())
            self.assertTrue(html.is_file())
            with zipfile.ZipFile(xlsx) as archive:
                sheet = archive.read("xl/worksheets/sheet1.xml").decode("utf-8")
                styles = archive.read("xl/styles.xml").decode("utf-8")
            self.assertIn("执行结果（通过 / 不通过 / 未执行）", sheet)
            self.assertNotIn("实际结果", sheet)
            self.assertIn('name val="SimHei"', styles)
            html_text = html.read_text(encoding="utf-8")
            self.assertIn("房主设置主持分成比例", html_text)
            self.assertIn("localStorage", html_text)


if __name__ == "__main__":
    unittest.main()
