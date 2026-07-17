import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

import { startSkillMartApp } from "./fixtures/skillmart-app.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const builderPath = path.join(repoRoot, "demo", "skillmart", "scripts", "build-demo-materials.mjs");
const validatorPath = path.join(repoRoot, "demo", "skillmart", "scripts", "validate-demo-materials.mjs");
const executionProfileBuilderPath = path.join(repoRoot, "demo", "skillmart", "scripts", "build-execution-profiles.mjs");
const executionSummaryBuilderPath = path.join(repoRoot, "demo", "skillmart", "scripts", "summarize-execution-results.mjs");
const acceptanceNavigationBuilderPath = path.join(repoRoot, "demo", "skillmart", "scripts", "build-acceptance-navigation.mjs");
const demoRecorderPath = path.join(repoRoot, "demo", "skillmart", "scripts", "record-demo-video.mjs");
const realDesktopRecorderPath = path.join(repoRoot, "demo", "skillmart", "scripts", "record-real-desktop-demo.mjs");
const eighthSkillTutorialFinalizerPath = path.join(repoRoot, "demo", "skillmart", "scripts", "finalize-eighth-skill-tutorial.mjs");
const realDesktopManifestPath = path.join(repoRoot, "demo", "skillmart", "scripts", "desktop-recording-manifest.json");
const liveDemoScriptPath = path.join(repoRoot, "demo", "skillmart", "scripts", "live-skillmart-demo-script.json");

function runNode(args: string[]) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve a local TCP port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test("SkillMart exposes products, coupons, orders and resettable seed data", async () => {
  const app = await startSkillMartApp();
  try {
    const products = await fetch(`${app.baseUrl}/api/products`).then((response) => response.json()) as {
      products: Array<{ sku: string; stock: number; price: number }>;
    };
    assert.equal(products.products[0]?.sku, "SKU-BOOK-001");
    assert.equal(products.products[0]?.stock, 3);

    const coupon = await fetch(`${app.baseUrl}/api/coupons/SKILL20/eligibility?amount=120`).then((response) => response.json()) as {
      eligible: boolean;
      discount: number;
    };
    assert.deepEqual(coupon, { eligible: true, discount: 20 });

    const first = await fetch(`${app.baseUrl}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "same-key", "x-user-id": "user-a" },
      body: JSON.stringify({ user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1, coupon_code: "SKILL20" }),
    }).then((response) => response.json()) as { order_id: string };
    const second = await fetch(`${app.baseUrl}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "same-key", "x-user-id": "user-a" },
      body: JSON.stringify({ user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1, coupon_code: "SKILL20" }),
    }).then((response) => response.json()) as { order_id: string };

    assert.notEqual(first.order_id, second.order_id, "fixture intentionally keeps the idempotency defect");
    const afterDuplicate = await fetch(`${app.baseUrl}/api/products`).then((response) => response.json()) as {
      products: Array<{ sku: string; stock: number }>;
    };
    assert.equal(afterDuplicate.products[0]?.stock, 1);

    const boundary = await fetch(
      `${app.baseUrl}/api/coupons/SKILL20/eligibility?amount=120&client_clicked_at=2026-07-15T23:59:59.900Z&server_received_at=2026-07-16T00:00:00.100Z`,
    ).then((response) => response.json()) as { verdict: string; conflict_sources: string[] };
    assert.equal(boundary.verdict, "待定");
    assert.deepEqual(boundary.conflict_sources, ["product-confirmation", "api-contract"]);

    await fetch(`${app.baseUrl}/__test/reset`, { method: "POST" });
    const reset = await fetch(`${app.baseUrl}/api/products`).then((response) => response.json()) as {
      products: Array<{ sku: string; stock: number }>;
    };
    assert.equal(reset.products[0]?.stock, 3);
  } finally {
    await app.close();
  }
});

