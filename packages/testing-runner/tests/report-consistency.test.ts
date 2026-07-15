import assert from "node:assert/strict";
import test from "node:test";

import { verifyReportConsistency } from "../src/reporting/consistency-gate.js";
import type { RunResult } from "../src/types.js";

test("consistency gate requires every RunResult case to exist exactly once in report rows", () => {
  const report = {
    title: "x",
    generated_at: "2026-07-15T00:00:00.000Z",
    skill_invocation: "web-api-test-execution-evidence",
    sheets: [
      {
        name: "Cases",
        kind: "test_cases",
        columns: ["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "执行结果", "备注"],
        rows: [
          { values: ["CASE-001", "", "", "", "", "", "", "P0", "通过", ""] },
          { values: ["CASE-001", "", "", "", "", "", "", "P0", "通过", ""] },
        ],
      },
    ],
  };
  const result: RunResult = {
    protocol_version: "1.0.0",
    run_id: "run",
    manifest_hash: "b".repeat(64),
    run_status: "completed",
    started_at: "2026-07-15T00:00:00.000Z",
    cases: [
      { case_id: "CASE-001", case_status: "通过", run_status: "completed", assertions: [], evidence: [] },
      { case_id: "CASE-002", case_status: "未执行", run_status: "blocked", assertions: [], evidence: [] },
    ],
  };

  const consistency = verifyReportConsistency({ report, result });

  assert.equal(consistency.valid, false);
  assert.match(consistency.errors.join("\n"), /duplicate|missing/i);
});
