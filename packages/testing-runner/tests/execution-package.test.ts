import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { compilePackage, loadExecutionPackage, validatePackage } from "../../testing-contract-compiler/src/index.js";
import { runApproveCommand } from "../src/commands/approve.js";
import { runPlanCommand } from "../src/commands/plan.js";
import { runRunCommand } from "../src/commands/run.js";
import { EXIT_UNSAFE_OR_INVALID } from "../src/runtime/exit-codes.js";
import { projectExecutionReport } from "../src/reporting/report-projector.js";
import { runApprovedManifest } from "../src/runtime/run-orchestrator.js";
import { validateDocument } from "../src/schema-registry.js";
import { sha256Canonical } from "../src/compiler/canonical-json.js";
import * as discoveryReceiptRuntime from "../src/security/discovery-receipt.js";

async function setup(expected = "工作台可见") {
  const root = await mkdtemp(path.join(os.tmpdir(), "runner-package-test-"));
  const input = path.join(root, "cases.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("测试用例");
  sheet.addRow(["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "实际结果", "执行结果"]);
  sheet.addRow(["LOGIN-001", "登录", "登录", "登录", "匿名登录页", "提交有效凭据", expected, "P0", "", "未执行"]);
  await workbook.xlsx.writeFile(input);
  return { root, input, package: path.join(root, "cases.execution-package.zip"), profile: path.join(root, "profile.json"), output: path.join(root, ".testing-run") };
}

async function writeProfile(file: string, options: { mapAssertion?: boolean; discovered?: boolean } = {}) {
  const actions = [
    { type: "web.goto", action_id: "goto-login", target_alias: "web", url: "https://example.test/login", risk: "R0", source_step: "LOGIN-001-A1" },
  ];
  if (options.mapAssertion !== false) actions.push({ type: "web.assert", action_id: "assert-workspace", target_alias: "web", assertion: "text includes 测试工作台", risk: "R0", source_step: "LOGIN-001-E1" } as never);
  await writeFile(file, JSON.stringify({
    protocol_version: "1.0.0", profile_id: "bound", targets: { web: { kind: "web", origin: "https://example.test" } }, credentials: {},
    rule_versions: options.discovered === false ? ["1.0.0"] : ["1.0.0", "target-state:LOGIN-001:workspace"],
    case_plans: { "LOGIN-001": actions },
  }, null, 2));
}

const DISCOVERY_APPROVAL_REFERENCE = "approval-target-state-workspace";
const RECEIPT_NOW = new Date("2026-07-21T00:00:00.000Z");
const DEFAULT_TRANSITION_ACTIONS = [{
  type: "web.goto" as const, action_id: "goto-login", target_alias: "web", url: "https://example.test/login" as const, risk: "R0" as const, source_step: "LOGIN-001-A1",
}];

function discoveryCaseDirectory(caseId: string): string {
  return `case-${createHash("sha256").update(caseId, "utf8").digest("hex")}`;
}

function fakeDiscoveryPage(url = "https://example.test/workspace", dom = "<html><body>workspace</body></html>") {
  return {
    url: () => url,
    title: async () => "Workspace",
    content: async () => dom,
    locator: (selector: string) => selector === "body"
      ? { ariaSnapshot: async () => "- main: workspace" }
      : { evaluateAll: async () => [] },
  } as never;
}

async function writeDiscoveryApproval(
  f: Awaited<ReturnType<typeof setup>>,
  packageSha256: string,
  transitionActions = DEFAULT_TRANSITION_ACTIONS as never[],
  overrides: Record<string, unknown> = {},
  now = RECEIPT_NOW,
): Promise<string> {
  await mkdir(f.output, { recursive: true });
  const approvalPath = path.join(f.output, "discovery-approval.json");
  await writeFile(approvalPath, `${JSON.stringify({
    approval_schema_version: "1.0.0",
    approval_id: DISCOVERY_APPROVAL_REFERENCE,
    source_package_sha256: packageSha256,
    source_case_ids: ["LOGIN-001"],
    transition_case_id: "LOGIN-001",
    transition_actions_sha256: sha256Canonical(transitionActions),
    target_origin: "https://example.test",
    requested_url: "https://example.test/login",
    page_state_id: "workspace",
    approved_risks: [...new Set(transitionActions.map((action: any) => action.risk))],
    approved_r3_action_ids: transitionActions.filter((action: any) => action.risk === "R3").map((action: any) => action.action_id),
    issued_by: "reviewer",
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
    ...overrides,
  }, null, 2)}\n`, "utf8");
  return approvalPath;
}

async function issueLiveReceipt(
  f: Awaited<ReturnType<typeof setup>>,
  transitionActions = DEFAULT_TRANSITION_ACTIONS as never[],
  now = RECEIPT_NOW,
  page = fakeDiscoveryPage(),
  pageStateId = "workspace",
) {
  const loaded = await loadExecutionPackage(f.package);
  const contractCase = loaded.contract.cases[0]!;
  const authProfileId = typeof contractCase.auth_profile.id === "string" ? contractCase.auth_profile.id : null;
  const session = await (discoveryReceiptRuntime as any).createActiveRuntimeSession(f.output, now);
  const firstAction = transitionActions[0] as { type?: string; url?: string } | undefined;
  const requestedUrl = firstAction?.type === "web.goto" && firstAction.url ? firstAction.url : "https://example.test/login";
  const approval = await writeDiscoveryApproval(f, loaded.package_sha256, transitionActions, {
    requested_url: requestedUrl,
    page_state_id: pageStateId,
  }, now);
  const issued = await (discoveryReceiptRuntime as any).discoverAndIssueReceipt({
    session,
    page,
    packageSha256: loaded.package_sha256,
    sourceCaseIds: ["LOGIN-001"],
    sourceCaseId: contractCase.source_case_id,
    isolationScope: contractCase.isolation_scope,
    flowGroup: contractCase.flow_group,
    requiredAuthProfile: authProfileId,
    startState: contractCase.start_state,
    authProfile: contractCase.auth_profile,
    transitionCaseId: "LOGIN-001",
    transitionActions,
    targetOrigin: "https://example.test",
    requestedUrl,
    pageStateId,
    approvalPath: approval,
    now,
  });
  return { session, approval, ...issued };
}

test("binds a login-error URL assertion to the discovery receipt final URL", async (t) => {
  const f = await setup("错误登录后仍在登录页");
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const transitionActions = [{
    type: "web.goto", action_id: "goto-login", target_alias: "web", url: "https://example.test/", risk: "R0", source_step: "LOGIN-001-A1",
  }] as const;
  await compilePackage({
    input: f.input,
    output: f.package,
    overrides: {
      "LOGIN-001": {
        effects: { browser_state: { target_state: "login_error" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null },
      },
    },
  });
  await writeFile(f.profile, `${JSON.stringify({
    protocol_version: "1.0.0",
    profile_id: "login-error-url-binding",
    targets: { web: { kind: "web", origin: "https://example.test" } },
    credentials: {},
    case_plans: {
      "LOGIN-001": [
        ...transitionActions,
        { type: "web.assert", action_id: "assert-login-page", target_alias: "web", assertion: "url=https://example.test/", risk: "R0", source_step: "LOGIN-001-E1" },
      ],
    },
  }, null, 2)}\n`);
  const issued = await issueLiveReceipt(
    f,
    transitionActions as never[],
    RECEIPT_NOW,
    fakeDiscoveryPage("https://example.test/login", "<html><body><form>login error</form></body></html>"),
    "login_error",
  );

  const result = await runPlanCommand({
    input: f.package,
    profile: f.profile,
    outputDir: f.output,
    discoveryReceipts: [issued.receiptPath],
    discoveryApproval: issued.approval,
    runtimeSession: issued.session,
    now: RECEIPT_NOW,
  });

  const assertion = result.manifest.cases[0]!.steps.find(({ action_id }) => action_id === "assert-login-page");
  assert.equal(assertion?.type, "web.assert");
  assert.equal(assertion?.type === "web.assert" ? assertion.assertion : undefined, "url=https://example.test/login");
  assert.equal(result.manifest.discovery_receipts?.[0]?.page_state_id, "login_error");
});

async function writeIssuedDiscoveryReceipt(
  f: Awaited<ReturnType<typeof setup>>,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const discoveryDir = path.join(f.output, "discovery");
  await mkdir(discoveryDir, { recursive: true });
  const generatedAt = String(overrides.generated_at ?? RECEIPT_NOW.toISOString());
  const expiresAt = String(overrides.expires_at ?? new Date(RECEIPT_NOW.getTime() + 10 * 60_000).toISOString());
  const artifact = {
    url: String(overrides.final_url ?? "https://example.test/workspace"),
    title: "Workspace",
    discovered_at: generatedAt,
    requires_user_confirmation: true,
    interaction_policy: "read-only-dom-and-accessibility",
    dom_sha256: "1".repeat(64),
    accessibility_sha256: "2".repeat(64),
    elements: [],
  };
  const artifactPath = path.join(discoveryDir, "web-discovery.json");
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(artifactPath, artifactBytes);
  const loaded = await loadExecutionPackage(f.package);
  const transitionActions = Array.isArray(overrides.transition_actions) ? overrides.transition_actions : [{
    type: "web.goto", action_id: "goto-login", target_alias: "web", url: "https://example.test/login", risk: "R0", source_step: "LOGIN-001-A1",
  }];
  const runNonce = String(overrides.run_nonce ?? randomBytes(32).toString("hex"));
  const sessionRunNonce = String(overrides.session_run_nonce ?? runNonce);
  const receipt = {
    receipt_schema_version: "1.0.0",
    run_nonce: runNonce,
    discovery_id: "discovery-login-001-workspace",
    generated_by: "@saitamasans/testing-runtime",
    runtime_version: "1.0.3-dev",
    runner_version: "1.1.3",
    target_origin: String(overrides.target_origin ?? "https://example.test"),
    requested_url: "https://example.test/login",
    final_url: artifact.url,
    page_state_id: String(overrides.page_state_id ?? "workspace"),
    dom_sha256: artifact.dom_sha256,
    accessibility_sha256: artifact.accessibility_sha256,
    page_fingerprint_sha256: sha256Canonical({ dom_sha256: artifact.dom_sha256, accessibility_sha256: artifact.accessibility_sha256 }),
    discovery_artifact_path: "discovery/web-discovery.json",
    discovery_artifact_sha256: createHash("sha256").update(artifactBytes).digest("hex"),
    generated_at: generatedAt,
    expires_at: expiresAt,
    source_package_sha256: String(overrides.source_package_sha256 ?? loaded.package_sha256),
    source_case_ids: ["LOGIN-001"],
    transition_case_id: "LOGIN-001",
    transition_actions_sha256: String(overrides.transition_actions_sha256 ?? sha256Canonical(transitionActions)),
    approval_reference: DISCOVERY_APPROVAL_REFERENCE,
    purpose: "target_state_discovery_only",
  };
  const receiptPath = path.join(discoveryDir, "discovery-receipt.json");
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeFile(receiptPath, receiptBytes);
  await writeFile(path.join(f.output, "runtime-session.json"), `${JSON.stringify({
    session_schema_version: "1.0.0",
    run_nonce: sessionRunNonce,
    generated_by: "@saitamasans/testing-runtime",
    runtime_version: "1.0.3-dev",
    runner_version: "1.1.3",
    generated_at: generatedAt,
    expires_at: expiresAt,
    issued_receipts: [{
      receipt_path: "discovery/discovery-receipt.json",
      receipt_sha256: createHash("sha256").update(receiptBytes).digest("hex"),
    }],
  }, null, 2)}\n`, "utf8");
  return receiptPath;
}

test("READY package enters package-first path and skips semantic compilation", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package, overrides: { "LOGIN-001": { effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } } });
  await writeProfile(f.profile);
  const issued = await issueLiveReceipt(f);
  const result = await runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output, discoveryReceipts: [issued.receiptPath], discoveryApproval: issued.approval, runtimeSession: issued.session, now: RECEIPT_NOW });
  assert.equal(result.manifest.cases.length, 1);
  assert.equal(result.manifest.cases[0]?.case_id, "LOGIN-001");
  assert.equal(result.manifest.cases[0]?.original["优先级"], "P0");
  assert.deepEqual(result.manifest.cases[0]?.execution_contract, {
    case_id: "LOGIN-001",
    source_case_id: "LOGIN-001",
    source_sheet: "测试用例",
    title: "登录",
    module: "登录",
    priority: "P0",
    execution_type: "web_ui",
    automation_status: "auto_ready",
    isolation_scope: "case",
    flow_group: null,
    start_state: { description: "匿名登录页" },
    setup: [],
    actions: [{ action_id: "LOGIN-001-A1", type: "business_step", description: "提交有效凭据" }],
    assertions: [{ assertion_id: "LOGIN-001-E1", type: "business_expectation", description: "工作台可见" }],
    effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null },
    cleanup: { technical_cleanup: [{ type: "close_browser_context" }], business_cleanup: [] },
    dependencies: [], resource_locks: [],
    auth_profile: { id: "anonymous", strategy: "none", credential_refs: {} },
    evidence_policy: { screenshot: "on_failure", trace: "retain" },
    unresolved: [],
  });
  const metadata = JSON.parse(await readFile(path.join(f.output, "package-fast-path.json"), "utf8"));
  assert.equal(metadata.semantic_compilation, "skipped");
  assert.equal(metadata.semantic_compiler, "test-case-execution-compiler");
  assert.equal(metadata.contract_version, "1.0.0");
  assert.equal(metadata.review.package_sha256, result.manifest.package_sha256);
  assert.equal(metadata.review.source_sha256, result.manifest.source.sha256);
  assert.equal(metadata.review.final_manifest_sha256.length, 64);
  assert.equal(metadata.review.case_count, 1);
  assert.equal(metadata.review.action_count, 1);
  assert.equal(metadata.review.assertion_count, 1);
  assert.deepEqual(metadata.review.case_ids, ["LOGIN-001"]);
  assert.deepEqual(metadata.review.cases[0], {
    case_id: "LOGIN-001",
    source_case_id: "LOGIN-001",
    action_ids: ["LOGIN-001-A1"],
    assertion_ids: ["LOGIN-001-E1"],
    action_count: 1,
    assertion_count: 1,
    risk_levels: ["R0"],
    highest_risk: "R0",
    setup: [],
    cleanup: { technical_cleanup: [{ type: "close_browser_context" }], business_cleanup: [] },
    resource_locks: [],
  });
  for (const field of ["package_validation_ms", "contract_loading_ms", "runtime_doctor_ms", "binding_ms", "transition_discovery_ms", "manifest_assembly_ms"]) assert.equal(typeof metadata.timings[field], "number", field);
  for (const field of ["web_discovery_ms", "approval_wait_ms", "execution_ms", "report_ms"]) assert.equal(metadata.timings[field], null, field);
  assert.deepEqual(result.manifest.discovery_receipts, [{
    discovery_task_id: issued.receipt.discovery_task_id,
    source_case_id: "LOGIN-001",
    case_id: "LOGIN-001",
    page_state_id: "workspace",
    final_url: issued.receipt.final_url,
    discovery_id: issued.receipt.discovery_id,
    receipt_path: `discovery/${discoveryCaseDirectory("LOGIN-001")}/discovery-receipt.json`,
    receipt_sha256: createHash("sha256").update(await readFile(issued.receiptPath)).digest("hex"),
  }]);
});

