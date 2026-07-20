import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { EventWriter } from "../src/runtime/event-writer.js";
import { storeEvidence } from "../src/runtime/evidence-store.js";
import { runApprovedManifest } from "../src/runtime/run-orchestrator.js";
import { fingerprintSecret } from "../src/security/redactor.js";
import type { RunManifest } from "../src/types.js";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readJsonLines(file: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(file, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function manifest(): RunManifest {
  return {
    protocol_version: "1.0.0",
    manifest_id: "manifest-runtime",
    runner: { version: "1.0.0" },
    source: { path: "report.json", sha256: "a".repeat(64) },
    cases: [
      {
        case_id: "CASE-001",
        original: {
          "用例 ID": "CASE-001",
          "所属模块": "runtime",
          "用例标题": "retry once",
          "验证功能点": "transient failure",
          "前置条件": "",
          "测试步骤": "execute",
          "预期结果": "success",
          "优先级": "P0",
          "执行结果": "",
          "备注": "",
        },
        steps: [
          {
            type: "api.request",
            action_id: "CASE-001-request",
            target_alias: "api",
            method: "GET",
            path: "/ok",
            risk: "R0",
            retry_eligible: true,
          },
          {
            type: "api.assert",
            action_id: "CASE-001-assert",
            target_alias: "api",
            assertion: "status is 200",
            risk: "R0",
          },
        ],
      },
    ],
  };
}

function manifestWithCases(caseIds: string[]): RunManifest {
  const base = manifest();
  return {
    ...base,
    cases: caseIds.map((caseId) => ({
      ...base.cases[0]!,
      case_id: caseId,
      original: {
        ...base.cases[0]!.original,
        "用例 ID": caseId,
      } as RunManifest["cases"][number]["original"],
      steps: [
        {
          ...base.cases[0]!.steps[0]!,
          action_id: `${caseId}-request`,
        },
        {
          ...base.cases[0]!.steps[1]!,
          action_id: `${caseId}-assert`,
        },
      ],
    })),
  };
}

test("event writer appends monotonic redacted JSONL without mutating prior events", async () => {
  const directory = await tempDir("runner-events-");
  const file = path.join(directory, "run-events.jsonl");
  const writer = new EventWriter(file, [fingerprintSecret("CANARY_TOKEN", "token")]);

  await writer.appendEvent({ run_id: "run-1", attempt: 1, type: "action.started", data: { token: "CANARY_TOKEN" } });
  await writer.appendEvent({ run_id: "run-1", attempt: 1, type: "action.passed", data: { status: 200 } });

  const events = await readJsonLines(file);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
  assert.doesNotMatch(JSON.stringify(events), /CANARY_TOKEN/);
  assert.match(JSON.stringify(events), /REDACTED/);
});

test("evidence store writes exclusive files, hashes them and keeps attempt paths separate", async () => {
  const directory = await tempDir("runner-evidence-");
  const first = await storeEvidence({
    runDir: directory,
    case_id: "CASE-001",
    attempt: 1,
    relativePath: "failure.json",
    content: JSON.stringify({ error: "first" }),
  });
  const second = await storeEvidence({
    runDir: directory,
    case_id: "CASE-001",
    attempt: 2,
    relativePath: "trace.json",
    content: JSON.stringify({ ok: true }),
  });

  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(first.path, second.path);
  await assert.rejects(
    () => storeEvidence({
      runDir: directory,
      case_id: "CASE-001",
      attempt: 1,
      relativePath: "failure.json",
      content: "overwrite",
    }),
    /already exists/i,
  );
  const index = JSON.parse(await readFile(path.join(directory, "evidence-index.json"), "utf8")) as unknown[];
  assert.equal(index.length, 2);
});

test("orchestrator preserves first-attempt evidence when retry succeeds", async () => {
  const directory = await tempDir("runner-orchestrator-");
  let calls = 0;
  const result = await runApprovedManifest({
    manifest: manifest(),
    outputDir: directory,
    run_id: "run-retry",
    executeAction: async (action, attempt) => {
      calls += 1;
      if (attempt === 1) {
        return {
          action_id: action.action_id,
          started_at: "2026-07-15T00:00:00.000Z",
          finished_at: "2026-07-15T00:00:01.000Z",
          status: "executor_error",
          attachments: [],
          error: { type: "network_reset", message: "connection reset" },
        };
      }
      return {
        action_id: action.action_id,
        started_at: "2026-07-15T00:00:02.000Z",
        finished_at: "2026-07-15T00:00:03.000Z",
        status: "passed",
        attachments: [],
        actual: { status: 200 },
      };
    },
  });

  assert.equal(calls, 3);
  assert.equal(result.run_status, "completed");
  assert.equal(result.cases[0]?.case_status, "通过");
  const events = await readJsonLines(path.join(directory, "run-retry", "run-events.jsonl"));
  assert.equal(events.filter((event) => event.attempt === 1 && event.type === "action.failed").length, 1);
  assert.equal(events.filter((event) => event.type === "retry.scheduled").length, 1);
  assert.ok(await readFile(path.join(directory, "run-retry", "evidence", "CASE-001", "attempt-1", "failure.json"), "utf8"));
});

test("orchestrator blocks action-only cases instead of synthesizing a passing verdict", async () => {
  const directory = await tempDir("runner-missing-assertion-");
  let executed = false;
  const actionOnlyManifest = manifest();
  actionOnlyManifest.cases[0]!.steps = [actionOnlyManifest.cases[0]!.steps[0]!];
  const result = await runApprovedManifest({
    manifest: actionOnlyManifest,
    outputDir: directory,
    run_id: "run-missing-assertion",
    executeAction: async (action) => {
      executed = true;
      return {
        action_id: action.action_id,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: "passed",
        attachments: [],
      };
    },
  });

  assert.equal(executed, false);
  assert.equal(result.run_status, "blocked");
  assert.equal(result.cases[0]?.case_status, "未执行");
  assert.equal(result.cases[0]?.run_status, "blocked");
  assert.match(JSON.stringify(result.cases[0]?.assertions), /business assertion/i);
});

test("orchestrator stores passed action attachments and records the real run window", async () => {
  const directory = await tempDir("runner-success-evidence-");
  let actionStartedAt = 0;

  const result = await runApprovedManifest({
    manifest: manifest(),
    outputDir: directory,
    run_id: "run-success-evidence",
    executeAction: async (action) => {
      actionStartedAt = Date.now();
      await delay(20);
      return {
        action_id: action.action_id,
        started_at: new Date(actionStartedAt).toISOString(),
        finished_at: new Date().toISOString(),
        status: "passed",
        actual: { status: 200 },
        attachments: [
          {
            relativePath: `${action.action_id}/web-success.png`,
            content: Buffer.from("fake png"),
          },
          {
            relativePath: `${action.action_id}/api-request-response.json`,
            content: JSON.stringify({ request: { method: "GET", path: "/ok" }, response: { status: 200 } }),
          },
        ],
      };
    },
  });

  const runStartedAt = Date.parse(result.started_at);
  assert.ok(runStartedAt <= actionStartedAt, `${result.started_at} should be captured before the action starts`);
  assert.ok(Date.parse(result.completed_at ?? "") >= actionStartedAt);
  assert.equal(result.cases[0]?.case_status, "通过");
  assert.equal(result.cases[0]?.evidence.length, 4);

  const runDir = path.join(directory, "run-success-evidence");
  assert.equal(
    await readFile(path.join(runDir, "evidence", "CASE-001", "attempt-1", "CASE-001-request", "web-success.png"), "utf8"),
    "fake png",
  );
  const apiEvidence = await readFile(
    path.join(runDir, "evidence", "CASE-001", "attempt-1", "CASE-001-request", "api-request-response.json"),
    "utf8",
  );
  assert.match(apiEvidence, /"status":200|status/);
});

test("orchestrator marks executed expectation conflicts as 待定", async () => {
  const directory = await tempDir("runner-pending-evidence-");
  const result = await runApprovedManifest({
    manifest: manifest(),
    outputDir: directory,
    run_id: "run-pending",
    executeAction: async (action) => ({
      action_id: action.action_id,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "pending",
      actual: {
        conflict: "coupon expiry boundary",
        product_rule: "client click time",
        api_rule: "server receive time",
      },
      attachments: [
        {
          relativePath: `${action.action_id}/expectation-conflict.json`,
          content: JSON.stringify({ product_rule: "client click time", api_rule: "server receive time" }),
        },
      ],
    }),
  });

  assert.equal(result.run_status, "completed");
  assert.equal(result.cases[0]?.run_status, "completed");
  assert.equal(result.cases[0]?.case_status, "待定");
  assert.equal(result.cases[0]?.evidence.length, 2);
  assert.ok(await readFile(path.join(directory, "run-pending", "evidence", "CASE-001", "attempt-1", "pending.json"), "utf8"));
});

test("orchestrator aggregates repeated failed Test Cases by root cause without dropping evidence", async () => {
  const directory = await tempDir("runner-root-defect-");
  const result = await runApprovedManifest({
    manifest: manifestWithCases(["IDEMP-001", "IDEMP-002"]),
    outputDir: directory,
    run_id: "run-root-defect",
    executeAction: async (action) => ({
      action_id: action.action_id,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "failed",
      root_cause_key: "orders.idempotency.duplicate-lock",
      actual: { duplicate_orders: 2, locked_stock_times: 2 },
      attachments: [
        {
          relativePath: `${action.action_id}/duplicate-order.json`,
          content: JSON.stringify({ duplicate_orders: 2, locked_stock_times: 2 }),
        },
      ],
      error: { type: "business_assertion_failed", message: "Duplicate idempotency key created two orders" },
    }),
  });

  assert.equal(result.cases.length, 2);
  assert.deepEqual(result.cases.map((item) => item.case_status), ["不通过", "不通过"]);
  assert.equal(result.cases.every((item) => item.evidence.length >= 2), true);
  assert.equal(result.defects?.length, 1);
  assert.equal(result.defects?.[0]?.root_cause_key, "orders.idempotency.duplicate-lock");
  assert.deepEqual(result.defects?.[0]?.case_ids, ["IDEMP-001", "IDEMP-002"]);
  assert.equal(result.defects?.[0]?.evidence.length, 2);
});

test("orchestrator keeps explicitly blocked Test Cases as 未执行 instead of executor_error", async () => {
  const directory = await tempDir("runner-explicit-blocked-");
  const result = await runApprovedManifest({
    manifest: manifest(),
    outputDir: directory,
    run_id: "run-explicit-blocked",
    executeAction: async (action) => ({
      action_id: action.action_id,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "blocked",
      actual: { reason: "missing observable field" },
      attachments: [],
      error: { type: "execution_input_gap", message: "missing observable field" },
    }),
  });

  assert.equal(result.run_status, "blocked");
  assert.equal(result.cases[0]?.run_status, "blocked");
  assert.equal(result.cases[0]?.case_status, "未执行");
});

test("orchestrator reports the observable run lifecycle in authoritative execution order", async () => {
  const directory = await tempDir("runner-observer-");
  const events: string[] = [];

  await runApprovedManifest({
    manifest: manifestWithCases(["CASE-001", "CASE-002"]),
    outputDir: directory,
    run_id: "run-observer",
    observer: {
      runStarted: () => { events.push("run.started"); },
      caseStarted: ({ item }) => { events.push(`case.started:${item.case_id}`); },
      actionStarted: ({ action }) => { events.push(`action.started:${action.action_id}`); },
      actionCompleted: ({ action, outcome }) => { events.push(`action.${outcome.status}:${action.action_id}`); },
      caseCompleted: ({ result }) => { events.push(`case.completed:${result.case_id}:${result.case_status}`); },
      runCompleted: () => { events.push("run.completed"); },
    },
    executeAction: async (action) => ({
      action_id: action.action_id,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: action.action_id.startsWith("CASE-002") ? "pending" : "passed",
      actual: { status: 200 },
      attachments: [],
    }),
  });

  assert.deepEqual(events, [
    "run.started",
    "case.started:CASE-001",
    "action.started:CASE-001-request",
    "action.passed:CASE-001-request",
    "action.started:CASE-001-assert",
    "action.passed:CASE-001-assert",
    "case.completed:CASE-001:通过",
    "case.started:CASE-002",
    "action.started:CASE-002-request",
    "action.pending:CASE-002-request",
    "case.completed:CASE-002:待定",
    "run.completed",
  ]);
});

test("orchestrator runs case setup and teardown around every case", async () => {
  const directory = await tempDir("runner-case-lifecycle-");
  const events: string[] = [];
  await runApprovedManifest({
    manifest: manifestWithCases(["CASE-001", "CASE-002"]),
    outputDir: directory,
    run_id: "run-case-lifecycle",
    beforeCase: async (item) => { events.push(`before:${item.case_id}`); },
    afterCase: async (item) => { events.push(`after:${item.case_id}`); },
    executeAction: async (action) => ({
      action_id: action.action_id,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "passed",
      actual: { status: 200 },
      attachments: [],
    }),
  });

  assert.deepEqual(events, ["before:CASE-001", "after:CASE-001", "before:CASE-002", "after:CASE-002"]);
});

test("contract cleanup status keeps an earlier failure when a later cleanup passes", async () => {
  const directory = await tempDir("runner-contract-cleanup-");
  const subject = manifest();
  subject.cases[0]!.execution_contract = {
    case_id: "CASE-001",
    source_case_id: "CASE-001",
    source_sheet: "Cases",
    title: "cleanup aggregation",
    module: "runtime",
    priority: "P0",
    execution_type: "web_ui",
    automation_status: "auto_ready",
    isolation_scope: "case",
    flow_group: null,
    start_state: { description: "ready" },
    auth_profile: { id: "anonymous" },
    setup: [],
    actions: [],
    assertions: [{ assertion_id: "CASE-001-E1", description: "request passed" }],
    effects: {},
    cleanup: {
      technical_cleanup: [],
      business_cleanup: [
        { cleanup_id: "CASE-001-C1", description: "first cleanup" },
        { cleanup_id: "CASE-001-C2", description: "second cleanup" },
      ],
    },
    dependencies: [],
    resource_locks: [],
    evidence_policy: {},
    unresolved: [],
  };
  subject.cases[0]!.steps = [
    { type: "api.assert", action_id: "assert", source_step: "CASE-001-E1", target_alias: "api", assertion: "status is 200", risk: "R0" },
    { type: "cleanup.api", action_id: "cleanup-first", source_step: "CASE-001-C1", target_alias: "api", method: "DELETE", path: "/first", risk: "R0" },
    { type: "cleanup.api", action_id: "cleanup-second", source_step: "CASE-001-C2", target_alias: "api", method: "DELETE", path: "/second", risk: "R0" },
  ];

  const result = await runApprovedManifest({
    manifest: subject,
    outputDir: directory,
    executeAction: async (action) => ({
      action_id: action.action_id,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: action.action_id === "cleanup-first" ? "failed" : "passed",
      attachments: [],
      ...(action.action_id === "cleanup-first" ? { error: { type: "cleanup_failed", message: "first cleanup failed" } } : { actual: { ok: true } }),
    }),
  });

  assert.equal(result.cases[0]?.contract_field_status?.cleanup, "failed");
});
