import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TEN_COLUMNS } from "../src/input/detect-input.js";
import { normalizeRunCliOptions, runCli } from "../src/cli.js";
import { persistManualRequiredResult, resolveSmokeNetworkOrigin } from "../src/commands/run.js";
import { createApproval } from "../src/security/approval.js";
import type { ExecutionProfile, ManifestAction, RunManifest, RunManifestCase, RunResult } from "../src/types.js";
import { startDemoApp } from "./fixtures/demo-app.js";

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function originalCase(caseId: string, title: string): RunManifestCase["original"] {
  const values = [caseId, "api", title, "API execution", "", "run API action", "status is expected", "P0", "未执行", ""];
  return Object.fromEntries(TEN_COLUMNS.map((column, index) => [column, values[index] ?? ""])) as RunManifestCase["original"];
}

function reportFor(caseId: string, title: string) {
  const original = originalCase(caseId, title);
  return {
    title: "CLI report",
    generated_at: "2026-07-15T00:00:00.000Z",
    skill_invocation: "web-api-test-execution-evidence",
    sheets: [
      {
        name: "Cases",
        kind: "test_cases",
        columns: [...TEN_COLUMNS],
        rows: [{ values: TEN_COLUMNS.map((column) => original[column]) }],
      },
    ],
  };
}

function manifest(input: {
  sourcePath: string;
  sourceHash: string;
  origin: string;
  caseId: string;
  title: string;
  actions: ManifestAction[];
}): RunManifest {
  return {
    protocol_version: "1.0.0",
    manifest_id: `manifest-${input.caseId}`,
    runner: { version: "1.0.0" },
    source: { path: input.sourcePath, sha256: input.sourceHash },
    targets: [input.origin as `http://${string}`],
    rule_versions: ["1.0.0"],
    cases: [
      {
        case_id: input.caseId,
        original: originalCase(input.caseId, input.title),
        steps: input.actions,
      },
    ],
  };
}

async function fixture(input: {
  directory: string;
  origin: string;
  caseId: string;
  title: string;
  actions: ManifestAction[];
  data?: Record<string, unknown>;
  credentials?: ExecutionProfile["credentials"];
  targetKind?: "api" | "web";
  discoveryReceipts?: RunManifest["discovery_receipts"];
}) {
  const sourcePath = path.join(input.directory, "report.json");
  const report = reportFor(input.caseId, input.title);
  const sourceJson = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(sourcePath, sourceJson, "utf8");

  const runManifest = manifest({
    sourcePath,
    sourceHash: sha256(sourceJson),
    origin: input.origin,
    caseId: input.caseId,
    title: input.title,
    actions: input.actions,
  });
  if (input.discoveryReceipts) runManifest.discovery_receipts = input.discoveryReceipts;
  const approval = createApproval({
    manifest: runManifest,
    issued_by: "cli-test",
    issued_at: "2026-07-15T00:00:00.000Z",
    expires_at: "2999-01-01T00:00:00.000Z",
    approved_risks: ["R0", "R1"],
    approved_r3_action_ids: [],
  });
  const profile: ExecutionProfile & { data?: Record<string, unknown> } = {
    protocol_version: "1.0.0",
    profile_id: "cli-test",
    targets: input.targetKind === "web"
      ? { web: { kind: "web", origin: input.origin as `http://${string}` } }
      : { api: { kind: "api", origin: input.origin as `http://${string}` } },
    credentials: input.credentials ?? {},
    data: input.data ?? {},
  };

  const manifestPath = path.join(input.directory, "run-manifest.json");
  const approvalPath = path.join(input.directory, "approval.json");
  await writeJson(manifestPath, runManifest);
  await writeJson(approvalPath, approval);
  await writeJson(path.join(input.directory, "execution-profile.normalized.json"), profile);
  return { manifestPath, approvalPath };
}

async function runTestingRunner(args: string[]): Promise<number> {
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    await runCli(["node", "testing-runner", ...args]);
    return Number(process.exitCode ?? 0);
  } finally {
    process.exitCode = previous;
  }
}

test("run CLI preserves visible browser settings and custom slow motion", () => {
  assert.deepEqual(
    normalizeRunCliOptions({
      manifest: "run-manifest.json",
      approval: "approval.json",
      outputDir: "result",
      mode: "interactive",
      browser: "visible",
      slowMo: "350",
    }),
    {
      manifest: "run-manifest.json",
      approval: "approval.json",
      outputDir: "result",
      mode: "interactive",
      browser: "visible",
      slowMo: 350,
      progress: "auto",
    },
  );
});

test("run CLI accepts progress off and rejects unsupported progress modes", () => {
  assert.equal(normalizeRunCliOptions({
    manifest: "run-manifest.json",
    approval: "approval.json",
    outputDir: "result",
    mode: "interactive",
    browser: "visible",
    slowMo: "200",
    progress: "off",
  }).progress, "off");

  assert.throws(
    () => normalizeRunCliOptions({
      manifest: "run-manifest.json",
      approval: "approval.json",
      outputDir: "result",
      mode: "interactive",
      browser: "visible",
      slowMo: "200",
      progress: "verbose",
    }),
    /progress_configuration_invalid: progress must be auto or off/,
  );
});