test("conserves every execution contract field through manifest, runtime result and report", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const expectedContract = {
    case_id: "LOGIN-001",
    source_case_id: "LOGIN-001",
    source_sheet: "测试用例",
    title: "保留的标题",
    module: "保留的模块",
    priority: "P1",
    execution_type: "web_ui" as const,
    automation_status: "auto_ready" as const,
    isolation_scope: "case" as const,
    flow_group: null,
    start_state: { description: "匿名登录页", state_id: "anonymous-login" },
    auth_profile: { id: "named-profile", strategy: "credential_refs", credential_refs: { username: "LOGIN_USERNAME" } },
    setup: [{ setup_id: "LOGIN-001-S1", type: "business_setup", description: "打开登录页" }],
    actions: [{ action_id: "LOGIN-001-A1", type: "business_step", description: "提交有效凭据" }],
    assertions: [{ assertion_id: "LOGIN-001-E1", type: "business_expectation", description: "工作台可见" }],
    effects: { browser_state: { target_state: "workspace" }, identity_state: { state: "authenticated" }, account_data: null, shared_business_data: null, global_environment: null, external_system: null },
    cleanup: {
      technical_cleanup: [{ type: "close_browser_context" }],
      business_cleanup: [{ cleanup_id: "LOGIN-001-C1", type: "business_cleanup", description: "删除临时登录会话" }],
    },
    dependencies: [],
    resource_locks: [{ resource: "account:LOGIN_USERNAME", mode: "shared" }],
    evidence_policy: { screenshot: "always", trace: "retain" },
    unresolved: [],
  };
  await compilePackage({ input: f.input, output: f.package, overrides: { "LOGIN-001": expectedContract } });
  await writeFile(f.profile, JSON.stringify({
    protocol_version: "1.0.0",
    profile_id: "bound",
    targets: { web: { kind: "web", origin: "https://example.test" } },
    credentials: {},
    rule_versions: ["1.0.0", "target-state:LOGIN-001:workspace"],
    case_plans: {
      "LOGIN-001": [
        { type: "web.goto", action_id: "setup-login", target_alias: "web", url: "https://example.test/login", risk: "R0", source_step: "LOGIN-001-S1" },
        { type: "web.click", action_id: "submit-login", target_alias: "web", locator: "button[type=submit]", risk: "R0", source_step: "LOGIN-001-A1" },
        { type: "web.assert", action_id: "assert-workspace", target_alias: "web", assertion: "workspace visible", risk: "R0", source_step: "LOGIN-001-E1" },
        { type: "cleanup.web", action_id: "cleanup-login", target_alias: "web", locator: "button[data-cleanup]", risk: "R0", source_step: "LOGIN-001-C1" },
      ],
    },
  }, null, 2));

  const source = await loadExecutionPackage(f.package);
  const conservationTransitions = [
    { type: "web.goto", action_id: "setup-login", target_alias: "web", url: "https://example.test/login", risk: "R0", source_step: "LOGIN-001-S1" },
    { type: "web.click", action_id: "submit-login", target_alias: "web", locator: "button[type=submit]", risk: "R0", source_step: "LOGIN-001-A1" },
  ] as never[];
  const conservationReceipt = await issueLiveReceipt(f, conservationTransitions);
  const planned = await runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output, discoveryReceipts: [conservationReceipt.receiptPath], discoveryApproval: conservationReceipt.approval, runtimeSession: conservationReceipt.session, now: RECEIPT_NOW });
  assert.deepEqual(source.contract.cases[0], expectedContract, "Contract");
  assert.deepEqual(planned.manifest.cases[0]?.execution_contract, expectedContract, "Manifest");
  assert.equal(planned.manifest.contract_version, "1.0.0");
  assert.equal(planned.manifest.package_sha256, source.package_sha256);

  const usedSourceSteps: string[] = [];
  const result = await runApprovedManifest({
    manifest: planned.manifest,
    outputDir: path.join(f.root, "run"),
    executeAction: async (action) => {
      usedSourceSteps.push(action.source_step ?? "");
      return { action_id: action.action_id, started_at: new Date().toISOString(), finished_at: new Date().toISOString(), status: "passed", actual: { ok: true }, attachments: [] };
    },
  });
  assert.equal(validateDocument("run-result", result), result);
  assert.deepEqual(usedSourceSteps, ["LOGIN-001-S1", "LOGIN-001-A1", "LOGIN-001-E1", "LOGIN-001-C1"], "Runtime usage");
  assert.equal(result.contract_version, "1.0.0");
  assert.equal(result.package_sha256, source.package_sha256);
  assert.deepEqual(result.cases[0]?.execution_contract, expectedContract, "Result");
  assert.deepEqual(result.cases[0]?.contract_field_status, {
    case_id: "executed",
    source_case_id: "executed",
    source_sheet: "executed",
    title: "executed",
    module: "executed",
    priority: "executed",
    execution_type: "executed",
    automation_status: "executed",
    isolation_scope: "executed",
    flow_group: "executed",
    start_state: "skipped",
    auth_profile: "skipped",
    setup: "executed",
    actions: "executed",
    assertions: "executed",
    effects: "skipped",
    cleanup: "blocked",
    dependencies: "skipped",
    resource_locks: "blocked",
    evidence_policy: "skipped",
    unresolved: "skipped",
  }, "every Contract field has an explicit runtime state");

  const report = projectExecutionReport({
    report: {
      title: "Execution result",
      generated_at: new Date().toISOString(),
      skill_invocation: "web-api-test-execution-evidence",
      sheets: [{ name: "Cases", kind: "test_cases", columns: ["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "执行结果", "备注"], rows: [{ values: ["LOGIN-001", "登录", "登录", "登录", "匿名登录页", "提交", "工作台可见", "P0", "未执行", ""] }] }],
    },
    result,
  });
  const semantics = report.sheets.find((sheet) => sheet.name === "Execution contract semantics");
  assert.deepEqual(semantics?.columns, ["Case ID", "Contract field", "Runtime status", "Contract value JSON"]);
  assert.equal(semantics?.rows.length, Object.keys(expectedContract).length);
  assert.equal(semantics?.rows.find((row) => row.values[1] === "cleanup")?.values[2], "blocked");
  assert.equal(semantics?.rows.find((row) => row.values[1] === "resource_locks")?.values[2], "blocked");
  assert.deepEqual(JSON.parse(String(semantics?.rows.find((row) => row.values[1] === "effects")?.values[3])), expectedContract.effects);
});

test("NOT_READY package is rejected before planning", async (t) => {
  const f = await setup("");
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package });
  await writeProfile(f.profile);
  await assert.rejects(() => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output }), /package_not_ready/);
});

