import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
        ],
      },
    ],
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

  assert.equal(calls, 2);
  assert.equal(result.run_status, "completed");
  assert.equal(result.cases[0]?.case_status, "通过");
  const events = await readJsonLines(path.join(directory, "run-retry", "run-events.jsonl"));
  assert.equal(events.filter((event) => event.attempt === 1 && event.type === "action.failed").length, 1);
  assert.equal(events.filter((event) => event.type === "retry.scheduled").length, 1);
  assert.ok(await readFile(path.join(directory, "run-retry", "evidence", "CASE-001", "attempt-1", "failure.json"), "utf8"));
});
