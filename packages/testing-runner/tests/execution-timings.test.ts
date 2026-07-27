import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PhaseTimer } from "../src/runtime/execution-timings.js";
import { runApprovedManifest } from "../src/runtime/run-orchestrator.js";
import type { RunManifest } from "../src/types.js";

test("PhaseTimer uses injected monotonic time and leaves unexecuted phases null", () => {
  let now = 10;
  const timer = new PhaseTimer({ now: () => now });
  timer.start("execution_ms"); now = 42; timer.finish("execution_ms");
  assert.equal(timer.timings.execution_ms, 32);
  assert.equal(timer.states.execution_ms, "completed");
  assert.equal(timer.timings.report_ms, null);
  assert.equal(timer.states.report_ms, "not_executed");
  assert.deepEqual(timer.progress("report_ms", 2, "next"), { phase: "report_ms", progress: 1, elapsed_ms: 0, next_step: "next" });
});

test("run result, event log and projected overview persist the same measured execution duration", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "timing-run-"));
  let now = 100;
  const manifest = {
    protocol_version: "1.0.0", manifest_id: "timing", source: { path: "source.json", sha256: "a".repeat(64) },
    runner: { version: "1.0.0" }, cases: [{ case_id: "C1", original: { "用例 ID": "C1", "所属模块": "M", "用例标题": "T", "验证功能点": "F", "前置条件": "", "测试步骤": "", "预期结果": "ok", "优先级": "P1", "执行结果": "", "备注": "" }, steps: [{ action_id: "a", type: "api.assert", target_alias: "api", risk: "R0", assertion: "ok" }] }],
  } as unknown as RunManifest;
  const result = await runApprovedManifest({ manifest, outputDir, clock: { now: () => now }, executeAction: async () => { now += 25; return { status: "passed", actual: true, attachments: [] }; } });
  const persisted = JSON.parse(await readFile(path.join(outputDir, "run-timing", "run-result.json"), "utf8"));
  assert.equal(result.timings?.execution_ms, 25);
  assert.equal(persisted.timings.execution_ms, result.timings?.execution_ms);
  const log = await readFile(path.join(outputDir, "run-timing", "run-events.jsonl"), "utf8");
  assert.match(log, new RegExp(`"phase":"execution".*"duration_ms":${result.timings?.execution_ms}`));
});
