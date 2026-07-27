import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  attachTraceEvidence,
  finalizeResultForReporting,
} from "../src/commands/run.js";
import { TEN_COLUMNS } from "../src/input/detect-input.js";
import { verifyReportConsistency } from "../src/reporting/consistency-gate.js";
import {
  projectExecutionReport,
  verifyExecutionDetailProjection,
} from "../src/reporting/report-projector.js";
import type { RunManifest, RunResult } from "../src/types.js";

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

test("detail consistency rejects assertion and evidence projection drift", () => {
  const result: RunResult = {
    protocol_version: "1.0.0",
    run_id: "run-details",
    manifest_hash: "a".repeat(64),
    run_status: "completed",
    started_at: "2026-07-18T00:00:00.000Z",
    completed_at: "2026-07-18T00:00:01.000Z",
    cases: [{
      case_id: "CASE-001",
      case_status: "通过",
      run_status: "completed",
      assertions: [{ assertion_id: "visible-text", passed: true, actual: "ready" }],
      evidence: [{ path: "run-details/evidence/CASE-001/web-page.png", sha256: "b".repeat(64) }],
    }],
  };
  const report = {
    title: "details",
    generated_at: "2026-07-18T00:00:00.000Z",
    skill_invocation: "web-api-test-execution-evidence",
    sheets: [{
      name: "Cases",
      kind: "test_cases" as const,
      columns: TEN_COLUMNS,
      rows: [{ values: ["CASE-001", "", "", "", "", "", "", "P0", "未执行", ""] }],
    }],
  };
  const projected = projectExecutionReport({ report, result });
  const assertionSheet = projected.sheets.find((sheet) => sheet.name === "Assertion outcomes")!;
  assertionSheet.rows[0]!.values[2] = "false";

  const consistency = verifyExecutionDetailProjection({ report: projected, result });

  assert.equal(consistency.valid, false);
  assert.match(consistency.errors.join("\n"), /visible-text.*drift/i);
});

test("Trace is finalized as run evidence for every case without becoming a business assertion", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "runner-trace-projection-"));
  const tracePath = path.join(outputDir, "evidence", "playwright-trace.zip");
  await mkdir(path.dirname(tracePath), { recursive: true });
  await writeFile(tracePath, "trace", "utf8");
  const result: RunResult = {
    protocol_version: "1.0.0",
    run_id: "run-trace",
    manifest_hash: "a".repeat(64),
    run_status: "completed",
    started_at: "2026-07-18T00:00:00.000Z",
    cases: [
      { case_id: "WEB-001", case_status: "通过", run_status: "completed", assertions: [{ assertion_id: "visible", passed: true }], evidence: [] },
      { case_id: "API-001", case_status: "通过", run_status: "completed", assertions: [{ assertion_id: "status", passed: true }], evidence: [] },
    ],
  };
  const manifest = {
    cases: [
      { case_id: "WEB-001", steps: [{ type: "web.assert" }] },
      { case_id: "API-001", steps: [{ type: "api.assert" }] },
    ],
  } as unknown as RunManifest;

  const attached = await attachTraceEvidence({ result, manifest, outputDir, tracePath });

  assert.equal(attached.cases[0]!.assertions.length, 1);
  assert.equal(attached.cases[0]!.evidence.length, 1);
  assert.deepEqual(attached.cases[0]!.evidence[0], {
    path: "evidence/playwright-trace.zip",
    sha256: "eafe895eb8119e6e5d06463590b2ef81b3651c157d5c8e18f1889186c7fd0ac0",
  });
  assert.equal(attached.cases[1]!.assertions.length, 1);
  assert.deepEqual(attached.cases[1]!.evidence, attached.cases[0]!.evidence);
});

test("per-case Trace evidence remains isolated to the matching Test Case", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "runner-isolated-traces-"));
  const firstTrace = path.join(outputDir, "evidence", "WEB-001", "playwright-trace.zip");
  const secondTrace = path.join(outputDir, "evidence", "WEB-002", "playwright-trace.zip");
  await mkdir(path.dirname(firstTrace), { recursive: true });
  await mkdir(path.dirname(secondTrace), { recursive: true });
  await writeFile(firstTrace, "trace-one", "utf8");
  await writeFile(secondTrace, "trace-two", "utf8");
  const result: RunResult = {
    protocol_version: "1.0.0",
    run_id: "run-isolated-traces",
    manifest_hash: "a".repeat(64),
    run_status: "completed",
    started_at: "2026-07-18T00:00:00.000Z",
    cases: [
      { case_id: "WEB-001", case_status: "通过", run_status: "completed", assertions: [], evidence: [] },
      { case_id: "WEB-002", case_status: "通过", run_status: "completed", assertions: [], evidence: [] },
    ],
  };
  const manifest = { cases: [
    { case_id: "WEB-001", steps: [{ type: "web.assert" }] },
    { case_id: "WEB-002", steps: [{ type: "web.assert" }] },
  ] } as unknown as RunManifest;

  const attached = await attachTraceEvidence({
    result,
    manifest,
    outputDir,
    tracePaths: [firstTrace, secondTrace],
  });

  assert.deepEqual(attached.cases[0]!.evidence.map(({ path: value }) => value), [
    "evidence/WEB-001/playwright-trace.zip",
  ]);
  assert.deepEqual(attached.cases[1]!.evidence.map(({ path: value }) => value), [
    "evidence/WEB-002/playwright-trace.zip",
  ]);
});

test("manual-required report finalizes and attaches Trace before projection", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "runner-manual-trace-"));
  const tracePath = path.join(outputDir, "evidence", "playwright-trace.zip");
  const events: string[] = [];
  const result: RunResult = {
    protocol_version: "1.0.0",
    run_id: "run-manual",
    manifest_hash: "a".repeat(64),
    run_status: "manual_required",
    started_at: "2026-07-18T00:00:00.000Z",
    cases: [{
      case_id: "WEB-001",
      case_status: "未执行",
      run_status: "manual_required",
      assertions: [{ assertion_id: "manual", passed: false }],
      evidence: [],
    }],
  };
  const manifest = { cases: [{ case_id: "WEB-001", steps: [{ type: "web.assert" }] }] } as unknown as RunManifest;

  const finalized = await finalizeResultForReporting({
    result,
    manifest,
    outputDir,
    finalizeTrace: async () => {
      events.push("trace.finalize");
      await mkdir(path.dirname(tracePath), { recursive: true });
      await writeFile(tracePath, "trace", "utf8");
      return tracePath;
    },
  });
  events.push("report.project");
  projectExecutionReport({
    report: {
      title: "manual",
      generated_at: "2026-07-18T00:00:00.000Z",
      skill_invocation: "web-api-test-execution-evidence",
      sheets: [{ name: "Cases", kind: "test_cases", columns: TEN_COLUMNS, rows: [{ values: ["WEB-001", "", "", "", "", "", "", "P0", "未执行", ""] }] }],
    },
    result: finalized,
  });

  assert.deepEqual(events, ["trace.finalize", "report.project"]);
  assert.equal(finalized.cases[0]!.assertions.length, 1);
  assert.equal(finalized.cases[0]!.evidence[0]?.path, "evidence/playwright-trace.zip");
});
