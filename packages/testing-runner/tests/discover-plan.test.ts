import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import ExcelJS from "exceljs";
import { chromium } from "playwright";
import { compilePackage, loadExecutionPackage } from "../../testing-contract-compiler/src/index.js";

import { sha256Canonical } from "../src/compiler/canonical-json.js";
import { runDiscoverPlanCommand } from "../src/commands/discover-plan.js";
import { bindLoginErrorFinalUrls } from "../src/commands/plan.js";
import { discoveryTaskId, planDiscoveryTasks } from "../src/discovery/discovery-task.js";
import * as discoveryReceiptRuntime from "../src/security/discovery-receipt.js";
import { discoveryCaseDirectoryName } from "../src/security/discovery-receipt.js";
import type { ManifestAction } from "../src/types.js";
import { startDemoApp } from "./fixtures/demo-app.js";

async function fixture(targetState: string, baseUrl: string, actions: ManifestAction[], approvalOptions: { approvedRisks?: string[]; approvedR3ActionIds?: string[] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "discover-plan-test-"));
  const input = path.join(root, "cases.xlsx");
  const packagePath = path.join(root, "cases.execution-package.zip");
  const profile = path.join(root, "profile.json");
  const output = path.join(root, ".testing-run");
  const approval = path.join(output, "discovery-approval.json");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("测试用例");
  sheet.addRow(["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "实际结果", "执行结果"]);
  sheet.addRow(["LOGIN-001", "登录", "登录", "登录", "匿名页", "进入目标页", "目标页可见", "P0", "", "未执行"]);
  await workbook.xlsx.writeFile(input);
  await compilePackage({ input, output: packagePath, overrides: { "LOGIN-001": { effects: { browser_state: { target_state: targetState }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } } });
  const casePlans = [...actions, { type: "web.assert", action_id: "assert-target", target_alias: "web", assertion: "url-contains=/", risk: "R0", source_step: "LOGIN-001-E1" } satisfies ManifestAction];
  await writeFile(profile, `${JSON.stringify({
    protocol_version: "1.0.0", profile_id: "discovery", targets: { web: { kind: "web", origin: baseUrl } }, credentials: {}, data: { username: "tester" }, case_plans: { "LOGIN-001": casePlans },
  }, null, 2)}\n`);
  await mkdir(output);
  const loaded = await loadExecutionPackage(packagePath);
  const now = new Date();
  await writeFile(approval, `${JSON.stringify({
    approval_schema_version: "1.0.0", approval_id: "discovery-approval", source_package_sha256: loaded.package_sha256,
    source_case_ids: ["LOGIN-001"], transition_case_id: "LOGIN-001", transition_actions_sha256: sha256Canonical(actions),
    target_origin: baseUrl, requested_url: `${baseUrl}/login`, page_state_id: targetState,
    approved_risks: approvalOptions.approvedRisks ?? ["R0"], approved_r3_action_ids: approvalOptions.approvedR3ActionIds ?? [], issued_by: "reviewer", issued_at: now.toISOString(), expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
  }, null, 2)}\n`);
  return { root, packagePath, profile, output, approval };
}

async function multiTargetFixture(baseUrl: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "discover-plan-multi-test-"));
  const input = path.join(root, "cases.xlsx");
  const packagePath = path.join(root, "cases.execution-package.zip");
  const profile = path.join(root, "profile.json");
  const output = path.join(root, ".testing-run");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("测试用例");
  sheet.addRow(["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "实际结果", "执行结果"]);
  sheet.addRow(["LOGIN-002", "登录", "登录成功", "成功状态", "匿名页", "进入工作台", "工作台可见", "P0", "", "未执行"]);
  sheet.addRow(["LOGIN-003", "登录", "登录失败", "失败状态", "匿名页", "返回登录页", "错误状态可见", "P0", "", "未执行"]);
  await workbook.xlsx.writeFile(input);
  await compilePackage({
    input,
    output: packagePath,
    overrides: {
      "LOGIN-002": {
        auth_profile: { id: "valid-user", strategy: "environment", credential_refs: {} },
        effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null },
      },
      "LOGIN-003": {
        auth_profile: { id: "invalid-password", strategy: "environment", credential_refs: {} },
        effects: { browser_state: { target_state: "login_error" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null },
      },
    },
  });
  const actionsByCase: Record<string, ManifestAction[]> = {
    "LOGIN-002": [{ type: "web.goto", action_id: "LOGIN-002-open", target_alias: "web", url: `${baseUrl}/items`, risk: "R0", source_step: "LOGIN-002-A1" }],
    "LOGIN-003": [{ type: "web.goto", action_id: "LOGIN-003-open", target_alias: "web", url: `${baseUrl}/login`, risk: "R0", source_step: "LOGIN-003-A1" }],
  };
  await writeFile(profile, `${JSON.stringify({
    protocol_version: "1.0.0",
    profile_id: "multi-discovery",
    targets: { web: { kind: "web", origin: baseUrl } },
    credentials: {},
    case_plans: {
      "LOGIN-002": [...actionsByCase["LOGIN-002"]!, { type: "web.assert", action_id: "LOGIN-002-target", target_alias: "web", assertion: "url-contains=/items", risk: "R0", source_step: "LOGIN-002-E1" }],
      "LOGIN-003": [...actionsByCase["LOGIN-003"]!, { type: "web.assert", action_id: "LOGIN-003-target", target_alias: "web", assertion: "url-contains=/login", risk: "R0", source_step: "LOGIN-003-E1" }],
    },
  }, null, 2)}\n`);
  await mkdir(output);
  const loaded = await loadExecutionPackage(packagePath);
  const now = new Date();
  const approvals: string[] = [];
  for (const [caseId, targetState] of [["LOGIN-002", "workspace"], ["LOGIN-003", "login_error"]] as const) {
    const approval = path.join(output, `discovery-approval-${caseId}.json`);
    const action = actionsByCase[caseId]!;
    await writeFile(approval, `${JSON.stringify({
      approval_schema_version: "1.0.0",
      approval_id: `discovery-approval-${caseId}`,
      source_package_sha256: loaded.package_sha256,
      source_case_ids: ["LOGIN-002", "LOGIN-003"],
      transition_case_id: caseId,
      transition_actions_sha256: sha256Canonical(action),
      target_origin: baseUrl,
      requested_url: action[0]!.type === "web.goto" ? action[0].url : baseUrl,
      page_state_id: targetState,
      approved_risks: ["R0"],
      approved_r3_action_ids: [],
      issued_by: "reviewer",
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
    }, null, 2)}\n`);
    approvals.push(approval);
  }
  return { root, packagePath, profile, output, approvals };
}

test("discover-plan executes the approved Runner web transition sequence", async (t) => {
  const app = await startDemoApp();
  const actions: ManifestAction[] = [
    { type: "web.goto", action_id: "goto-login", target_alias: "web", url: `${app.baseUrl}/login`, risk: "R0", source_step: "LOGIN-001-A1" },
    { type: "web.fill", action_id: "fill-username", target_alias: "web", locator: "label=Username", value_ref: { source: "fixture", name: "username" }, risk: "R0" },
    { type: "web.click", action_id: "submit-login", target_alias: "web", locator: "data-testid=login-submit", risk: "R0" },
    { type: "web.wait", action_id: "wait-items", target_alias: "web", condition: "url:**/items*", risk: "R0" },
  ];
  const f = await fixture("items", app.baseUrl, actions);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const result = await runDiscoverPlanCommand({ input: f.packagePath, profile: f.profile, outputDir: f.output, discoveryApproval: f.approval, transitionCaseId: "LOGIN-001", browser: "headless" });
  assert.equal(result.manifest.discovery_receipts?.[0]?.page_state_id, "items");
});

test("root redirect discovery binds login_error URL assertion to the real final /login URL", async (t) => {
  const app = await startDemoApp({ rootRedirectToLogin: true });
  const actions: ManifestAction[] = [
    { type: "web.goto", action_id: "goto-login", target_alias: "web", url: `${app.baseUrl}/`, risk: "R0", source_step: "LOGIN-001-A1" },
  ];
  const f = await fixture("login_error", app.baseUrl, actions);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const profile = JSON.parse(await readFile(f.profile, "utf8"));
  profile.case_plans["LOGIN-001"][1].assertion = `url=${app.baseUrl}/`;
  await writeFile(f.profile, `${JSON.stringify(profile, null, 2)}\n`);
  const approval = JSON.parse(await readFile(f.approval, "utf8"));
  approval.requested_url = `${app.baseUrl}/`;
  approval.transition_actions_sha256 = sha256Canonical(actions);
  await writeFile(f.approval, `${JSON.stringify(approval, null, 2)}\n`);

  const result = await runDiscoverPlanCommand({ input: f.packagePath, profile: f.profile, outputDir: f.output, discoveryApproval: f.approval, transitionCaseId: "LOGIN-001", browser: "headless" });
  const urlAssertions = result.manifest.cases[0]!.steps.filter((action) => action.type === "web.assert" && action.assertion.startsWith("url="));
  assert.equal(urlAssertions.length, 1);
  assert.equal(urlAssertions[0]!.type === "web.assert" ? urlAssertions[0]!.assertion : undefined, `url=${app.baseUrl}/login`);
  assert.equal(result.manifest.discovery_receipts?.[0]?.final_url, `${app.baseUrl}/login`);
  assert.equal(result.manifest.cases[0]!.execution_contract?.effects.identity_state, null);
});

test("one READY package with success and error target states returns two discovery tasks", async (t) => {
  const app = await startDemoApp();
  const f = await multiTargetFixture(app.baseUrl);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));

  const result = await runDiscoverPlanCommand({
    input: f.packagePath,
    profile: f.profile,
    outputDir: f.output,
    discoveryApproval: f.approvals,
    browser: "headless",
  });

  assert.deepEqual(result.discovery_tasks.map(({ source_case_id, target_state }) => ({ source_case_id, target_state })), [
    { source_case_id: "LOGIN-002", target_state: "workspace" },
    { source_case_id: "LOGIN-003", target_state: "login_error" },
  ]);
  assert.equal(new Set(result.discovery_tasks.map(({ discovery_task_id }) => discovery_task_id)).size, 2);
  assert.equal(result.manifest.discovery_receipts?.length, 2);
  for (const task of result.discovery_tasks) {
    assert.match(task.discovery_task_id, /^discovery-task-[a-f0-9]{32}$/);
    assert.match(task.transition_actions_sha256, /^[a-f0-9]{64}$/);
    assert.equal(task.package_sha256.length, 64);
    assert.equal(task.origin, app.baseUrl);
    assert.equal(task.isolation_scope, "case");
    assert.ok(task.required_auth_profile);
  }
  for (const reference of result.manifest.discovery_receipts ?? []) {
    const receiptBytes = await readFile(path.join(f.output, reference.receipt_path));
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    assert.equal(receipt.discovery_task_id, reference.discovery_task_id);
    assert.equal(receipt.source_case_id, reference.source_case_id);
    assert.equal(reference.receipt_sha256, createHash("sha256").update(receiptBytes).digest("hex"));
    assert.match(receipt.run_nonce, /^[a-f0-9]{64}$/);
    assert.equal(receipt.source_package_sha256, result.discovery_tasks[0]?.package_sha256);
    assert.equal(receipt.runner_version, "1.1.3");
    assert.equal(receipt.runtime_version, "1.0.3-dev");
    assert.match(receipt.page_fingerprint_sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(
    result.manifest.discovery_receipts?.map(({ discovery_task_id }) => discovery_task_id),
    result.discovery_tasks.map(({ discovery_task_id }) => discovery_task_id),
  );
});

test("success and error target states never deduplicate", async (t) => {
  const app = await startDemoApp();
  const f = await multiTargetFixture(app.baseUrl);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const loaded = await loadExecutionPackage(f.packagePath);
  const profile = JSON.parse(await readFile(f.profile, "utf8"));

  const tasks = planDiscoveryTasks({ contractCases: loaded.contract.cases, profile, packageSha256: loaded.package_sha256 });

  assert.deepEqual(tasks.map(({ target_state }) => target_state), ["workspace", "login_error"]);
  assert.equal(new Set(tasks.map(({ discovery_task_id }) => discovery_task_id)).size, 2);
});

test("identical transition and target state bindings deduplicate deterministically", async (t) => {
  const app = await startDemoApp();
  const f = await multiTargetFixture(app.baseUrl);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const loaded = await loadExecutionPackage(f.packagePath);
  const profile = JSON.parse(await readFile(f.profile, "utf8"));
  loaded.contract.cases[1]!.effects = structuredClone(loaded.contract.cases[0]!.effects);
  loaded.contract.cases[1]!.auth_profile = structuredClone(loaded.contract.cases[0]!.auth_profile);
  profile.case_plans["LOGIN-003"] = structuredClone(profile.case_plans["LOGIN-002"]);
  profile.case_plans["LOGIN-003"][0].action_id = "LOGIN-003-open";
  profile.case_plans["LOGIN-003"][0].source_step = "LOGIN-003-A1";

  const first = planDiscoveryTasks({ contractCases: loaded.contract.cases, profile, packageSha256: loaded.package_sha256 });
  const second = planDiscoveryTasks({ contractCases: loaded.contract.cases, profile, packageSha256: loaded.package_sha256 });

  assert.equal(first.length, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(first[0]?.source_case_ids, ["LOGIN-002", "LOGIN-003"]);
});

test("one deduplicated login_error receipt binds its final URL to every covered source case", () => {
  const manifest = {
    cases: ["LOGIN-SEQ-001", "LOGIN-SEQ-003"].map((caseId) => ({
      case_id: caseId,
      steps: [
        { type: "web.assert", action_id: `${caseId}-error`, assertion: "text-contains=用户名或密码错误" },
        { type: "web.assert", action_id: `${caseId}-login-page`, assertion: "url=https://example.test/" },
        { type: "web.assert", action_id: `${caseId}-form-visible`, assertion: "visible:css=input[name=username]" },
      ],
    })),
  } as never;
  const task = {
    discovery_task_id: "discovery-task-login-error",
    source_case_id: "LOGIN-SEQ-001",
    source_case_ids: ["LOGIN-SEQ-001", "LOGIN-SEQ-003"],
    target_state: "login_error",
  } as never;
  const receipt = {
    discovery_task_id: "discovery-task-login-error",
    source_case_id: "LOGIN-SEQ-001",
    case_id: "LOGIN-SEQ-001",
    page_state_id: "login_error",
    final_url: "https://example.test/login",
  } as never;
  const contractCases = ["LOGIN-SEQ-001", "LOGIN-SEQ-003"].map((caseId) => ({ case_id: caseId, source_case_id: caseId })) as never;

  bindLoginErrorFinalUrls(manifest, [receipt], [task], contractCases);

  for (const item of manifest.cases) {
    const assertions = item.steps.filter(({ assertion }) => assertion.startsWith("url="));
    assert.equal(assertions.length, 1);
    assert.equal(assertions[0]?.assertion, "url=https://example.test/login");
    assert.equal(item.steps.some(({ assertion }) => assertion === "text-contains=用户名或密码错误"), true);
    assert.equal(item.steps.some(({ assertion }) => assertion === "visible:css=input[name=username]"), true);
  }
});

test("discovery task identity separates start state and the full auth profile", async (t) => {
  const app = await startDemoApp();
  const f = await multiTargetFixture(app.baseUrl);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const loaded = await loadExecutionPackage(f.packagePath);
  const profile = JSON.parse(await readFile(f.profile, "utf8"));
  const firstCase = loaded.contract.cases[0]!;
  const secondCase = loaded.contract.cases[1]!;
  secondCase.effects = structuredClone(firstCase.effects);
  secondCase.start_state = structuredClone(firstCase.start_state);
  secondCase.auth_profile = structuredClone(firstCase.auth_profile);
  secondCase.isolation_scope = firstCase.isolation_scope;
  profile.case_plans[secondCase.case_id] = structuredClone(profile.case_plans[firstCase.case_id]);

  const baseline = planDiscoveryTasks({ contractCases: loaded.contract.cases, profile, packageSha256: loaded.package_sha256 });
  assert.equal(baseline.length, 1);

  secondCase.start_state = { ...firstCase.start_state, state_id: "different-anonymous-entry" };
  const differentStart = planDiscoveryTasks({ contractCases: loaded.contract.cases, profile, packageSha256: loaded.package_sha256 });
  assert.equal(differentStart.length, 2);

  secondCase.start_state = structuredClone(firstCase.start_state);
  secondCase.auth_profile = { ...firstCase.auth_profile, credential_refs: { username_env: "OTHER_USERNAME_ENV" } };
  const differentAccount = planDiscoveryTasks({ contractCases: loaded.contract.cases, profile, packageSha256: loaded.package_sha256 });
  assert.equal(differentAccount.length, 2);
  for (const task of differentAccount) {
    assert.match((task as any).start_state_sha256, /^[a-f0-9]{64}$/);
    assert.match((task as any).auth_profile_sha256, /^[a-f0-9]{64}$/);
  }

  secondCase.auth_profile = structuredClone(firstCase.auth_profile);
  firstCase.isolation_scope = "flow_group";
  secondCase.isolation_scope = "flow_group";
  firstCase.flow_group = "login-success-discovery";
  secondCase.flow_group = "login-error-discovery";
  const differentFlowGroups = planDiscoveryTasks({ contractCases: loaded.contract.cases, profile, packageSha256: loaded.package_sha256 });
  assert.equal(differentFlowGroups.length, 2);
});

test("discovery task ID binds every deterministic deduplication dimension", () => {
  const base = {
    packageSha256: "1".repeat(64),
    targetState: "workspace",
    transitionActionsSha256: "2".repeat(64),
    origin: "https://example.test",
    isolationScope: "case" as const,
    flowGroup: null,
    requiredAuthProfile: "valid-user",
    startStateSha256: "3".repeat(64),
    authProfileSha256: "4".repeat(64),
  };
  const baseline = discoveryTaskId(base);
  for (const changed of [
    { ...base, targetState: "login-error" },
    { ...base, transitionActionsSha256: "5".repeat(64) },
    { ...base, origin: "https://other.example.test" },
    { ...base, isolationScope: "flow_group" as const },
    { ...base, isolationScope: "flow_group" as const, flowGroup: "other-flow" },
    { ...base, requiredAuthProfile: "wrong-password-user", authProfileSha256: "6".repeat(64) },
    { ...base, startStateSha256: "7".repeat(64) },
  ]) assert.notEqual(discoveryTaskId(changed), baseline);
});

test("receipt quorum rejects duplicate, unknown, missing and extra task identities", () => {
  const validate = (discoveryReceiptRuntime as any).validateReceiptTaskQuorum;
  assert.equal(typeof validate, "function");
  const required = ["task-a", "task-b"];
  assert.deepEqual(validate(required, [
    { discovery_task_id: "task-b", receipt_path: "b.json" },
    { discovery_task_id: "task-a", receipt_path: "a.json" },
  ]).map((item: { receipt_path: string }) => item.receipt_path), ["a.json", "b.json"]);
  assert.throws(() => validate(required, [
    { discovery_task_id: "task-a", receipt_path: "a.json" },
    { discovery_task_id: "task-a", receipt_path: "a-copy.json" },
  ]), /duplicate_task_receipt:task-a/);
  assert.throws(() => validate(required, [
    { discovery_task_id: "task-a", receipt_path: "a.json" },
    { discovery_task_id: "task-unknown", receipt_path: "unknown.json" },
  ]), /unknown_task_receipt:task-unknown/);
  assert.throws(() => validate(required, [
    { discovery_task_id: "task-a", receipt_path: "a.json" },
  ]), /missing_task_receipt:task-b/);
  assert.throws(() => validate(required, [
    { discovery_task_id: "task-a", receipt_path: "a.json" },
    { discovery_task_id: "task-b", receipt_path: "b.json" },
    { discovery_task_id: "task-c", receipt_path: "c.json" },
  ]), /unknown_task_receipt:task-c/);
  assert.throws(() => validate(["task-a", "task-a"], [
    { discovery_task_id: "task-a", receipt_path: "a.json" },
  ]), /duplicate_required_task_id/);
});

test("each discovery task creates and closes a distinct BrowserContext", async (t) => {
  const app = await startDemoApp();
  const f = await multiTargetFixture(app.baseUrl);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const observed = new Set<object>();
  let closeCount = 0;

  await runDiscoverPlanCommand({
    input: f.packagePath,
    profile: f.profile,
    outputDir: f.output,
    discoveryApproval: f.approvals,
    browser: "headless",
    launchBrowser: async (options) => {
      const browser = await chromium.launch(options);
      const originalNewContext = browser.newContext.bind(browser);
      (browser as any).newContext = async (...args: unknown[]) => {
        const context = await originalNewContext(...args as Parameters<typeof originalNewContext>);
        observed.add(context);
        const originalClose = context.close.bind(context);
        (context as any).close = async () => { closeCount += 1; return originalClose(); };
        return context;
      };
      return browser;
    },
  });

  assert.equal(observed.size, 2);
  assert.equal(closeCount, 2);
  const records = JSON.parse(await readFile(path.join(f.output, "browser-contexts.json"), "utf8"));
  assert.equal(records.length, 2);
  assert.equal(new Set(records.map(({ context_id }: { context_id: string }) => context_id)).size, 2);
  assert.equal(records.every(({ phase, context_close_status, context_closed_at }: { phase: string; context_close_status: string; context_closed_at: string | null }) =>
    phase === "discovery" && context_close_status === "closed" && typeof context_closed_at === "string"), true);
  assert.deepEqual(records.map(({ discovery_task_id }: { discovery_task_id: string }) => discovery_task_id).sort(),
    (JSON.parse(await readFile(path.join(f.output, "discovery-tasks.json"), "utf8")).discovery_tasks as Array<{ discovery_task_id: string }>).map(({ discovery_task_id }) => discovery_task_id).sort());
});

test("missing any required task receipt rejects final manifest assembly", async (t) => {
  const app = await startDemoApp();
  const f = await multiTargetFixture(app.baseUrl);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));

  await assert.rejects(() => runDiscoverPlanCommand({
    input: f.packagePath,
    profile: f.profile,
    outputDir: f.output,
    discoveryApproval: f.approvals,
    browser: "headless",
    afterReceiptIssued: async (_page, task) => {
      if (task?.source_case_id !== "LOGIN-003") return;
      await rm(path.join(f.output, "discovery", discoveryCaseDirectoryName(task.transition_case_id), "discovery-receipt.json"));
    },
  }), /receipt_path_missing/);
  await assert.rejects(() => access(path.join(f.output, "run-manifest.json")), /ENOENT/);
});

test("a duplicate task receipt cannot replace another required task", async (t) => {
  const app = await startDemoApp();
  const f = await multiTargetFixture(app.baseUrl);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));

  await assert.rejects(() => runDiscoverPlanCommand({
    input: f.packagePath,
    profile: f.profile,
    outputDir: f.output,
    discoveryApproval: f.approvals,
    browser: "headless",
    afterReceiptIssued: async (_page, task) => {
      if (task?.source_case_id !== "LOGIN-003") return;
      const first = path.join(f.output, "discovery", discoveryCaseDirectoryName("LOGIN-002"), "discovery-receipt.json");
      const second = path.join(f.output, "discovery", discoveryCaseDirectoryName("LOGIN-003"), "discovery-receipt.json");
      await writeFile(second, await readFile(first));
    },
  }), /duplicate_task_receipt/);
  await assert.rejects(() => access(path.join(f.output, "run-manifest.json")), /ENOENT/);
});

