import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeCleanup } from "../src/runtime/cleanup-manager.js";
import { retryDecision } from "../src/runtime/retry-policy.js";

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
