import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReportId, renderBoth, renderHtml, renderXlsx, validateReport } from "../tooling/test-case-renderer.mjs";

const fixture = JSON.parse(await fs.readFile(new URL("./fixtures/sample-report.json", import.meta.url), "utf8"));

test("validates legacy ten-column report", () => {
  assert.doesNotThrow(() => validateReport(fixture));
  const bad = structuredClone(fixture);
  bad.sheets[1].columns.pop();
  assert.throws(() => validateReport(bad), /默认 8 列/);
});

test("validates workbench eleven-column report with actual results", () => {
  const eleven = structuredClone(fixture);
  const cases = eleven.sheets.find((sheet) => sheet.kind === "test_cases");
  cases.columns.splice(8, 0, "实际结果");
  for (const row of cases.rows) row.values.splice(8, 0, row.divider ? "-" : "尚未执行");

  assert.doesNotThrow(() => validateReport(eleven));
});

test("validates the default eight-column report", () => {
  const eight = structuredClone(fixture);
  const cases = eight.sheets.find((sheet) => sheet.kind === "test_cases");
  cases.columns = ["用例 ID", "所属模块", "用例标题", "前置条件", "测试步骤", "预期结果", "优先级", "执行结果"];
  for (const row of cases.rows) {
    if (row.divider) row.values = [row.values[0], row.values[1], row.values[2], "-", "-", "-", "-", "-"];
    else row.values = [row.values[0], row.values[1], row.values[2], row.values[4], row.values[5], row.values[6], row.values[7], row.values[8]];
  }
  assert.doesNotThrow(() => validateReport(eight));
});

test("rejects formal cases when the report is not eligible", () => {
  const ineligible = structuredClone(fixture);
  ineligible.formal_case_eligible = false;
  assert.throws(() => validateReport(ineligible), /不得包含正式用例 Sheet/);
  const eligible = structuredClone(fixture);
  eligible.formal_case_eligible = true;
  assert.doesNotThrow(() => validateReport(eligible));
});

test("rejects invalid case metadata", () => {
  const badPriority = structuredClone(fixture);
  badPriority.sheets[1].rows[1].values[7] = "P3";
  assert.throws(() => validateReport(badPriority), /优先级无效/);
  const badStatus = structuredClone(fixture);
  badStatus.sheets[1].rows[1].values[8] = "完成";
  assert.throws(() => validateReport(badStatus), /执行结果无效/);
  const duplicate = structuredClone(fixture);
  duplicate.sheets[1].rows[2].values[0] = "PAY-001";
  assert.throws(() => validateReport(duplicate), /用例 ID 为空或重复/);
});

test("report id is deterministic and isolated", () => {
  assert.equal(buildReportId(fixture), buildReportId(structuredClone(fixture)));
  const regenerated = structuredClone(fixture);
  regenerated.generated_at = "2026-07-14T08:00:00Z";
  assert.equal(buildReportId(fixture), buildReportId(regenerated));
  const other = structuredClone(fixture);
  other.project = "另一个项目";
  assert.notEqual(buildReportId(fixture), buildReportId(other));
  const keyed = structuredClone(fixture);
  keyed.report_key = "release-2026-07";
  const changedTitle = structuredClone(keyed);
  changedTitle.title = "已更名的报告";
  assert.equal(buildReportId(keyed), buildReportId(changedTitle));
  changedTitle.report_key = "release-2026-08";
  assert.notEqual(buildReportId(keyed), buildReportId(changedTitle));
});

test("renders xlsx and html, with all sheet previews when supported", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-"));
  const result = await renderBoth(fixture, out, "sample");
  assert.ok((await fs.stat(result.xlsx)).size > 1000);
  const html = await fs.readFile(result.html, "utf8");
  assert.match(html, /localStorage/);
  assert.match(html, /不通过/);
  assert.match(html, /待定/);
  const previewDir = path.join(out, "sample-previews");
  try {
    const previews = await fs.readdir(previewDir);
    assert.equal(previews.length, fixture.sheets.length);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const bytes = await fs.readFile(result.xlsx);
    assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK");
  }
});

test("generated inline script is syntactically valid", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-html-"));
  const target = path.join(out, "sample.html");
  await renderHtml(fixture, target);
  const html = await fs.readFile(target, "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script[1]));
});

test("escapes untrusted report content in HTML contexts", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-html-escape-"));
  const target = path.join(out, "escaped.html");
  const hostile = structuredClone(fixture);
  hostile.title = "<img src=x onerror=alert(1)>";
  hostile.sheets[0].rows[0].values[1] = "</script><script>alert(1)</script>";
  await renderHtml(hostile, target);
  const html = await fs.readFile(target, "utf8");
  assert.doesNotMatch(html, /<title><img/);
  assert.match(html, /\\u003c\/script>/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("portable xlsx fallback has no third-party runtime dependency", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-portable-"));
  const target = path.join(out, "portable.xlsx");
  process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX = "1";
  try {
    await renderXlsx(fixture, target);
  } finally {
    delete process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX;
  }
  const bytes = await fs.readFile(target);
  assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK");
  assert.match(bytes.toString("utf8"), /dataValidations/);
  assert.match(bytes.toString("utf8"), /不通过/);
  assert.match(bytes.toString("utf8"), /待定/);
});

test("xlsx rows grow with multiline test steps instead of clipping content", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-row-height-"));
  const target = path.join(out, "multiline.xlsx");
  const multiline = structuredClone(fixture);
  multiline.sheets[1].rows[1].values[5] = "1. 第一步\n2. 第二步\n3. 第三步\n4. 第四步";
  process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX = "1";
  try {
    await renderXlsx(multiline, target);
  } finally {
    delete process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX;
  }
  const archive = (await fs.readFile(target)).toString("utf8");
  assert.match(archive, /<row r="3" ht="78" customHeight="1">/);
});