test("run CLI rejects invalid browser visibility", () => {
  assert.throws(
    () => normalizeRunCliOptions({
      manifest: "run-manifest.json",
      approval: "approval.json",
      outputDir: "result",
      mode: "interactive",
      browser: "background",
      slowMo: "200",
    }),
    /browser_configuration_invalid: browser must be auto, visible, or headless/,
  );
});

test("run CLI rejects invalid slow motion before execution", () => {
  assert.throws(
    () => normalizeRunCliOptions({
      manifest: "run-manifest.json",
      approval: "approval.json",
      outputDir: "result",
      mode: "ci",
      browser: "auto",
      slowMo: "12.5",
    }),
    /browser_configuration_invalid: slow-mo must be an integer from 0 to 5000/,
  );
});

test("run CLI rejects an invalid execution mode", () => {
  assert.throws(
    () => normalizeRunCliOptions({
      manifest: "run-manifest.json",
      approval: "approval.json",
      outputDir: "result",
      mode: "batch",
      browser: "auto",
      slowMo: "200",
    }),
    /run_configuration_invalid: mode must be interactive or ci/,
  );
});

test("smoke network origin must be the one exact loopback manifest and profile target", () => {
  const origin = "http://127.0.0.1:43123" as const;
  const runManifest = {
    targets: [origin],
  } as unknown as RunManifest;
  const profile = {
    targets: { fixture: { kind: "web", origin } },
  } as unknown as ExecutionProfile;

  assert.equal(resolveSmokeNetworkOrigin(runManifest, profile, {
    TESTING_RUNNER_SMOKE_ALLOWED_ORIGIN: origin,
  }), origin);
  assert.throws(() => resolveSmokeNetworkOrigin(runManifest, profile, {
    TESTING_RUNNER_SMOKE_ALLOWED_ORIGIN: "http://127.0.0.1:43124",
  }), /smoke.*origin.*manifest.*profile|target.*mismatch/i);
  assert.throws(() => resolveSmokeNetworkOrigin(runManifest, profile, {
    TESTING_RUNNER_SMOKE_ALLOWED_ORIGIN: "https://example.com",
  }), /loopback|127\.0\.0\.1/i);
});

test("run command writes run result plus Excel and HTML for a passing approved API flow", async () => {
  const app = await startDemoApp();
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-cli-pass-"));
  const outputDir = path.join(directory, "out");
  try {
    const { manifestPath, approvalPath } = await fixture({
      directory,
      origin: app.baseUrl,
      caseId: "CLI-001",
      title: "pass",
      data: { item_payload: { name: "CLI item" } },
      actions: [
        { type: "api.request", action_id: "CLI-001-create", target_alias: "api", method: "POST", path: "/api/items", input_ref: { source: "fixture", name: "item_payload" }, risk: "R1" },
        { type: "api.extract", action_id: "CLI-001-extract", target_alias: "api", from: "/body/id", as: "item_id", risk: "R0" },
        { type: "api.request", action_id: "CLI-001-read", target_alias: "api", method: "GET", path: "/api/items/{{item_id}}", risk: "R0" },
        { type: "api.assert", action_id: "CLI-001-assert", target_alias: "api", assertion: "status is 200", risk: "R0" },
      ],
    });

    const exitCode = await runTestingRunner(["run", "--manifest", manifestPath, "--approval", approvalPath, "--output-dir", outputDir, "--mode", "ci"]);

    assert.equal(exitCode, 0);
    const result = await readJson<RunResult>(path.join(outputDir, "run-result.json"));
    assert.equal(result.run_status, "completed");
    assert.equal(result.cases[0]?.case_status, "通过");
    assert.ok(await readFile(path.join(outputDir, "result.xlsx")));
    assert.match(await readFile(path.join(outputDir, "result.html"), "utf8"), /CLI-001/);
  } finally {
    await app.close();
  }
});

test("run command returns business-failure exit code while still writing reports", async () => {
  const app = await startDemoApp();
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-cli-fail-"));
  const outputDir = path.join(directory, "out");
  try {
    const { manifestPath, approvalPath } = await fixture({
      directory,
      origin: app.baseUrl,
      caseId: "CLI-002",
      title: "fail",
      actions: [
        { type: "api.request", action_id: "CLI-002-read", target_alias: "api", method: "GET", path: "/api/items/missing", risk: "R0" },
        { type: "api.assert", action_id: "CLI-002-assert", target_alias: "api", assertion: "status is 200", risk: "R0" },
      ],
    });

    const exitCode = await runTestingRunner(["run", "--manifest", manifestPath, "--approval", approvalPath, "--output-dir", outputDir, "--mode", "ci"]);

    assert.equal(exitCode, 10);
    const result = await readJson<RunResult>(path.join(outputDir, "run-result.json"));
    assert.equal(result.cases[0]?.case_status, "不通过");
    assert.ok(await readFile(path.join(outputDir, "result.xlsx")));
    assert.match(await readFile(path.join(outputDir, "result.html"), "utf8"), /CLI-002/);
  } finally {
    await app.close();
  }
});