test("an unknown receipt task ID is rejected before final manifest assembly", async (t) => {
  const app = await startDemoApp();
  const f = await multiTargetFixture(app.baseUrl);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));

  await assert.rejects(() => runDiscoverPlanCommand({
    input: f.packagePath,
    profile: f.profile,
    outputDir: f.output,
    discoveryApproval: f.approvals,
    browser: "headless",
    afterReceiptIssued: async (_page, task) => {
      if (task?.source_case_id !== "LOGIN-003") return;
      const receiptPath = path.join(f.output, "discovery", discoveryCaseDirectoryName("LOGIN-003"), "discovery-receipt.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      receipt.discovery_task_id = "discovery-task-ffffffffffffffffffffffffffffffff";
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    },
  }), /unknown_task_receipt/);
  await assert.rejects(() => access(path.join(f.output, "run-manifest.json")), /ENOENT/);
});

test("failed discovery task reports its task and case without forging a receipt", async (t) => {
  const app = await startDemoApp();
  const f = await multiTargetFixture(app.baseUrl);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const profile = JSON.parse(await readFile(f.profile, "utf8"));
  profile.case_plans["LOGIN-003"][0].url = `${app.baseUrl}/missing`;
  await writeFile(f.profile, `${JSON.stringify(profile, null, 2)}\n`);
  const approval = JSON.parse(await readFile(f.approvals[1]!, "utf8"));
  approval.requested_url = `${app.baseUrl}/missing`;
  approval.transition_actions_sha256 = sha256Canonical([profile.case_plans["LOGIN-003"][0]]);
  await writeFile(f.approvals[1]!, `${JSON.stringify(approval, null, 2)}\n`);

  await assert.rejects(() => runDiscoverPlanCommand({
    input: f.packagePath,
    profile: f.profile,
    outputDir: f.output,
    discoveryApproval: f.approvals,
    browser: "headless",
  }), /discovery_task_failed:discovery-task-[a-f0-9]{32}:LOGIN-003:transition_action_failed/);
  await assert.rejects(() => access(path.join(f.output, "discovery", discoveryCaseDirectoryName("LOGIN-003"), "discovery-receipt.json")), /ENOENT/);
  await assert.rejects(() => access(path.join(f.output, "run-manifest.json")), /ENOENT/);
});