test("SkillMart can bind a caller-selected port for locked execution profiles", async () => {
  const port = await findAvailablePort();
  const app = await startSkillMartApp({ port });
  try {
    assert.equal(app.baseUrl, `http://127.0.0.1:${port}`);
    const health = await fetch(`${app.baseUrl}/api/health`).then((response) => response.json()) as {
      ok: boolean;
    };
    assert.equal(health.ok, true);
  } finally {
    await app.close();
  }
});

test("SkillMart is understandable and usable before Runner injection", async () => {
  const app = await startSkillMartApp();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(app.baseUrl);
    assert.equal(await page.getByText("SkillMart", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText("商品中心", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText("订单中心", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText("运行数据", { exact: true }).isVisible(), true);
    await page.getByTestId("coupon-code").fill("SKILL20");
    await page.getByTestId("create-order").click();
    assert.match(await page.getByTestId("status").innerText(), /订单已创建 ORD-/);
  } finally {
    await browser.close();
    await app.close();
  }
});

test("SkillMart assets are local and its read-only operations views expose current state", async () => {
  const app = await startSkillMartApp();
  try {
    const html = await fetch(`${app.baseUrl}/`).then((response) => response.text());
    assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)/);
    assert.match(html, /\/assets\/skillmart-products\.png/);
    assert.equal((await fetch(`${app.baseUrl}/api/products`)).status, 200);
    assert.equal((await fetch(`${app.baseUrl}/api/orders`)).status, 200);
    assert.equal((await fetch(`${app.baseUrl}/api/runtime-state`)).status, 200);
    assert.equal((await fetch(`${app.baseUrl}/__test/reset`, { method: "POST" })).status, 200);
  } finally {
    await app.close();
  }
});

