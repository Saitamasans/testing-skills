import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import ExcelJS from "exceljs";

import {
  UnsupportedInputError,
  detectInputKind,
} from "../src/input/detect-input.js";
import { readStandardExcel } from "../src/input/excel-reader.js";
import { readNativeReport } from "../src/input/report-reader.js";
import { snapshotSource } from "../src/input/source-snapshot.js";

const TEN_COLUMNS = [
  "用例 ID",
  "所属模块",
  "用例标题",
  "验证功能点",
  "前置条件",
  "测试步骤",
  "预期结果",
  "优先级",
  "执行结果",
  "备注",
] as const;

const FIXTURES = path.resolve(import.meta.dirname, "fixtures");
const REPORT_FIXTURE = path.join(FIXTURES, "standard-report.json");
const TRACKED_EXCEL_FIXTURE = path.join(FIXTURES, "standard-ten-column.xlsx");
let excelFixture = "";
let generatedFixtureDir = "";
let trackedExcelHashBeforeSetup = "";

const CASE_ROWS = [
  ["【模块分割行】", "第 1 模块：支付", "支付主流程", "-", "-", "-", "-", "-", "-", "模块起始分割"],
  ["PAY-001", "支付", "【正向】正常支付", "验证支付成功", "测试账号已登录", "1. 提交合法订单\n2. 完成支付", "1. 返回成功\n2. 订单状态已支付", "P0", "未执行", undefined],
  ["PAY-002", "支付", "【异常】余额不足", "验证失败提示", "余额不足", "提交支付", "明确提示余额不足且不扣款", "P0", "通过", "已验证"],
  ["PAY-003", "退款", "【异常】重复退款", "验证幂等", "订单已退款", "再次发起退款", "不重复退款", "P1", "不通过", "关联 BUG-101"],
  ["PAY-004", "退款", "【口径】退款时效", "验证时效口径", "订单已支付", "超过时效后退款", "按最终确认口径判定", "P2", "待定", ""],
] as const;

async function writeWorkbook(
  file: string,
  columns: readonly unknown[] = TEN_COLUMNS,
  rows: readonly (readonly unknown[])[] = CASE_ROWS,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("用例");
  sheet.addRow([...columns]);
  for (const row of rows) sheet.addRow([...row]);
  workbook.addWorksheet("说明").addRow(["项目", "内容"]);
  await workbook.xlsx.writeFile(file);
}

before(async () => {
  trackedExcelHashBeforeSetup = createHash("sha256")
    .update(await readFile(TRACKED_EXCEL_FIXTURE))
    .digest("hex");
  generatedFixtureDir = await mkdtemp(path.join(os.tmpdir(), "runner-native-suite-"));
  excelFixture = path.join(generatedFixtureDir, "standard-ten-column.xlsx");
  await writeWorkbook(excelFixture, [
    ` \t\uFEFF${TEN_COLUMNS[0]} `,
    ` ${TEN_COLUMNS[1]}\t`,
    ...TEN_COLUMNS.slice(2),
  ]);
});

after(async () => {
  if (generatedFixtureDir !== "") {
    await rm(generatedFixtureDir, { recursive: true, force: true });
  }
});

test("reads the tracked standard Excel fixture without mutating it", async () => {
  assert.equal(await detectInputKind(TRACKED_EXCEL_FIXTURE), "standard-excel");
  const currentHash = createHash("sha256")
    .update(await readFile(TRACKED_EXCEL_FIXTURE))
    .digest("hex");
  assert.equal(currentHash, trackedExcelHashBeforeSetup);
});

test("detects native report JSON and standard Excel by validated content", async () => {
  assert.equal(await detectInputKind(REPORT_FIXTURE), "native-report");
  assert.equal(await detectInputKind(excelFixture), "standard-excel");
});

test("normalizes native report with exact columns, invocation and row provenance", async () => {
  const result = await readNativeReport(REPORT_FIXTURE);

  assert.deepEqual(result.columns, TEN_COLUMNS);
  assert.deepEqual(result.skill_invocation, {
    primary: "single-api-test-full",
    secondary: "production-verification-test",
    roles: "生成接口用例并补充生产只读验证",
  });
  assert.equal(result.cases[0]?.source, "用例!2");
  assert.equal(result.cases[0]?.divider, true);
  assert.equal(result.cases[0]?.raw_values[0], "【模块分割行】");
  assert.equal(result.cases[1]?.id, "PAY-001");
  assert.equal(result.cases[1]?.original_status, "未执行");
  assert.deepEqual(result.cases.map(({ status }) => status), ["-", "未执行", "通过", "不通过", "待定"]);
  assert.deepEqual(result.cases.map(({ source_row }) => source_row), [2, 3, 4, 5, 6]);
  assert.deepEqual(result.cases[1]?.extensions, {});
});

test("standard Excel normalizes to the same ordered cases and defaults missing remarks", async () => {
  const native = await readNativeReport(REPORT_FIXTURE);
  const excel = await readStandardExcel(excelFixture);

  assert.deepEqual(excel.columns, TEN_COLUMNS);
  assert.deepEqual(excel.cases, native.cases);
  assert.equal(excel.cases[1]?.raw_values[9], "");
  assert.deepEqual(excel.source_snapshot.sheet_names, ["用例", "说明"]);
});

