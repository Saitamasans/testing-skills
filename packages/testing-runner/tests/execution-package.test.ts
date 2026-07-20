import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { compilePackage, loadExecutionPackage } from "../../testing-contract-compiler/src/index.js";
import { runPlanCommand } from "../src/commands/plan.js";
import { projectExecutionReport } from "../src/reporting/report-projector.js";
import { runApprovedManifest } from "../src/runtime/run-orchestrator.js";
import { validateDocument } from "../src/schema-registry.js";

async function setup(expected = "工作台可见") {
  const root = await mkdtemp(path.join(os.tmpdir(), "runner-package-test-"));
  const input = path.join(root, "cases.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("测试用例");
  sheet.addRow(["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "实际结果", "执行结果"]);
  sheet.addRow(["LOGIN-001", "登录", "登录", "登录", "匿名登录页", "提交有效凭据", expected, "P0", "", "未执行"]);
  await workbook.xlsx.writeFile(input);
  return { root, input, package: path.join(root, "cases.execution-package.zip"), profile: path.join(root, "profile.json"), output: path.join(root, "plan") };
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

test("READY package enters package-first path and skips semantic compilation", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.package, overrides: { "LOGIN-001": { effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } } });
  await writeProfile(f.profile);
  const result = await runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output });
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
  for (const field of ["package_validation_ms", "contract_loading_ms", "runtime_doctor_ms", "binding_ms", "transition_discovery_ms", "manifest_assembly_ms"]) assert.equal(typeof metadata.timings[field], "number", field);
  for (const field of ["web_discovery_ms", "approval_wait_ms", "execution_ms", "report_ms"]) assert.equal(metadata.timings[field], null, field);
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
  const planned = await runPlanCommand({ input: f.package, profile: f.profile, outputDir: f.output });
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

test("legacy raw input enters the deprecated parser only behind explicit option", async (t) => {
  const f = await setup();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await writeProfile(f.profile);
  await assert.rejects(
    () => runPlanCommand({ input: f.input, profile: f.profile, outputDir: f.output, legacyInput: true }),
    /mapping-approval/,
  );
});