test("SkillMart builds five complete execution profiles with locked verdict routes", async () => {
  const suiteIds = {
    requirementWorkbench: [
      "WB-PROD-001", "WB-PROD-002", "WB-CPN-001", "WB-CPN-002", "WB-CPN-003", "WB-ORD-001",
      "WB-ORD-002", "WB-ORD-003", "WB-ORD-004", "WB-AUTH-001", "WB-AUTH-002", "WB-STATE-001",
      "WB-STATE-002", "WB-STATE-003", "WB-PAY-001", "WB-PAY-002", "WB-CONS-001", "WB-CONS-002",
    ],
    singleApiFull: [
      "API-FULL-001", "API-FULL-002", "API-FULL-003", "API-FULL-005", "API-FULL-017", "API-FULL-004",
      "API-FULL-006", "API-FULL-007", "API-FULL-008", "API-FULL-013", "API-FULL-014", "API-FULL-015",
      "API-FULL-016", "API-FULL-019", "API-FULL-009", "API-FULL-010", "API-FULL-011", "API-FULL-012",
      "API-FULL-018", "API-FULL-020",
    ],
    singleApiConcise: [
      "API-CONCISE-001", "API-CONCISE-004", "API-CONCISE-005", "API-CONCISE-002", "API-CONCISE-003",
      "API-CONCISE-006", "API-CONCISE-007",
    ],
    multiApiFlow: [
      "FLOW-001", "FLOW-002", "FLOW-003", "FLOW-004", "FLOW-005", "FLOW-009", "FLOW-011", "FLOW-010",
      "FLOW-006", "FLOW-007", "FLOW-012", "FLOW-008",
    ],
    productionVerification: ["PROD-L0-001", "PROD-L0-002", "PROD-L0-003", "PROD-L0-004", "PROD-L0-005"],
  } as const;
  const directory = await mkdtemp(path.join(tmpdir(), "skillmart-execution-profiles-"));
  try {
    const reports: Record<string, string> = {};
    for (const [suite, ids] of Object.entries(suiteIds)) {
      const file = path.join(directory, `${suite}.json`);
      const columns = ["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "执行结果", "备注"];
      await writeFile(file, JSON.stringify({
        title: suite,
        generated_at: "2026-07-16T00:00:00.000Z",
        skill_invocation: "fixture",
        sheets: [{
          name: "测试用例",
          kind: "test_cases",
          columns,
          rows: ids.map((id) => ({ values: [id, suite, id, "验证", "前置", "步骤", "预期", "P0", "未执行", ""] })),
        }],
      }, null, 2));
      reports[suite] = file;
    }

    const imported = await import(pathToFileURL(executionProfileBuilderPath).href).catch(() => undefined) as
      | { buildSkillMartExecutionProfiles?: (options: unknown) => Promise<unknown> }
      | undefined;
    assert.ok(imported?.buildSkillMartExecutionProfiles, "execution profile builder must exist");
    const outputRoot = path.join(directory, "output");
    await mkdir(outputRoot, { recursive: true });
    await imported.buildSkillMartExecutionProfiles({
      reports,
      outputRoot,
      origin: "http://127.0.0.1:45678",
    });

    for (const [suite, ids] of Object.entries(suiteIds)) {
      const profile = JSON.parse(await readFile(path.join(outputRoot, suite, "execution-profile.json"), "utf8")) as {
        targets: Record<string, { origin: string }>;
        case_plans: Record<string, Array<Record<string, unknown>>>;
      };
      assert.deepEqual(Object.keys(profile.case_plans), [...ids]);
      assert.equal(profile.targets.api?.origin, "http://127.0.0.1:45678");
      assert.equal(Object.values(profile.case_plans).every((actions) => actions.length > 0), true);
    }

    const production = JSON.parse(await readFile(
      path.join(outputRoot, "productionVerification", "execution-profile.json"),
      "utf8",
    )) as { case_plans: Record<string, Array<{ type: string; method?: string; risk: string }>> };
    assert.equal(Object.values(production.case_plans).flat().every((action) =>
      action.type === "api.assert" || (action.type === "api.request" && action.method === "GET" && action.risk === "R0")
    ), true);

    const workbench = JSON.parse(await readFile(
      path.join(outputRoot, "requirementWorkbench", "execution-profile.json"),
      "utf8",
    )) as { case_plans: Record<string, Array<Record<string, unknown>>> };
    assert.equal(workbench.case_plans["WB-CPN-003"]?.some((action) => action.verdict_policy === "pending_only"), true);
    assert.equal(workbench.case_plans["WB-CONS-001"]?.[0]?.type, "execution.blocked");

    const full = JSON.parse(await readFile(
      path.join(outputRoot, "singleApiFull", "execution-profile.json"),
      "utf8",
    )) as { case_plans: Record<string, Array<Record<string, unknown>>> };
    for (const id of ["API-FULL-009", "API-FULL-010", "API-FULL-011"]) {
      assert.equal(full.case_plans[id]?.some((action) => action.root_cause_key === "idempotency-duplicate-order"), true, id);
    }
    assert.equal(full.case_plans["API-FULL-012"]?.some((action) => action.verdict_policy === "pending_only"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SkillMart enforces local identity for order creation, reads and cancellation", async () => {
  const app = await startSkillMartApp();
  try {
    const createdResponse = await fetch(`${app.baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "identity-key",
        "x-user-id": "user-a",
      },
      body: JSON.stringify({ user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1 }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { order_id: string; user_id: string };
    assert.equal(created.user_id, "user-a");

    const crossUserRead = await fetch(`${app.baseUrl}/api/orders/${created.order_id}`, {
      headers: { "x-user-id": "user-b" },
    });
    assert.equal(crossUserRead.status, 403);
    assert.deepEqual(await crossUserRead.json(), { error: "order_forbidden" });

    const missingIdentityRead = await fetch(`${app.baseUrl}/api/orders/${created.order_id}`);
    assert.equal(missingIdentityRead.status, 401);
    assert.deepEqual(await missingIdentityRead.json(), { error: "user_identity_required" });

    const ownRead = await fetch(`${app.baseUrl}/api/orders/${created.order_id}`, {
      headers: { "x-user-id": "user-a" },
    });
    assert.equal(ownRead.status, 200);

    const crossUserCancel = await fetch(`${app.baseUrl}/api/orders/${created.order_id}/cancel`, {
      method: "POST",
      headers: { "x-user-id": "user-b" },
    });
    assert.equal(crossUserCancel.status, 403);

    const missingIdentityCancel = await fetch(`${app.baseUrl}/api/orders/${created.order_id}/cancel`, {
      method: "POST",
    });
    assert.equal(missingIdentityCancel.status, 401);
    assert.deepEqual(await missingIdentityCancel.json(), { error: "user_identity_required" });

    const ownCancel = await fetch(`${app.baseUrl}/api/orders/${created.order_id}/cancel`, {
      method: "POST",
      headers: { "x-user-id": "user-a" },
    });
    assert.equal(ownCancel.status, 200);
  } finally {
    await app.close();
  }
});

test("SkillMart rejects invalid content types, missing idempotency keys, identity mismatches and invalid quantities without side effects", async () => {
  const app = await startSkillMartApp();
  try {
    const attempts = [
      {
        headers: { "content-type": "text/plain", "x-idempotency-key": "wrong-content-type", "x-user-id": "user-a" },
        body: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1 },
        error: "content_type_invalid",
      },
      {
        headers: { "content-type": "application/json", "x-user-id": "user-a" },
        body: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1 },
        error: "idempotency_key_required",
      },
      {
        headers: { "content-type": "application/json", "x-idempotency-key": "mismatch", "x-user-id": "user-a" },
        body: { user_id: "user-b", sku: "SKU-BOOK-001", quantity: 1 },
        error: "user_identity_mismatch",
      },
      {
        headers: { "content-type": "application/json", "x-idempotency-key": "zero", "x-user-id": "user-a" },
        body: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 0 },
        error: "quantity_invalid",
      },
      {
        headers: { "content-type": "application/json", "x-idempotency-key": "string-quantity", "x-user-id": "user-a" },
        body: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: "1" },
        error: "quantity_invalid",
      },
      {
        headers: { "content-type": "application/json", "x-idempotency-key": "invalid-sku", "x-user-id": "user-a" },
        body: { user_id: "user-a", sku: 123, quantity: 1 },
        error: "sku_invalid",
      },
      {
        headers: { "content-type": "application/json", "x-idempotency-key": "invalid-coupon", "x-user-id": "user-a" },
        body: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1, coupon_code: 20 },
        error: "coupon_code_invalid",
      },
    ];
    for (const attempt of attempts) {
      const response = await fetch(`${app.baseUrl}/api/orders`, {
        method: "POST",
        headers: attempt.headers,
        body: JSON.stringify(attempt.body),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: attempt.error });
    }
    const products = await fetch(`${app.baseUrl}/api/products`).then((response) => response.json()) as {
      products: Array<{ sku: string; stock: number }>;
    };
    assert.equal(products.products[0]?.stock, 3);
  } finally {
    await app.close();
  }
});

test("SkillMart rejects malformed order JSON without side effects", async () => {
  const app = await startSkillMartApp();
  try {
    const response = await fetch(`${app.baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "malformed-json",
        "x-user-id": "user-a",
      },
      body: '{"user_id":',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_json" });
    const products = await fetch(`${app.baseUrl}/api/products`).then((item) => item.json()) as {
      products: Array<{ sku: string; stock: number }>;
    };
    assert.equal(products.products[0]?.stock, 3);
  } finally {
    await app.close();
  }
});

test("SkillMart material skeleton cannot pass real Skill or execution gates", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "skillmart-materials-"));
  const outputRoot = path.join(tempRoot, "demo-output");
  try {
    const build = runNode([builderPath, "--out", outputRoot]);
    assert.equal(build.status, 0, build.stderr);

    const skeleton = runNode([validatorPath, "--root", outputRoot, "--phase", "skeleton", "--json"]);
    assert.equal(skeleton.status, 0, skeleton.stderr || skeleton.stdout);
    const skeletonResult = JSON.parse(skeleton.stdout) as { valid: boolean; phase: string; issues: unknown[] };
    assert.equal(skeletonResult.valid, true);
    assert.equal(skeletonResult.phase, "skeleton");
    assert.deepEqual(skeletonResult.issues, []);

    const skills = runNode([validatorPath, "--root", outputRoot, "--phase", "skills", "--json"]);
    assert.equal(skills.status, 2, skills.stderr || skills.stdout);
    const skillResult = JSON.parse(skills.stdout) as { valid: boolean; issues: Array<{ code: string }> };
    assert.equal(skillResult.valid, false);
    const codes = new Set(skillResult.issues.map((issue) => issue.code));
    assert.equal(codes.has("placeholder_skill_output"), true);
    assert.equal(codes.has("missing_invocation_record"), true);
    assert.equal(codes.has("missing_dual_delivery"), true);

    for (const phase of ["execution", "video"]) {
      const result = runNode([validatorPath, "--root", outputRoot, "--phase", phase, "--json"]);
      assert.equal(result.status, 2, `${phase}: ${result.stderr || result.stdout}`);
      const parsed = JSON.parse(result.stdout) as { valid: boolean; phase: string };
      assert.equal(parsed.valid, false);
      assert.equal(parsed.phase, phase);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("SkillMart execution gate validates every one of the five execution suites", async () => {
  const imported = await import(pathToFileURL(validatorPath).href) as {
    validateExecution?: (root: string) => Promise<Array<{ code: string; target: string }>>;
  };
  assert.ok(imported.validateExecution, "execution validator must be directly testable");

  const root = await mkdtemp(path.join(tmpdir(), "skillmart-execution-gate-"));
  try {
    const partial = path.join(
      root,
      "08-自动执行与证据_Automated-Execution-Evidence",
      "04-生成文件",
      "requirementWorkbench",
      ".testing-run",
      "result",
    );
    await mkdir(partial, { recursive: true });
    await writeFile(path.join(partial, "run-result.json"), "{}\n", "utf8");

    const issues = await imported.validateExecution(root);
    assert.equal(issues.some((item) => item.code === "missing_execution_suite"), true);
    assert.equal(issues.some((item) => item.target.includes("singleApiFull")), true);
    assert.equal(issues.some((item) => item.code === "incomplete_execution_suite"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SkillMart execution summary counts one cross-suite defect root cause", async () => {
  const imported = await import(pathToFileURL(executionSummaryBuilderPath).href).catch(() => undefined) as
    | { summarizeExecutionResults?: (options: { root: string }) => Promise<Record<string, unknown>> }
    | undefined;
  assert.ok(imported?.summarizeExecutionResults, "execution summary builder must exist");

  const root = await mkdtemp(path.join(tmpdir(), "skillmart-execution-summary-"));
  try {
    const fixtures = {
      requirementWorkbench: ["通过", "不通过", "待定", "未执行"],
      singleApiFull: ["不通过"],
      singleApiConcise: ["通过"],
      multiApiFlow: ["不通过"],
      productionVerification: ["通过"],
    } as const;
    for (const [suite, statuses] of Object.entries(fixtures)) {
      const resultDir = path.join(root, suite, ".testing-run", "result");
      await mkdir(resultDir, { recursive: true });
      await writeFile(path.join(resultDir, "run-result.json"), JSON.stringify({
        run_status: statuses.includes("未执行") ? "blocked" : "completed",
        cases: statuses.map((caseStatus, index) => ({ case_id: `${suite}-${index + 1}`, case_status: caseStatus })),
        defects: statuses.includes("不通过") ? [{
          root_cause_key: "idempotency-duplicate-order",
          case_ids: [`${suite}-failed`],
          evidence: [],
        }] : [],
      }), "utf8");
    }

    const summary = await imported.summarizeExecutionResults({ root }) as {
      totals: { cases: number; statuses: Record<string, number> };
      unique_bug_count: number;
      root_causes: Array<{ root_cause_key: string; suites: string[] }>;
    };
    assert.equal(summary.totals.cases, 8);
    assert.equal(summary.totals.statuses["待定"], 1);
    assert.equal(summary.unique_bug_count, 1);
    assert.deepEqual(summary.root_causes[0]?.suites, ["requirementWorkbench", "singleApiFull", "multiApiFlow"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SkillMart acceptance navigation links all eight Skills, evidence and both videos", async () => {
  const imported = await import(pathToFileURL(acceptanceNavigationBuilderPath).href).catch(() => undefined) as
    | { buildAcceptanceNavigation?: (options: { root: string }) => Promise<unknown> }
    | undefined;
  assert.ok(imported?.buildAcceptanceNavigation, "acceptance navigation builder must exist");

  const root = await mkdtemp(path.join(tmpdir(), "skillmart-navigation-"));
  try {
    const summaryDir = path.join(root, "08-自动执行与证据_Automated-Execution-Evidence", "06-验证记录");
    await mkdir(summaryDir, { recursive: true });
    await writeFile(path.join(summaryDir, "execution-summary.json"), JSON.stringify({
      totals: { cases: 62, statuses: { 未执行: 5, 通过: 46, 不通过: 8, 待定: 3 } },
      unique_bug_count: 1,
    }), "utf8");

    const tutorialDir = path.join(root, "12-第八个Skill专用教程_Eighth-Skill-Tutorial", "final-v1.0.4-20260717-125013");
    await mkdir(path.join(tutorialDir, "01-真实执行_Live-Execution"), { recursive: true });
    await mkdir(path.join(tutorialDir, "02-视频关键帧_Key-Frames"), { recursive: true });
    for (const file of [
      "完整未剪辑桌面录屏_Raw-Desktop-Session.mp4",
      "第八个Skill教程_8th-Skill-Tutorial-Edited.mp4",
      "证据索引_Evidence-Index.json",
    ]) await writeFile(path.join(tutorialDir, file), file, "utf8");
    await writeFile(path.join(tutorialDir, "01-真实执行_Live-Execution", "result.html"), "report", "utf8");
    await writeFile(path.join(tutorialDir, "02-视频关键帧_Key-Frames", "教程版接触表_Edited-Contact-Sheet.png"), "png", "utf8");

    await imported.buildAcceptanceNavigation({ root });
    const navigation = await readFile(path.join(root, "00-演示导航与视频材料", "验收导航.html"), "utf8");
    for (const marker of [
      "requirement-clarification-test",
      "requirement-test-workbench",
      "single-api-test-full",
      "single-api-test-concise",
      "multi-api-flow-test",
      "production-verification-test",
      "test-case-quality-audit",
      "web-api-test-execution-evidence",
      "测试用例（Test Cases）",
      "完整未剪辑录屏_Raw-Full-Session.mp4",
      "20分钟精剪版_Edited-Demo.mp4",
      "final-v1.0.4-20260717-125013/完整未剪辑桌面录屏_Raw-Desktop-Session.mp4",
      "final-v1.0.4-20260717-125013/第八个Skill教程_8th-Skill-Tutorial-Edited.mp4",
      "final-v1.0.4-20260717-125013/01-真实执行_Live-Execution/result.html",
      "final-v1.0.4-20260717-125013/证据索引_Evidence-Index.json",
      "final-v1.0.4-20260717-125013/02-视频关键帧_Key-Frames/教程版接触表_Edited-Contact-Sheet.png",
    ]) assert.match(navigation, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const index = JSON.parse(await readFile(path.join(root, "00-演示导航与视频材料", "证据索引.json"), "utf8")) as {
      files: Array<{ path: string; sha256: string }>;
    };
    assert.equal(index.files.some((file) => file.path === "00-演示导航与视频材料/验收导航.html"), true);
    assert.equal(index.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SkillMart raw recording sequence covers all eight Skills and real artifacts", async () => {
  const imported = await import(pathToFileURL(demoRecorderPath).href).catch(() => undefined) as
    | { recordingSegments?: () => Array<{ chapter: string; skill: string; path: string }> }
    | undefined;
  assert.ok(imported?.recordingSegments, "video recorder must expose its deterministic sequence");
  const segments = imported.recordingSegments();
  assert.ok(segments.length >= 25);
  assert.deepEqual([...new Set(segments.map((segment) => segment.chapter))], ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09"]);
  for (const skill of [
    "requirement-clarification-test",
    "requirement-test-workbench",
    "single-api-test-full",
    "single-api-test-concise",
    "multi-api-flow-test",
    "production-verification-test",
    "test-case-quality-audit",
    "web-api-test-execution-evidence",
  ]) assert.equal(segments.some((segment) => segment.skill === skill), true, skill);
  assert.equal(segments.some((segment) => segment.path.includes("run-result.json")), true);
  assert.equal(segments.some((segment) => segment.path.endsWith(".png")), true);
  assert.equal(segments.every((segment) => !segment.path.startsWith("file:")), true);
});

test("SkillMart video inspection removes local absolute paths", async () => {
  const imported = await import(pathToFileURL(demoRecorderPath).href).catch(() => undefined) as
    | { sanitizeProbeForEvidence?: (probe: { format: { filename: string } }) => { format: { filename: string } } }
    | undefined;
  assert.ok(imported?.sanitizeProbeForEvidence, "video recorder must expose probe sanitization");
  const probe = { format: { filename: "C:\\Users\\Example\\Desktop\\raw.mp4" } };

  const sanitized = imported.sanitizeProbeForEvidence(probe);

  assert.equal(sanitized.format.filename, "raw.mp4");
  assert.equal(probe.format.filename, "C:\\Users\\Example\\Desktop\\raw.mp4");
});

test("SkillMart real desktop recording manifest requires live actions and full desktop capture", async () => {
  const manifest = JSON.parse(await readFile(realDesktopManifestPath, "utf8")) as {
    capture: { source: string; width: number; height: number; fps: number };
    chapters: Array<{ id: string; required_events: string[] }>;
  };
  assert.equal(manifest.capture.source, "desktop");
  assert.equal(manifest.capture.width, 1920);
  assert.equal(manifest.capture.height, 1080);
  assert.equal(manifest.capture.fps, 60);
  assert.deepEqual(manifest.chapters.map((chapter) => chapter.id), ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
  const requiredEvents = new Set(manifest.chapters.flatMap((chapter) => chapter.required_events));
  for (const event of ["codex_prompt", "codex_response", "approval_confirmed", "web_click", "api_request", "report_backfill"]) {
    assert.equal(requiredEvents.has(event), true, event);
  }
});

test("SkillMart real desktop recorder supports a graceful stop marker", async () => {
  const recorder = await import(`${pathToFileURL(realDesktopRecorderPath).href}?t=${Date.now()}`) as {
    recordDesktopCaptureUntilStop?: unknown;
  };
  assert.equal(typeof recorder.recordDesktopCaptureUntilStop, "function");
});

test("SkillMart recording validation trusts FFprobe values instead of manifest claims", async () => {
  const validator = await import(`${pathToFileURL(validatorPath).href}?t=${Date.now()}`) as {
    validateRecordingInspection?: (inspection: unknown) => Array<{ code: string }>;
  };
  assert.equal(typeof validator.validateRecordingInspection, "function");
  const valid = {
    width: 1920,
    height: 1080,
    fps: 60,
    video_probe: {
      codec_name: "h264",
      width: 1920,
      height: 1080,
      avg_frame_rate: "60/1",
      r_frame_rate: "60/1",
    },
  };
  assert.deepEqual(validator.validateRecordingInspection?.(valid), []);

  for (const [field, value, code] of [
    ["width", 1280, "recording_resolution_invalid"],
    ["height", 720, "recording_resolution_invalid"],
    ["codec_name", "vp9", "recording_codec_invalid"],
    ["avg_frame_rate", "30/1", "recording_frame_rate_invalid"],
  ] as const) {
    const broken = structuredClone(valid);
    if (field === "width" || field === "height") broken.video_probe[field] = value as number;
    else broken.video_probe[field] = value as string;
    assert.equal(validator.validateRecordingInspection?.(broken).some((item) => item.code === code), true, field);
  }
});

test("eighth Skill tutorial finalizer rejects invalid media before evidence indexing", async () => {
  const imported = await import(pathToFileURL(eighthSkillTutorialFinalizerPath).href).catch(() => undefined) as
    | {
        validateTutorialVideoProbes?: (raw: unknown, edited: unknown) => Array<{ code: string; target: string }>;
        validateTutorialNavigationLinks?: (links: Array<{ reference: string; exists: boolean }>) => Array<{ code: string; target: string }>;
      }
    | undefined;
  assert.equal(typeof imported?.validateTutorialVideoProbes, "function");

  const video = {
    streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "60/1", r_frame_rate: "60/1" }],
    format: { duration: "76.516" },
  };
  assert.deepEqual(imported?.validateTutorialVideoProbes?.(video, {
    ...structuredClone(video),
    format: { duration: "73.316" },
  }), []);

  const invalidEdited = structuredClone(video);
  invalidEdited.streams[0]!.avg_frame_rate = "30/1";
  invalidEdited.format.duration = "1200.001";
  const issues = imported?.validateTutorialVideoProbes?.(video, invalidEdited) ?? [];
  assert.equal(issues.some((item) => item.code === "video_frame_rate_invalid" && item.target === "edited"), true);
  assert.equal(issues.some((item) => item.code === "edited_duration_exceeds_limit"), true);

  assert.deepEqual(imported?.validateTutorialNavigationLinks?.([
    { reference: "证据索引_Evidence-Index.json", exists: false },
  ]), []);
  assert.equal(imported?.validateTutorialNavigationLinks?.([
    { reference: "missing-report.html", exists: false },
  ]).some((item) => item.code === "navigation_link_missing"), true);
});

test("SkillMart live demo script routes eight real Skill calls with visible artifacts", async () => {
  const script = JSON.parse(await readFile(liveDemoScriptPath, "utf8")) as {
    chapters: Array<{
      id: string;
      primary_skill: string;
      prompt: string;
      expected_response_markers: string[];
      visible_artifact: string;
    }>;
  };
  const expectedSkills = [
    "requirement-clarification-test",
    "requirement-test-workbench",
    "single-api-test-full",
    "single-api-test-concise",
    "multi-api-flow-test",
    "production-verification-test",
    "test-case-quality-audit",
    "web-api-test-execution-evidence",
  ];
  assert.equal(script.chapters.length, 8);
  assert.deepEqual(script.chapters.map((chapter) => chapter.primary_skill), expectedSkills);
  for (const chapter of script.chapters) {
    assert.match(chapter.prompt, new RegExp(chapter.primary_skill));
    assert.ok(chapter.prompt.length >= 80, `${chapter.id} prompt must include real inputs and output instructions`);
    assert.ok(chapter.expected_response_markers.length >= 2, `${chapter.id} response markers`);
    assert.notEqual(chapter.visible_artifact.trim(), "", `${chapter.id} visible artifact`);
  }
});

test("SkillMart skeleton index records reproducible SHA-256 file evidence", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "skillmart-index-"));
  const outputRoot = path.join(tempRoot, "demo-output");
  try {
    const build = runNode([builderPath, "--out", outputRoot]);
    assert.equal(build.status, 0, build.stderr);
    const index = JSON.parse(await readFile(path.join(outputRoot, "material-index.json"), "utf8")) as {
      files?: Array<{ path: string; sha256: string }>;
    };
    assert.ok(index.files && index.files.length > 20);
    for (const file of index.files) {
      assert.match(file.path, /^[^\\]+(?:\/[^\\]+)*$/);
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