test("final planning rejects mutation of the still-live page after receipt issuance", async (t) => {
  const app = await startDemoApp();
  const actions: ManifestAction[] = [
    { type: "web.goto", action_id: "goto-login", target_alias: "web", url: `${app.baseUrl}/login`, risk: "R0", source_step: "LOGIN-001-A1" },
  ];
  const f = await fixture("login", app.baseUrl, actions);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(() => runDiscoverPlanCommand({
    input: f.packagePath, profile: f.profile, outputDir: f.output, discoveryApproval: f.approval, transitionCaseId: "LOGIN-001", browser: "headless",
    afterReceiptIssued: async (page) => { await page.evaluate(() => { document.body.innerHTML = "<main>mutated after receipt</main>"; }); },
  }), /live_page_fingerprint_mismatch/);
});

test("transition actions cannot run without approval for their declared risk", async (t) => {
  const app = await startDemoApp();
  const actions: ManifestAction[] = [
    { type: "web.goto", action_id: "goto-login", target_alias: "web", url: `${app.baseUrl}/login`, risk: "R1", source_step: "LOGIN-001-A1" },
  ];
  const f = await fixture("login", app.baseUrl, actions);
  t.after(() => app.close());
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(() => runDiscoverPlanCommand({ input: f.packagePath, profile: f.profile, outputDir: f.output, discoveryApproval: f.approval, transitionCaseId: "LOGIN-001", browser: "headless" }), /approval_risk_missing_R1/);
});

for (const risk of ["R2", "R3"] as const) {
  test(`automatic discovery rejects ${risk} even when the transition is explicitly approved`, async (t) => {
    const app = await startDemoApp();
    const action: ManifestAction = { type: "web.goto", action_id: `goto-${risk.toLowerCase()}`, target_alias: "web", url: `${app.baseUrl}/login`, risk, source_step: "LOGIN-001-A1" };
    const f = await fixture("login", app.baseUrl, [action], { approvedRisks: [risk], approvedR3ActionIds: risk === "R3" ? [action.action_id] : [] });
    t.after(() => app.close());
    t.after(() => rm(f.root, { recursive: true, force: true }));
    await assert.rejects(() => runDiscoverPlanCommand({ input: f.packagePath, profile: f.profile, outputDir: f.output, discoveryApproval: f.approval, transitionCaseId: "LOGIN-001", browser: "headless" }), new RegExp(`automatic_discovery_risk_not_allowed_${risk}`));
  });
}