test("defaults a blank execution result to 未执行 while preserving the original blank", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-native-"));
  const file = path.join(dir, "blank-status.xlsx");
  const rows = CASE_ROWS.map((row) => [...row]);
  rows[1]![8] = "";
  await writeWorkbook(file, TEN_COLUMNS, rows);

  const result = await readStandardExcel(file);
  assert.equal(result.cases[1]?.original_status, "");
  assert.equal(result.cases[1]?.status, "未执行");
});

test("preserves raw Excel formula data while normalizing its displayed result", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-native-"));
  const file = path.join(dir, "formula.xlsx");
  const rows = CASE_ROWS.map((row) => [...row]);
  rows[1]![2] = { formula: '"【正向】正常支付"', result: "【正向】正常支付" };
  await writeWorkbook(file, TEN_COLUMNS, rows);

  const result = await readStandardExcel(file);
  assert.deepEqual(result.cases[1]?.raw_values[2], {
    formula: '"【正向】正常支付"',
    result: "【正向】正常支付",
  });
  assert.equal(result.cases[1]?.values["用例标题"], "【正向】正常支付");
});

test("recognizes a divider row from formula display values", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-native-"));
  const file = path.join(dir, "formula-divider.xlsx");
  const rows = CASE_ROWS.map((row) => [...row]);
  rows[0]![0] = { formula: '"【模块分割行】"', result: "【模块分割行】" };
  rows[0]![8] = { formula: '"-"', result: "-" };
  await writeWorkbook(file, TEN_COLUMNS, rows);

  const result = await readStandardExcel(file);
  assert.equal(result.cases[0]?.divider, true);
  assert.equal(result.cases[0]?.status, "-");
});

test("rejects a dash status on an ordinary Excel case", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-native-"));
  const file = path.join(dir, "dash-status.xlsx");
  const rows = CASE_ROWS.map((row) => [...row]);
  rows[1]![8] = "-";
  await writeWorkbook(file, TEN_COLUMNS, rows);

  await assert.rejects(() => readStandardExcel(file), /执行结果无效：-（用例!3）/);
});

test("rejects empty and duplicate IDs in native and standard inputs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-native-"));
  const nativeValue = JSON.parse(await readFile(REPORT_FIXTURE, "utf8")) as {
    sheets: Array<{ rows: Array<{ values: unknown[] }> }>;
  };
  nativeValue.sheets[0]!.rows[2]!.values[0] = "PAY-001";
  const duplicateJson = path.join(dir, "duplicate.json");
  await writeFile(duplicateJson, JSON.stringify(nativeValue));

  await assert.rejects(() => readNativeReport(duplicateJson), /用例 ID.*重复.*PAY-001/);

  const rows = CASE_ROWS.map((row) => [...row]);
  rows[1]![0] = "";
  const emptyExcel = path.join(dir, "empty-id.xlsx");
  await writeWorkbook(emptyExcel, TEN_COLUMNS, rows);
  await assert.rejects(() => readStandardExcel(emptyExcel), /用例 ID.*为空.*用例!3/);
});

test("classifies a parseable workbook without exact ordered headers as nonstandard", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-native-"));
  const file = path.join(dir, "nonstandard.xlsx");
  await writeWorkbook(file, ["编号", "标题", "步骤"]);

  assert.equal(await detectInputKind(file), "nonstandard-excel");
});

test("rejects invalid, unsupported, encrypted and macro-enabled content explicitly", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runner-native-"));
  const unsupported = [
    ["cases.csv", "用例 ID,标题"],
    ["cases.md", "# cases"],
    ["cases.html", "<html></html>"],
    ["fake.json", "<html></html>"],
    ["fake.xlsx", "<html></html>"],
  ] as const;

  for (const [name, contents] of unsupported) {
    const file = path.join(dir, name);
    await writeFile(file, contents);
    await assert.rejects(
      () => detectInputKind(file),
      (error: unknown) =>
        error instanceof UnsupportedInputError && /仅支持.*JSON.*\.xlsx/.test(error.message),
    );
  }

  const encrypted = path.join(dir, "encrypted.xlsx");
  await writeFile(encrypted, Buffer.from("d0cf11e0a1b11ae1", "hex"));
  await assert.rejects(() => detectInputKind(encrypted), /加密.*不支持/);

  const macroExtension = path.join(dir, "macro.xlsm");
  await writeFile(macroExtension, await readFile(excelFixture));
  await assert.rejects(() => detectInputKind(macroExtension), /宏.*不支持/);

  const macroContent = path.join(dir, "macro.xlsx");
  await writeFile(macroContent, Buffer.concat([await readFile(excelFixture), Buffer.from("xl/vbaProject.bin")]));
  await assert.rejects(() => detectInputKind(macroContent), /宏.*不支持/);
});

test("snapshots original bytes deterministically without source content", async () => {
  const bytes = await readFile(excelFixture);
  const fileStat = await stat(excelFixture);
  const snapshot = await snapshotSource(excelFixture);

  assert.equal(snapshot.absolute_path, path.resolve(excelFixture));
  assert.equal(snapshot.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(snapshot.size, bytes.byteLength);
  assert.equal(snapshot.modified_at, fileStat.mtime.toISOString());
  assert.equal(snapshot.input_kind, "standard-excel");
  assert.deepEqual(snapshot.sheet_names, ["用例", "说明"]);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "absolute_path",
    "input_kind",
    "modified_at",
    "sha256",
    "sheet_names",
    "size",
  ]);
});
