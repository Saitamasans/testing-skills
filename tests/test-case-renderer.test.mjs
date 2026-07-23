import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReportId, COLUMNS, REQUIREMENT_COLUMNS, normalizeRequirementReport, renderBoth, renderHtml, renderXlsx, validateReport } from "../tooling/test-case-renderer.mjs";

const fixture = JSON.parse(await fs.readFile(new URL("./fixtures/sample-report.json", import.meta.url), "utf8"));

test("validates exact ten-column report", () => {
  assert.doesNotThrow(() => validateReport(fixture));
  const bad = structuredClone(fixture);
  bad.sheets[1].columns.pop();
  assert.throws(() => validateReport(bad), /用例列合同/);
});

test("normalizes legacy eight-column workbench input to the requirement contract", () => {
  const old = structuredClone(fixture);
  old.skill_invocation = { primary: "requirement-test-workbench" };
  old.excel_font = "SimHei";
  const cases = old.sheets.find((sheet) => sheet.kind === "test_cases");
  cases.columns = COLUMNS;
  cases.rows = [{ values: ["OLD-1", "比例", "设置比例", "房主账号", "打开页面并保存", "展示新比例", "P0", "通过"] }];
  const normalized = normalizeRequirementReport(old);
  assert.deepEqual(normalized.sheets.find((sheet) => sheet.kind === "test_cases").columns, REQUIREMENT_COLUMNS);
  assert.deepEqual(normalized.sheets.find((sheet) => sheet.kind === "test_cases").rows[0].values, [
    "1", "比例", "设置比例", "1. 设置比例", "房主账号", "打开页面并保存", "展示新比例", "P0", "未执行", "",
  ]);
});

test("normalizes legacy eleven-column workbench input and drops actual results", () => {
  const old = structuredClone(fixture);
  old.skill_invocation = { primary: "requirement-test-workbench" };
  old.excel_font = "SimHei";
  const cases = old.sheets.find((sheet) => sheet.kind === "test_cases");
  cases.columns = ["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "实际结果", "执行结果", "备注"];
  cases.rows = [{ values: ["TC-009", "权限", "越权设置", "1. 权限", "普通管理员", "提交请求", "拒绝且数据不变", "P0", "服务端返回成功", "不通过", "旧证据"] }];
  const normalized = normalizeRequirementReport(old);
  const output = normalized.sheets.find((sheet) => sheet.kind === "test_cases");
  assert.deepEqual(output.columns, REQUIREMENT_COLUMNS);
  assert.deepEqual(output.rows[0].values, ["1", "权限", "越权设置", "1. 权限", "普通管理员", "提交请求", "拒绝且数据不变", "P0", "未执行", "旧证据"]);
  assert.equal(JSON.stringify(normalized).includes("实际结果"), false);
});

test("enforces the shared requirement contract for both requirement skills", () => {
  const graybox = structuredClone(fixture);
  graybox.skill_invocation = { primary: "enhanced-graybox-test-case-generation" };
  graybox.excel_font = "SimHei";
  graybox.sheets = [{
    name: "正式测试用例",
    kind: "test_cases",
    columns: REQUIREMENT_COLUMNS,
    rows: [
      { values: ["1", "权限", "校验对象归属", "1. 验证越权拦截", "1. 两个账号", "1. 请求他人对象", "1. 拒绝且数据不变", "P0", "未执行", "实现证据"] },
      { values: ["2", "权限", "校验本人对象", "1. 验证合法修改", "1. 本人对象", "1. 请求本人对象", "1. 修改成功", "P1", "未执行", "需求明示"] },
    ],
  }];
  assert.doesNotThrow(() => validateReport(graybox));

  const withDividerAndEvidence = structuredClone(graybox);
  withDividerAndEvidence.sheets[0].rows.unshift({ divider: true, values: ["【模块分割行】", "第 1 模块：权限", "权限范围", "-", "-", "-", "-", "-", "-", "模块起始分割"] });
  withDividerAndEvidence.sheets.push({ name: "证据覆盖", kind: "supplementary", columns: ["证据", "位置"], rows: [{ values: ["后端", "Controller#update"] }] });
  assert.doesNotThrow(() => validateReport(withDividerAndEvidence));

  const invalidId = structuredClone(graybox);
  invalidId.sheets[0].rows[1].values[0] = "TC-002";
  assert.throws(() => validateReport(invalidId), /连续阿拉伯数字/);

  const wrongSheet = structuredClone(graybox);
  wrongSheet.sheets[0].name = "灰盒用例";
  assert.throws(() => validateReport(wrongSheet), /正式测试用例/);

  const wrongFont = structuredClone(graybox);
  wrongFont.excel_font = "Arial";
  assert.throws(() => validateReport(wrongFont), /SimHei/);

  const missingFont = structuredClone(graybox);
  delete missingFont.excel_font;
  assert.throws(() => validateReport(missingFont), /SimHei/);

  const wrongDefaultStatus = structuredClone(graybox);
  wrongDefaultStatus.sheets[0].rows[0].values[8] = "通过";
  assert.throws(() => validateReport(wrongDefaultStatus), /默认为未执行/);

  const workbench = structuredClone(graybox);
  workbench.skill_invocation.primary = "requirement-test-workbench";
  assert.doesNotThrow(() => validateReport(workbench));
  const oldElevenOutput = structuredClone(workbench);
  oldElevenOutput.sheets[0].columns.splice(8, 0, "实际结果");
  oldElevenOutput.sheets[0].rows.forEach((row) => row.values.splice(8, 0, "尚未执行"));
  assert.throws(() => validateReport(oldElevenOutput), /需求类正式用例必须严格使用统一十列表头/);
});

test("does not force unrelated skills into the requirement contract", () => {
  for (const primary of ["single-api-test-full", "single-api-test-concise", "multi-api-flow-test", "production-verification-test", "test-case-quality-audit", "test-case-execution-compiler"]) {
    const report = structuredClone(fixture);
    report.skill_invocation = { primary };
    const cases = report.sheets.find((sheet) => sheet.kind === "test_cases");
    cases.columns = COLUMNS;
    cases.rows = [{ values: ["API-001", "接口", "合法请求", "已准备账号", "发起请求", "响应成功", "P0", "未执行"] }];
    assert.doesNotThrow(() => validateReport(report), primary);
  }
});

test("report id is deterministic and isolated", () => {
  assert.equal(buildReportId(fixture), buildReportId(structuredClone(fixture)));
  const other = structuredClone(fixture);
  other.project = "另一个项目";
  assert.notEqual(buildReportId(fixture), buildReportId(other));
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