test("validated package is still untrusted and cannot run without a separate approval", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package });
  await writeProfile(f.profile);
  const validation = await validatePackage(f.package);
  assert.equal(validation.valid, true);
  assert.equal(validation.execution_authorized, false);
  await runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output });
  await assert.rejects(() => runRunCommand({
    manifest: path.join(f.output, "run-manifest.json"),
    approval: path.join(f.output, "missing-approval.json"),
    outputDir: path.join(f.root, "run"),
  }), /ENOENT/);
});

test("execution rejects package mutation after approval by recomputing package SHA", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package });
  await writeProfile(f.profile);
  await runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output });
  const manifestPath = path.join(f.output, "run-manifest.json");
  const approvalPath = path.join(f.output, "approval.json");
  await runApproveCommand({
    manifest: manifestPath,
    out: approvalPath,
    expiresAt: "2999-01-01T00:00:00.000Z",
    confirmedBy: "reviewer",
  });
  await writeFile(f.package, Buffer.concat([await readFile(f.package), Buffer.from("post-approval mutation")]));

  const exitCode = await runRunCommand({ manifest: manifestPath, approval: approvalPath, outputDir: path.join(f.root, "run") });
  assert.equal(exitCode, EXIT_UNSAFE_OR_INVALID);
  const result = JSON.parse(await readFile(path.join(f.root, "run", "run-result.json"), "utf8"));
  assert.match(result.cases[0].assertions[0].actual, /package changed after approval/i);
});

