import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeCleanup } from "../src/runtime/cleanup-manager.js";
import { runApprovedManifest } from "../src/runtime/run-orchestrator.js";
import { retryDecision } from "../src/runtime/retry-policy.js";
import type { RunManifest } from "../src/types.js";

test("retry policy retries only classified transient infrastructure failures once", () => {
  assert.deepEqual(retryDecision({ kind: "network_reset" }, 1), { retry: true, max_attempts: 2 });
  assert.deepEqual(retryDecision({ kind: "service_unavailable" }, 2), { retry: false, max_attempts: 2 });
  assert.deepEqual(retryDecision({ kind: "assertion_failed" }, 1), { retry: false, max_attempts: 2 });
  assert.deepEqual(retryDecision({ kind: "manual_auth" }, 1), { retry: false, max_attempts: 2 });
  assert.deepEqual(retryDecision({ kind: "locator_ambiguous" }, 1), { retry: false, max_attempts: 2 });
});

test("cleanup failure writes truthful manual cleanup list and never claims success", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-cleanup-"));
  const result = await executeCleanup({
    runDir: directory,
    items: [
      {
        case_id: "CASE-001",
        data_id: "item-1",
        target_alias: "api",
        created_at: "2026-07-15T00:00:00.000Z",
        strategy: "cleanup.api",
      },
    ],
    execute: async () => {
      throw new Error("cleanup endpoint returned 500");
    },
  });

  assert.equal(result.status, "manual_required");
  assert.equal(result.manual.length, 1);
  const manual = JSON.parse(await readFile(path.join(directory, "manual-cleanup.json"), "utf8")) as unknown[];
  assert.equal(manual.length, 1);
  assert.match(JSON.stringify(manual), /cleanup endpoint returned 500/);
});

test("manifest cleanup actions run after a business failure instead of being skipped", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-cleanup-finally-"));
  const executed: string[] = [];
  const manifest: RunManifest = {
    protocol_version: "1.0.0",
    manifest_id: "cleanup-finally",
    runner: { version: "1.0.0" },
    source: { path: "report.json", sha256: "a".repeat(64) },
    cases: [{
      case_id: "CASE-001",
      original: {
        "用例 ID": "CASE-001", "所属模块": "cleanup", "用例标题": "cleanup after fail",
        "验证功能点": "cleanup", "前置条件": "", "测试步骤": "create then assert",
        "预期结果": "cleanup always", "优先级": "P0", "执行结果": "", "备注": "",
      },
      steps: [
        { type: "api.request", action_id: "create", target_alias: "api", method: "POST", path: "/items", risk: "R1" },
        { type: "api.assert", action_id: "assert", target_alias: "api", assertion: "status is 201", risk: "R0" },
        { type: "cleanup.api", action_id: "cleanup", target_alias: "api", method: "DELETE", path: "/items/1", risk: "R1" },
      ],
    }],
  };

  const result = await runApprovedManifest({
    manifest,
    outputDir: directory,
    executeAction: async (action) => {
      executed.push(action.action_id);
      return {
        action_id: action.action_id,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: action.type === "api.assert" ? "failed" : "passed",
        attachments: [],
        ...(action.type === "api.assert" ? { error: { type: "business_assertion_failed", message: "wrong status" } } : {}),
      };
    },
  });

  assert.deepEqual(executed, ["create", "assert", "cleanup"]);
  assert.equal(result.cases[0]?.case_status, "不通过");
});
