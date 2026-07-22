import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import JSZip from "jszip";
import { compilePackage, loadExecutionPackage } from "../../testing-contract-compiler/src/index.js";

import { executeAction } from "../src/actions/action-registry.js";
import { runDiscoverPlanCommand } from "../src/commands/discover-plan.js";
import { planDiscoveryTasks } from "../src/discovery/discovery-task.js";
import { openBrowserSession } from "../src/runtime/browser-session.js";
import { createExecutionContext, type ExecutionContext } from "../src/runtime/execution-context.js";
import { runApprovedManifest } from "../src/runtime/run-orchestrator.js";
import { resolveCredentials } from "../src/security/credential-resolver.js";
import type { ExecutionProfile } from "../src/types.js";
import { startDemoApp } from "./fixtures/demo-app.js";

test("LOGIN-SEQ Excel compiles through two discovery contexts and three fresh execution contexts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "login-sequence-integration-"));
  const username = "sequence-user";
  const password = "sequence-correct-password";
  const wrongPassword = "sequence-wrong-password";
  const app = await startDemoApp({ rootRedirectToLogin: true, sequenceLogin: { username, password } });
  t.after(() => app.close());
  t.after(() => rm(root, { recursive: true, force: true }));

  const fixtureRoot = path.resolve(import.meta.dirname, "../../../tests/fixtures/live-smoke");
  const packagePath = path.join(root, "login-seq.execution-package.zip");
  const profilePath = path.join(root, "sequence-execution-profile.json");
  const discoveryOutput = path.join(root, ".testing-run");
  await mkdir(discoveryOutput);
  await compilePackage({
    input: path.join(fixtureRoot, "login-seq.xlsx"),
    output: packagePath,
    overrides: JSON.parse(await readFile(path.join(fixtureRoot, "sequence-contract-overrides.json"), "utf8")),
  });
  const profile = JSON.parse(await readFile(path.join(fixtureRoot, "sequence-execution-profile.json"), "utf8")) as ExecutionProfile;
  profile.targets.workbench = { kind: "web", origin: app.baseUrl };
  profile.credentials.username!.name = "LOGIN_SEQUENCE_TEST_USERNAME";
  profile.credentials.password!.name = "LOGIN_SEQUENCE_TEST_PASSWORD";
  profile.credentials.wrong_password!.name = "LOGIN_SEQUENCE_TEST_WRONG_PASSWORD";
  for (const actions of Object.values(profile.case_plans ?? {})) {
    for (const action of actions) {
      if (action.type === "web.goto") action.url = `${app.baseUrl}/`;
      if (action.type === "web.assert" && action.assertion.startsWith("url=")) action.assertion = `url=${app.baseUrl}/`;
    }
  }
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");

  const env = {
    ...process.env,
    LOGIN_SEQUENCE_TEST_USERNAME: username,
    LOGIN_SEQUENCE_TEST_PASSWORD: password,
    LOGIN_SEQUENCE_TEST_WRONG_PASSWORD: wrongPassword,
  };
  Object.assign(process.env, {
    LOGIN_SEQUENCE_TEST_USERNAME: username,
    LOGIN_SEQUENCE_TEST_PASSWORD: password,
    LOGIN_SEQUENCE_TEST_WRONG_PASSWORD: wrongPassword,
  });
  t.after(() => {
    delete process.env.LOGIN_SEQUENCE_TEST_USERNAME;
    delete process.env.LOGIN_SEQUENCE_TEST_PASSWORD;
    delete process.env.LOGIN_SEQUENCE_TEST_WRONG_PASSWORD;
  });
  const loaded = await loadExecutionPackage(packagePath);
  const tasks = planDiscoveryTasks({ contractCases: loaded.contract.cases, profile, packageSha256: loaded.package_sha256 });
  assert.deepEqual(tasks.map(({ target_state, source_case_ids }) => ({ target_state, source_case_ids })), [
    { target_state: "login_error", source_case_ids: ["LOGIN-SEQ-001", "LOGIN-SEQ-003"] },
    { target_state: "workspace", source_case_ids: ["LOGIN-SEQ-002"] },
  ]);

  const now = new Date();
  const approvals: string[] = [];
  for (const task of tasks) {
    const approvalPath = path.join(discoveryOutput, `${task.discovery_task_id}.approval.json`);
    await writeFile(approvalPath, `${JSON.stringify({
      approval_schema_version: "1.0.0",
      approval_id: `approval-${task.discovery_task_id}`,
      source_package_sha256: loaded.package_sha256,
      source_case_ids: loaded.contract.cases.map(({ source_case_id }) => source_case_id),
      transition_case_id: task.transition_case_id,
      transition_actions_sha256: task.transition_actions_sha256,
      target_origin: task.origin,
      requested_url: task.requested_url,
      page_state_id: task.target_state,
      approved_risks: ["R0", "R1"],
      approved_r3_action_ids: [],
      issued_by: "integration-test",
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");
    approvals.push(approvalPath);
  }

  const planned = await runDiscoverPlanCommand({
    input: packagePath,
    profile: profilePath,
    outputDir: discoveryOutput,
    discoveryApproval: approvals,
    browser: "headless",
  });
  const discoveryContexts = JSON.parse(await readFile(path.join(discoveryOutput, "browser-contexts.json"), "utf8"));
  assert.equal(discoveryContexts.length, 2);
  assert.equal(new Set(discoveryContexts.map(({ context_id }: { context_id: string }) => context_id)).size, 2);
  assert.equal(discoveryContexts.every(({ phase, context_reused }: { phase: string; context_reused: boolean }) => phase === "discovery" && !context_reused), true);
  for (const caseId of ["LOGIN-SEQ-001", "LOGIN-SEQ-003"]) {
    const item = planned.manifest.cases.find(({ case_id }) => case_id === caseId)!;
    assert.equal(item.steps.find((action) => action.type === "web.assert" && action.assertion.startsWith("url="))?.assertion, `url=${app.baseUrl}/login`);
  }

  const secrets = resolveCredentials(Object.entries(profile.credentials).map(([alias, ref]) => ({
    alias, source: "configured_env" as const, name: ref.name,
  })), env);
  const executionOutput = path.join(root, "execution");
  const session = await openBrowserSession({
    manifest: planned.manifest,
    mode: "ci",
    outputDir: executionOutput,
    traceRedactionFingerprints: secrets.fingerprints(),
  });
  let executionContext: ExecutionContext | undefined;
  const result = await runApprovedManifest({
    manifest: planned.manifest,
    outputDir: executionOutput,
    beforeCase: async (item) => {
      const page = await session!.prepareCase(item.case_id, { isolationScope: "case", flowGroup: null });
      executionContext = createExecutionContext({ targets: profile.targets, approvedOrigins: [app.baseUrl], secrets, page, mode: "ci" });
    },
    executeAction: async (action) => executeAction(action, executionContext!),
  });
  await session!.close();
  const executionContexts = session!.contextRecords();
  const tracePaths = await session!.finalizeTraces();
  assert.deepEqual(result.cases.map(({ case_id, case_status }) => ({ case_id, case_status })), [
    { case_id: "LOGIN-SEQ-001", case_status: "通过" },
    { case_id: "LOGIN-SEQ-002", case_status: "通过" },
    { case_id: "LOGIN-SEQ-003", case_status: "通过" },
  ]);
  assert.equal(executionContexts.length, 3);
  assert.equal(new Set(executionContexts.map(({ context_id }) => context_id)).size, 3);
  assert.equal(executionContexts.every(({ phase, context_reused }) => phase === "execution" && !context_reused), true);
  const allContextIds = [...discoveryContexts.map(({ context_id }: { context_id: string }) => context_id), ...executionContexts.map(({ context_id }) => context_id)];
  assert.equal(new Set(allContextIds).size, 5);
  assert.equal(tracePaths.length, 3);
  for (const tracePath of tracePaths) {
    const trace = await JSZip.loadAsync(await readFile(tracePath), { checkCRC32: true });
    assert.ok(trace.file("trace.trace"));
    const contents = await Promise.all(Object.values(trace.files).filter((entry) => !entry.dir).map((entry) => entry.async("nodebuffer")));
    const expanded = Buffer.concat(contents);
    assert.equal(expanded.includes(Buffer.from(password)), false);
    assert.equal(expanded.includes(Buffer.from(wrongPassword)), false);
  }
});