test("raw Excel defaults to execution_contract_required", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await writeProfile(f.profile);
  await assert.rejects(() => runPlanCommand({ input: f.input, profile: f.profile, outputDir: f.output }), /execution_contract_required.*test-case-execution-compiler/s);
});

test("package path rejects missing source-step mappings instead of inventing actions", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package });
  await writeProfile(f.profile, { mapAssertion: false });
  await assert.rejects(() => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output }), /contract_incomplete.*LOGIN-001-E1/);
});

test("target state must be discovered before final manifest", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package, overrides: { "LOGIN-001": { effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } } });
  await writeProfile(f.profile, { discovered: false });
  await assert.rejects(() => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output }), /target_state_not_discovered/);
});

test("profile target-state markers cannot forge discovery", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package, overrides: { "LOGIN-001": { effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } } });
  await writeProfile(f.profile, { discovered: true });

  await assert.rejects(
    () => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output }),
    /target_state_not_discovered/,
  );
});

test("rewriting both disk receipt and disk session ledger cannot forge discovery", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package, overrides: { "LOGIN-001": { effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } } });
  await writeProfile(f.profile);
  const receipt = await writeIssuedDiscoveryReceipt(f);
  await assert.rejects(
    () => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output, discoveryReceipts: [receipt], discoveryApproval: path.join(f.output, "fake-approval.json"), now: RECEIPT_NOW }),
    /runtime_session_required/,
  );
});