test("run command returns blocked exit code and writes an audit result when CI secrets are missing", async () => {
  const app = await startDemoApp();
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-cli-secret-"));
  const outputDir = path.join(directory, "out");
  try {
    const { manifestPath, approvalPath } = await fixture({
      directory,
      origin: app.baseUrl,
      caseId: "CLI-003",
      title: "missing secret",
      credentials: { api_token: { source: "env", name: "TESTING_RUNNER_MISSING_TOKEN" } },
      actions: [
        { type: "api.request", action_id: "CLI-003-read", target_alias: "api", method: "GET", path: "/api/items/missing", risk: "R0" },
      ],
    });

    const exitCode = await runTestingRunner(["run", "--manifest", manifestPath, "--approval", approvalPath, "--output-dir", outputDir, "--mode", "ci"]);

    assert.equal(exitCode, 20);
    const result = await readJson<RunResult>(path.join(outputDir, "run-result.json"));
    assert.equal(result.run_status, "blocked");
    assert.equal(result.cases[0]?.case_status, "未执行");
    assert.match(await readFile(path.join(outputDir, "result.html"), "utf8"), /CLI-003/);
  } finally {
    await app.close();
  }
});

test("formal execution combines closed discovery contexts with fresh execution contexts", async () => {
  const app = await startDemoApp();
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-context-phases-"));
  const outputDir = path.join(directory, "out");
  try {
    const discoveryTaskId = "discovery-task-11111111111111111111111111111111";
    const { manifestPath, approvalPath } = await fixture({
      directory,
      origin: app.baseUrl,
      caseId: "WEB-001",
      title: "phase isolation",
      targetKind: "web",
      discoveryReceipts: [{
        discovery_task_id: discoveryTaskId,
        source_case_id: "WEB-001",
        case_id: "WEB-001",
        page_state_id: "items",
        discovery_id: "discovery-one",
        receipt_path: "discovery/case-one/discovery-receipt.json",
        receipt_sha256: "1".repeat(64),
      }],
      actions: [
        { type: "web.goto", action_id: "WEB-001-open", target_alias: "web", url: `${app.baseUrl}/items`, risk: "R0" },
        { type: "web.assert", action_id: "WEB-001-assert", target_alias: "web", assertion: "url-contains=/items", risk: "R0" },
      ],
    });
    await writeJson(path.join(directory, "browser-contexts.json"), [{
      phase: "discovery",
      discovery_task_id: discoveryTaskId,
      case_id: "WEB-001",
      browser_id: "discovery-browser",
      context_id: "discovery-context",
      context_created_at: "2026-07-21T00:00:00.000Z",
      context_closed_at: "2026-07-21T00:00:01.000Z",
      context_close_status: "closed",
      context_reused: false,
      isolation_scope: "case",
      flow_group: null,
    }]);

    const exitCode = await runTestingRunner(["run", "--manifest", manifestPath, "--approval", approvalPath, "--output-dir", outputDir, "--mode", "ci", "--browser", "headless"]);

    assert.equal(exitCode, 0);
    const records = await readJson<Array<{ phase: string; context_id: string; context_close_status: string }>>(path.join(outputDir, "browser-contexts.json"));
    assert.deepEqual(records.map(({ phase }) => phase), ["discovery", "execution"]);
    assert.equal(new Set(records.map(({ context_id }) => context_id)).size, 2);
    assert.equal(records.every(({ context_close_status }) => context_close_status === "closed"), true);
  } finally {
    await app.close();
  }
});

test("manual-required persistence keeps authoritative JSON artifacts when Trace finalization fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-manual-trace-failure-"));
  const sourcePath = path.join(directory, "report.json");
  const sourceJson = `${JSON.stringify(reportFor("MANUAL-001", "manual handoff"), null, 2)}\n`;
  await writeFile(sourcePath, sourceJson, "utf8");
  const runManifest = manifest({
    sourcePath,
    sourceHash: sha256(sourceJson),
    origin: "https://example.test",
    caseId: "MANUAL-001",
    title: "manual handoff",
    actions: [{ type: "web.assert", action_id: "MANUAL-001-assert", target_alias: "web", assertion: "url=https://example.test/", risk: "R0" }],
  });
  const contextRecords = [{
    phase: "execution" as const,
    case_id: "MANUAL-001",
    browser_id: "browser-1",
    context_id: "context-1",
    context_created_at: "2026-07-21T00:00:00.000Z",
    context_closed_at: null,
    context_close_status: "open" as const,
    context_reused: false,
    isolation_scope: "case" as const,
    flow_group: null,
  }];

  const result = await persistManualRequiredResult({
    outputDir: directory,
    manifest: runManifest,
    reason: "manual credential handoff required",
    finalizeTraces: async () => { throw new Error("trace-finalize-failed"); },
    contextRecords: () => contextRecords,
  });

  assert.equal(result.run_status, "manual_required");
  assert.equal((await readJson<RunResult>(path.join(directory, "run-result.json"))).run_status, "manual_required");
  assert.deepEqual(await readJson(path.join(directory, "browser-contexts.json")), contextRecords);
});
