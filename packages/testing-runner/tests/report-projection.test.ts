import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  projectExecutionReport,
  renderExecutionReports,
  verifyExecutionDetailProjection,
} from "../src/reporting/report-projector.js";
import { verifyReportConsistency } from "../src/reporting/consistency-gate.js";
import type { RunResult } from "../src/types.js";

const COLUMNS = ["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "执行结果", "备注"];
const ELEVEN_COLUMNS = [...COLUMNS.slice(0, 8), "实际结果", ...COLUMNS.slice(8)];

function sourceReport() {
  return {
    title: "Execution projection",
    generated_at: "2026-07-15T00:00:00.000Z",
    skill_invocation: "web-api-test-execution-evidence",
    sheets: [
      {
        name: "Cases",
        kind: "test_cases",
        columns: COLUMNS,
        rows: [
          { values: ["CASE-001", "orders", "pass", "flow", "", "step", "ok", "P0", "未执行", ""] },
          { values: ["CASE-002", "orders", "fail", "flow", "", "step", "ok", "P1", "未执行", ""] },
        ],
      },
    ],
  };
}

function sourceReportWithActualResults() {
  const report = sourceReport();
  report.sheets[0]!.columns = ELEVEN_COLUMNS;
  for (const row of report.sheets[0]!.rows) row.values.splice(8, 0, "尚未执行");
  return report;
}

function runResult(): RunResult {
  return {
    protocol_version: "1.0.0",
    run_id: "run-report",
    manifest_hash: "b".repeat(64),
    run_status: "completed",
    started_at: "2026-07-15T00:00:01.000Z",
    completed_at: "2026-07-15T00:00:02.000Z",
    cases: [
      {
        case_id: "CASE-001",
        case_status: "通过",
        run_status: "completed",
        assertions: [{ assertion_id: "a1", passed: true, actual: "Bundle Smoke Ready", expected: "Bundle Smoke Ready" }],
        evidence: [
          { path: "run-report/evidence/CASE-001/attempt-1/a1/web-page.png", sha256: "c".repeat(64) },
          { path: "evidence/playwright-trace.zip", sha256: "e".repeat(64) },
        ],
      },
      {
        case_id: "CASE-002",
        case_status: "不通过",
        run_status: "completed",
        assertions: [{ assertion_id: "a2", passed: false, actual: { status: 500 } }],
        evidence: [{ path: "evidence/CASE-002/attempt-1/failure.json", sha256: "d".repeat(64) }],
      },
    ],
  };
}

test("projects one RunResult into exact ten-column case statuses and execution notes", () => {
  const projected = projectExecutionReport({ report: sourceReport(), result: runResult() });
  const rows = projected.sheets[0]!.rows;

  assert.deepEqual(projected.sheets[0]!.columns, COLUMNS);
  assert.deepEqual(rows.map((row) => row.values[8]), ["通过", "不通过"]);
  assert.match(rows[1]!.values[9], /run_status=completed/);
  assert.match(rows[1]!.values[9], /evidence=1/);
  assert.match(rows[1]!.values[9], /manifest=b{64}/);
  assert.equal(verifyReportConsistency({ report: projected, result: runResult() }).valid, true);
});

test("projects every assertion outcome and evidence reference without summary-only drift", () => {
  const result = runResult();
  const projected = projectExecutionReport({ report: sourceReport(), result });
  const assertions = projected.sheets.find((sheet) => sheet.name === "Assertion outcomes");
  const evidence = projected.sheets.find((sheet) => sheet.name === "Evidence references");
  const legacyEvidence = projected.sheets.find((sheet) => sheet.name === "执行证据");

  assert.deepEqual(assertions?.columns, ["Case ID", "Assertion ID", "Passed", "Actual", "Expected"]);
  assert.deepEqual(assertions?.rows, [
    { values: ["CASE-001", "a1", "true", "\"Bundle Smoke Ready\"", "\"Bundle Smoke Ready\""] },
    { values: ["CASE-002", "a2", "false", "{\"status\":500}", ""] },
  ]);
  assert.deepEqual(evidence?.columns, ["Case ID", "Run status", "Case status", "Evidence path", "SHA-256"]);
  assert.deepEqual(evidence?.rows, result.cases.flatMap((item) => item.evidence.map((reference) => ({
    values: [item.case_id, item.run_status, item.case_status, reference.path, reference.sha256],
  }))));
  assert.deepEqual(legacyEvidence?.columns, [
    "用例 ID",
    "运行状态",
    "执行结果",
    "证据路径",
    "SHA-256",
    "断言数",
    "断言明细 JSON",
  ]);
  assert.equal(legacyEvidence?.rows.length, 3);
  assert.equal(legacyEvidence?.rows[0]?.values[6], JSON.stringify(result.cases[0]?.assertions));
  assert.deepEqual(verifyExecutionDetailProjection({ report: projected, result }), {
    valid: true,
    errors: [],
  });
});

test("projects assertion actuals into the eleven-column actual result field", () => {
  const result = runResult();
  result.cases[0]!.assertions[0]!.actual = { url: "/dashboard", visible: "退出" };
  const projected = projectExecutionReport({ report: sourceReportWithActualResults(), result });
  const rows = projected.sheets[0]!.rows;

  assert.deepEqual(projected.sheets[0]!.columns, ELEVEN_COLUMNS);
  assert.match(String(rows[0]!.values[8]), /a1.*dashboard.*退出/);
  assert.match(String(rows[1]!.values[8]), /a2.*500/);
  assert.deepEqual(rows.map((row) => row.values[9]), ["通过", "不通过"]);
  assert.match(String(rows[1]!.values[10]), /run_status=completed/);
  assert.equal(verifyReportConsistency({ report: projected, result }).valid, true);
});

test("consistency gate rejects status drift between RunResult and projected report", () => {
  const projected = projectExecutionReport({ report: sourceReport(), result: runResult() });
  projected.sheets[0]!.rows[0]!.values[8] = "待定";

  const consistency = verifyReportConsistency({ report: projected, result: runResult() });
  assert.equal(consistency.valid, false);
  assert.match(consistency.errors.join("\n"), /CASE-001/);
});

test("renders projected execution report to xlsx and html from the same data source", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-report-"));
  const projected = projectExecutionReport({ report: sourceReport(), result: runResult() });

  const rendered = await renderExecutionReports(projected, directory, "result");

  assert.ok((await stat(rendered.xlsx)).size > 1000);
  assert.ok((await stat(rendered.html)).size > 1000);
  const html = await readFile(rendered.html, "utf8");
  assert.match(html, /CASE-001/);
  assert.match(html, /a1/);
  assert.match(html, /web-page\.png/);
  assert.match(html, /playwright-trace\.zip/);
  assert.match(html, /不通过/);
});