test("discovery receipt authority requires an active in-memory RuntimeSession capability", () => {
  const createSession = (discoveryReceiptRuntime as unknown as { createActiveRuntimeSession?: unknown }).createActiveRuntimeSession;
  assert.equal(typeof createSession, "function");
});

async function prepareReceiptPlan(overrides: Record<string, unknown> = {}) {
  const f = await setup();
  await compilePackage({ input: f.input, output: f.package, overrides: { "LOGIN-001": { effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } } });
  await writeProfile(f.profile);
  const issued = await issueLiveReceipt(f);
  const plan = () => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output, discoveryReceipts: [issued.receiptPath], discoveryApproval: issued.approval, runtimeSession: issued.session, now: RECEIPT_NOW });
  return { f, ...issued, receipt: issued.receiptPath, artifact: issued.artifactPath, plan, overrides };
}

test("Testing Runtime issues a cryptographically random current-session discovery receipt", async (t) => {
  const issue = (discoveryReceiptRuntime as unknown as { discoverAndIssueReceipt?: (input: Record<string, unknown>) => Promise<{ receiptPath: string }> }).discoverAndIssueReceipt;
  assert.equal(typeof issue, "function");
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package, overrides: { "LOGIN-001": { effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } } });
  await writeProfile(f.profile);
  const loaded = await loadExecutionPackage(f.package);
  const session = await (discoveryReceiptRuntime as any).createActiveRuntimeSession(f.output, RECEIPT_NOW);
  const approvalPath = await writeDiscoveryApproval(f, loaded.package_sha256);
  const issued = await issue!({
    session,
    page: fakeDiscoveryPage(),
    packageSha256: loaded.package_sha256,
    sourceCaseIds: ["LOGIN-001"],
    transitionCaseId: "LOGIN-001",
    transitionActions: [{ type: "web.goto", action_id: "goto-login", target_alias: "web", url: "https://example.test/login", risk: "R0", source_step: "LOGIN-001-A1" }],
    targetOrigin: "https://example.test",
    requestedUrl: "https://example.test/login",
    pageStateId: "workspace",
    approvalPath,
    now: RECEIPT_NOW,
  });
  const receipt = JSON.parse(await readFile(issued.receiptPath, "utf8"));
  for (const field of [
    "receipt_schema_version", "run_nonce", "discovery_id", "generated_by", "runtime_version", "runner_version",
    "target_origin", "requested_url", "final_url", "page_state_id", "dom_sha256", "accessibility_sha256",
    "page_fingerprint_sha256", "discovery_artifact_sha256", "generated_at", "source_package_sha256",
    "source_case_ids", "discovery_task_id", "source_case_id", "transition_case_id", "transition_actions_sha256", "approval_reference",
  ]) assert.equal(Object.hasOwn(receipt, field), true, field);
  assert.match(receipt.run_nonce, /^[a-f0-9]{64}$/);
  assert.equal(receipt.generated_by, "@saitamasans/testing-runtime");
  assert.equal(receipt.purpose, "target_state_discovery_only");
  const sessionAudit = JSON.parse(await readFile(path.join(f.output, "runtime-session.json"), "utf8"));
  assert.equal(receipt.run_nonce, sessionAudit.run_nonce);
  assert.equal(sessionAudit.authority, "in_memory_capability_required");
  assert.equal(Object.hasOwn(receipt, "business_status"), false);
});

