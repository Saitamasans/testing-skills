import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import ExcelJS from "exceljs";
import { compilePackage, loadExecutionPackage } from "../../testing-contract-compiler/src/index.js";

import { sha256Canonical } from "../src/compiler/canonical-json.js";
import { runDiscoverPlanCommand } from "../src/commands/discover-plan.js";
import type { ManifestAction } from "../src/types.js";
import { startDemoApp } from "./fixtures/demo-app.js";

async function fixture(targetState: string, baseUrl: string, actions: ManifestAction[]) {
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
    approved_risks: ["R0"], approved_r3_action_ids: [], issued_by: "reviewer", issued_at: now.toISOString(), expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
  }, null, 2)}\n`);
  return { root, packagePath, profile, output, approval };
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