test("old discovery artifact cannot be refreshed into a current-session receipt", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package, overrides: { "LOGIN-001": { effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } } });
  const loaded = await loadExecutionPackage(f.package);
  const session = await (discoveryReceiptRuntime as any).createActiveRuntimeSession(f.output, RECEIPT_NOW);
  const approvalPath = await writeDiscoveryApproval(f, loaded.package_sha256);
  const discoveryDir = path.join(f.output, "discovery", discoveryCaseDirectory("LOGIN-001"));
  await mkdir(discoveryDir, { recursive: true });
  await writeFile(path.join(discoveryDir, "web-discovery.json"), `${JSON.stringify({
    url: "https://example.test/workspace",
    discovered_at: "2026-07-20T00:00:00.000Z",
    dom_sha256: "a".repeat(64),
    accessibility_sha256: "b".repeat(64),
  }, null, 2)}\n`, "utf8");
  await assert.rejects(
    () => (discoveryReceiptRuntime as any).discoverAndIssueReceipt({
      session, page: fakeDiscoveryPage(), packageSha256: loaded.package_sha256, sourceCaseIds: ["LOGIN-001"],
      transitionCaseId: "LOGIN-001", transitionActions: DEFAULT_TRANSITION_ACTIONS, targetOrigin: "https://example.test",
      requestedUrl: "https://example.test/login", pageStateId: "workspace", approvalPath, now: RECEIPT_NOW,
    }),
    /EEXIST/,
  );
  await assert.rejects(() => readFile(path.join(discoveryDir, "discovery-receipt.json")), /ENOENT/);
});

test("path-like transition case IDs are encoded beneath the discovery root", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package });
  const loaded = await loadExecutionPackage(f.package);
  const session = await (discoveryReceiptRuntime as any).createActiveRuntimeSession(f.output, RECEIPT_NOW);
  const issued = await (discoveryReceiptRuntime as any).discoverAndIssueReceipt({
    session, page: fakeDiscoveryPage(), packageSha256: loaded.package_sha256, sourceCaseIds: ["LOGIN-001"],
    transitionCaseId: "../../escape", transitionActions: DEFAULT_TRANSITION_ACTIONS, targetOrigin: "https://example.test",
    requestedUrl: "https://example.test/login", pageStateId: "workspace", approvalPath: await writeDiscoveryApproval(f, loaded.package_sha256, DEFAULT_TRANSITION_ACTIONS as never[], { transition_case_id: "../../escape" }), now: RECEIPT_NOW,
  });
  assert.equal(path.relative(f.output, path.dirname(issued.receiptPath)), path.join("discovery", discoveryCaseDirectory("../../escape")));
  await assert.rejects(() => readFile(path.join(f.root, "escape", "discovery-receipt.json")), /ENOENT/);
});

test("discovery writes reject a symlink or junction escape", async (t) => {
  const f = await setup();
  const outside = await mkdtemp(path.join(os.tmpdir(), "runner-discovery-escape-"));
  t.after(() => rm(f.root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package });
  const loaded = await loadExecutionPackage(f.package);
  const session = await (discoveryReceiptRuntime as any).createActiveRuntimeSession(f.output, RECEIPT_NOW);
  const approvalPath = await writeDiscoveryApproval(f, loaded.package_sha256);
  await mkdir(path.join(f.output, "discovery"), { recursive: true });
  await symlink(outside, path.join(f.output, "discovery", discoveryCaseDirectory("LOGIN-001")), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => (discoveryReceiptRuntime as any).discoverAndIssueReceipt({
    session, page: fakeDiscoveryPage(), packageSha256: loaded.package_sha256, sourceCaseIds: ["LOGIN-001"],
    transitionCaseId: "LOGIN-001", transitionActions: DEFAULT_TRANSITION_ACTIONS, targetOrigin: "https://example.test",
    requestedUrl: "https://example.test/login", pageStateId: "workspace", approvalPath, now: RECEIPT_NOW,
  }), /discovery_directory_outside_current_run/);
  await assert.rejects(() => readFile(path.join(outside, "discovery-receipt.json")), /ENOENT/);
});

test("post-create identity verification rejects a swapped discovery file", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package });
  const loaded = await loadExecutionPackage(f.package);
  const session = await (discoveryReceiptRuntime as any).createActiveRuntimeSession(f.output, RECEIPT_NOW);
  const approvalPath = await writeDiscoveryApproval(f, loaded.package_sha256);
  await assert.rejects(() => (discoveryReceiptRuntime as any).discoverAndIssueReceipt({
    session, page: fakeDiscoveryPage(), packageSha256: loaded.package_sha256, sourceCaseIds: ["LOGIN-001"],
    transitionCaseId: "LOGIN-001", transitionActions: DEFAULT_TRANSITION_ACTIONS, targetOrigin: "https://example.test",
    requestedUrl: "https://example.test/login", pageStateId: "workspace", approvalPath, now: RECEIPT_NOW,
    afterExclusiveCreate: async (kind: string, file: string) => {
      if (kind !== "artifact") return;
      await rm(file, { force: true });
      await writeFile(file, "attacker replacement", "utf8");
    },
  }), /artifact_identity_changed/);
  const directory = path.join(f.output, "discovery", discoveryCaseDirectory("LOGIN-001"));
  await assert.rejects(() => readFile(path.join(directory, "web-discovery.json")), /ENOENT/);
  await assert.rejects(() => readFile(path.join(directory, "discovery-receipt.json")), /ENOENT/);
});

test("non-ASCII case IDs retain their exact value while using a safe hashed directory", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package });
  const loaded = await loadExecutionPackage(f.package);
  const session = await (discoveryReceiptRuntime as any).createActiveRuntimeSession(f.output, RECEIPT_NOW);
  const caseId = "登录用例-甲";
  const approvalPath = await writeDiscoveryApproval(f, loaded.package_sha256, DEFAULT_TRANSITION_ACTIONS as never[], { transition_case_id: caseId });
  const issued = await (discoveryReceiptRuntime as any).discoverAndIssueReceipt({
    session, page: fakeDiscoveryPage(), packageSha256: loaded.package_sha256, sourceCaseIds: ["LOGIN-001"],
    transitionCaseId: caseId, transitionActions: DEFAULT_TRANSITION_ACTIONS, targetOrigin: "https://example.test",
    requestedUrl: "https://example.test/login", pageStateId: "workspace", approvalPath, now: RECEIPT_NOW,
  });
  assert.equal(issued.receipt.transition_case_id, caseId);
  assert.equal(path.relative(f.output, path.dirname(issued.receiptPath)), path.join("discovery", discoveryCaseDirectory(caseId)));
  assert.doesNotMatch(path.relative(f.output, issued.receiptPath), /登录|用例|甲/);
});

test("forged discovery receipt is rejected", async (t) => {
  const { f, receipt, plan } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const forged = JSON.parse(await readFile(receipt, "utf8"));
  forged.page_state_id = "forged-state";
  await writeFile(receipt, `${JSON.stringify(forged, null, 2)}\n`, "utf8");
  await assert.rejects(plan, /discovery_receipt_invalid.*receipt_not_issued_by_active_session/);
});

test("discovery receipt schema cannot claim business success", async (t) => {
  const { f, receipt, plan } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const document = JSON.parse(await readFile(receipt, "utf8"));
  document.business_status = "passed";
  await writeFile(receipt, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await assert.rejects(plan, /Invalid discovery-receipt document.*business_status/);
});

test("cross-origin discovery receipt is rejected", async (t) => {
  const { f, plan } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const profile = JSON.parse(await readFile(f.profile, "utf8"));
  profile.targets.web.origin = "https://attacker.test";
  await writeFile(f.profile, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await assert.rejects(plan, /discovery_receipt_invalid.*origin/);
});

test("cross-package discovery receipt is rejected", async (t) => {
  const { f, session, approval, receipt } = await prepareReceiptPlan();
  const other = await setup("不同的预期结果");
  t.after(() => rm(f.root, { recursive: true, force: true }));
  t.after(() => rm(other.root, { recursive: true, force: true }));
  await compilePackage({ input: other.input, output: other.package, overrides: { "LOGIN-001": { effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } } });
  await assert.rejects(
    () => runPlanCommand({ input: other.package, profile: f.profile, outputDir: f.output, discoveryReceipts: [receipt], discoveryApproval: approval, runtimeSession: session, now: RECEIPT_NOW }),
    /discovery_receipt_invalid.*package/,
  );
});

test("cross-run-nonce discovery receipt is rejected", async (t) => {
  const { f, receipt, artifact, approval } = await prepareReceiptPlan();
  const otherRoot = await mkdtemp(path.join(os.tmpdir(), "runner-cross-session-"));
  const otherRun = path.join(otherRoot, ".testing-run");
  t.after(() => rm(f.root, { recursive: true, force: true }));
  t.after(() => rm(otherRoot, { recursive: true, force: true }));
  const otherSession = await (discoveryReceiptRuntime as any).createActiveRuntimeSession(otherRun, RECEIPT_NOW);
  const otherDiscovery = path.dirname(path.join(otherRun, path.relative(f.output, receipt)));
  await mkdir(otherDiscovery, { recursive: true });
  const copiedReceipt = path.join(otherDiscovery, "discovery-receipt.json");
  const copiedArtifact = path.join(otherDiscovery, "web-discovery.json");
  const copiedApproval = path.join(otherRun, "discovery-approval.json");
  await copyFile(receipt, copiedReceipt);
  await copyFile(artifact, copiedArtifact);
  await copyFile(approval, copiedApproval);
  await assert.rejects(
    () => runPlanCommand({ input: f.package, profile: f.profile, outputDir: otherRun, discoveryReceipts: [copiedReceipt], discoveryApproval: copiedApproval, runtimeSession: otherSession, now: RECEIPT_NOW }),
    /discovery_receipt_invalid.*active_session/,
  );
});

test("transition action mismatch invalidates discovery receipt", async (t) => {
  const { f, plan } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const profile = JSON.parse(await readFile(f.profile, "utf8"));
  profile.case_plans["LOGIN-001"][0].url = "https://example.test/changed";
  await writeFile(f.profile, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await assert.rejects(plan, /discovery_receipt_invalid.*actions/);
});

test("page change invalidates stale discovery receipt fingerprint", async (t) => {
  const { f, receipt, plan } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const receiptDocument = JSON.parse(await readFile(receipt, "utf8"));
  const artifactPath = path.join(f.output, receiptDocument.discovery_artifact_path);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  artifact.dom_sha256 = "9".repeat(64);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await assert.rejects(plan, /discovery_receipt_invalid.*page_fingerprint/);
});

test("expired discovery receipt and old runtime session are rejected", async (t) => {
  const { f, receipt, approval, session } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(
    () => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output, discoveryReceipts: [receipt], discoveryApproval: approval, runtimeSession: session, now: new Date(RECEIPT_NOW.getTime() + 20 * 60_000) }),
    /runtime_session_expired/,
  );
});

test("verification re-samples the clock and rejects expiry during work", async (t) => {
  const { f, receipt, approval, session } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  let samples = 0;
  const clock = () => ++samples < 3 ? RECEIPT_NOW : new Date(RECEIPT_NOW.getTime() + 20 * 60_000);
  await assert.rejects(
    () => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output, discoveryReceipts: [receipt], discoveryApproval: approval, runtimeSession: session, clock }),
    /runtime_session_expired/,
  );
  assert.ok(samples >= 3);
});

test("receipt outside the current run directory is rejected", async (t) => {
  const { f, receipt, session, approval } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const outside = path.join(f.root, "outside-discovery-receipt.json");
  await writeFile(outside, await readFile(receipt));
  await assert.rejects(
    () => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output, discoveryReceipts: [outside], discoveryApproval: approval, runtimeSession: session, now: RECEIPT_NOW }),
    /discovery_receipt_invalid.*outside_current_run/,
  );
});

test("receipt with a missing discovery artifact is rejected", async (t) => {
  const { f, receipt, plan } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const document = JSON.parse(await readFile(receipt, "utf8"));
  await rm(path.join(f.output, document.discovery_artifact_path));
  await assert.rejects(plan, /discovery_receipt_invalid.*artifact_path_missing/);
});

test("fake discovery approval artifact is rejected", async (t) => {
  const { f, receipt, session } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const fakeApproval = path.join(f.output, "fake-discovery-approval.json");
  await writeFile(fakeApproval, `${JSON.stringify({ approval_id: "arbitrary-string" }, null, 2)}\n`, "utf8");
  await assert.rejects(
    () => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output, discoveryReceipts: [receipt], discoveryApproval: fakeApproval, runtimeSession: session, now: RECEIPT_NOW }),
    /Invalid discovery-approval document/,
  );
});

test("active RuntimeSession rejects an arbitrary caller output directory", async (t) => {
  const { f, receipt, session, approval } = await prepareReceiptPlan();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(
    () => runPlanCommand({ input: f.package, profile: f.profile, outputDir: path.join(f.root, "arbitrary-output"), discoveryReceipts: [receipt], discoveryApproval: approval, runtimeSession: session, now: RECEIPT_NOW }),
    /runtime_session_output_dir_mismatch/,
  );
});

test("user target_state_discovered boolean is rejected as profile data", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package });
  await writeProfile(f.profile);
  const profile = JSON.parse(await readFile(f.profile, "utf8"));
  profile.target_state_discovered = true;
  await writeFile(f.profile, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await assert.rejects(() => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output }), /target_state_discovered/);
});

test("discovery receipt preloaded in the Execution Package is rejected", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package });
  const zip = await JSZip.loadAsync(await readFile(f.package));
  zip.file("discovery-receipt.json", "{}\n");
  await writeFile(f.package, await zip.generateAsync({ type: "nodebuffer" }));
  await writeProfile(f.profile);
  await assert.rejects(() => runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output }), /package_inventory_mismatch/);
});

test("legacy raw input enters the deprecated parser only behind explicit option", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await writeProfile(f.profile);
  await assert.rejects(
    () => runPlanCommand({ input: f.input, profile: f.profile, outputDir: f.output, legacyInput: true }),
    /mapping-approval/,
  );
});
