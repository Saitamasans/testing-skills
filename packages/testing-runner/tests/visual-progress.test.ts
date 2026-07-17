import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialVisualProgressState,
  renderVisualProgressHtml,
  summarizeProgressAction,
  VisualProgressController,
} from "../src/runtime/visual-progress.js";
import {
  collectingState,
  resultsState,
} from "../src/runtime/visual-progress-model.js";
import type { ActionCompletedEvent } from "../src/runtime/run-orchestrator.js";
import type { ManifestAction } from "../src/types.js";
import type { Page } from "playwright";

test("presentation model exposes the complete five-stage transition flow", async () => {
  const model = await import("../src/runtime/visual-progress-model.js") as Record<string, unknown>;

  for (const name of [
    "casePreviewState",
    "actionStartedState",
    "actionCompletedState",
    "collectingState",
    "resultsState",
    "actionPresentation",
  ]) {
    assert.equal(typeof model[name], "function", name);
  }
});

test("case preview and API presentation contain readable test intent without secret references", async () => {
  const model = await import("../src/runtime/visual-progress-model.js") as {
    casePreviewState(state: unknown, item: unknown, caseIndex: number): Record<string, unknown>;
    actionStartedState(state: unknown, action: ManifestAction): Record<string, unknown>;
    actionCompletedState(state: unknown, action: ManifestAction, outcome: unknown): Record<string, unknown>;
  };
  const initial = createInitialVisualProgressState({
    manifestHash: "a".repeat(64),
    origins: ["http://127.0.0.1:64214"],
    caseTotal: 1,
    actionTotal: 1,
  } as Parameters<typeof createInitialVisualProgressState>[0] & { actionTotal: number });
  const item = {
    case_id: "API-007",
    original: {
      "用例 ID": "API-007",
      "所属模块": "订单创建",
      "用例标题": "重复提交不得生成两笔订单",
      "验证功能点": "订单幂等",
      "前置条件": "商品库存充足",
      "测试步骤": "重复提交相同幂等键",
      "预期结果": "只生成一笔订单",
      "优先级": "P0",
      "执行结果": "",
      "备注": "",
    },
    steps: [],
  };
  const preview = model.casePreviewState(initial, item, 1);
  assert.equal(preview.phase, "case-preview");
  assert.equal(preview.caseLabel, "第 1 / 1 条测试用例（Test Case）");
  assert.equal(preview.verificationPoint, "订单幂等");
  assert.equal(preview.precondition, "商品库存充足");
  assert.equal(preview.expectedResult, "只生成一笔订单");

  const action = {
    type: "api.request",
    action_id: "API-007-request",
    target_alias: "api",
    method: "POST",
    path: "/api/orders",
    risk: "R1",
    header_refs: { Authorization: { source: "env", name: "SECRET_TOKEN" } },
    input_ref: { source: "fixture", name: "PRIVATE_ORDER_PAYLOAD" },
  } as ManifestAction;
  const running = model.actionStartedState(preview, action);
  assert.equal(running.phase, "running");
  assert.equal(running.view, "api");

  const completed = model.actionCompletedState(running, action, {
    status: "passed",
    actual: {
      request: { method: "POST", path: "/api/orders" },
      response: { status: 201, body: { order_id: "ORD-0001" } },
    },
    attachments: [],
  });
  const presentation = completed.actionPresentation as Record<string, unknown>;
  assert.equal(presentation.method, "POST");
  assert.equal(presentation.path, "/api/orders");
  assert.equal(presentation.responseStatus, 201);
  assert.doesNotMatch(JSON.stringify(presentation), /SECRET_TOKEN|PRIVATE_ORDER_PAYLOAD|Authorization/);
});

test("initial presentation starts with a complete execution preflight", () => {
  const state = createInitialVisualProgressState({
    manifestHash: "a".repeat(64),
    origins: ["http://127.0.0.1:64214"],
    caseTotal: 18,
    actionTotal: 42,
  } as Parameters<typeof createInitialVisualProgressState>[0] & { actionTotal: number }) as unknown as {
    phase: string;
    caseLabel: string;
    actionTotalOverall: number;
  };

  assert.equal(state.phase, "preflight");
  assert.equal(state.caseLabel, "18 条测试用例（Test Cases）");
  assert.equal(state.actionTotalOverall, 42);
});

test("preflight renders execution scope and promised delivery artifacts", () => {
  const state = createInitialVisualProgressState({
    manifestHash: "a".repeat(64),
    origins: ["http://127.0.0.1:64214"],
    caseTotal: 18,
    actionTotal: 42,
  });

  const html = renderVisualProgressHtml(state);

  assert.match(html, /data-phase="preflight"/);
  assert.match(html, /执行准备/);
  assert.match(html, /18 条测试用例（Test Cases）/);
  assert.match(html, /42 个执行动作/);
  assert.match(html, /Excel/);
  assert.match(html, /HTML/);
  assert.match(html, /JSON/);
  assert.match(html, /Trace/);
});

test("results center renders each business status with the approved row treatment", () => {
  const initial = createInitialVisualProgressState({
    manifestHash: "a".repeat(64),
    origins: ["http://127.0.0.1:64214"],
    caseTotal: 4,
    actionTotal: 8,
  });
  const result = {
    protocol_version: "1.0.0",
    run_id: "run-results",
    manifest_hash: "a".repeat(64),
    run_status: "completed",
    started_at: "2026-07-17T00:00:00.000Z",
    completed_at: "2026-07-17T00:01:00.000Z",
    cases: [
      { case_id: "PASS-1", case_status: "通过", run_status: "completed", assertions: [], evidence: [] },
      { case_id: "FAIL-1", case_status: "不通过", run_status: "completed", assertions: [], evidence: [] },
      { case_id: "PENDING-1", case_status: "待定", run_status: "completed", assertions: [], evidence: [] },
      { case_id: "IDLE-1", case_status: "未执行", run_status: "blocked", assertions: [], evidence: [] },
    ],
  } as const;
  const state = resultsState(collectingState(initial, result), {
    result,
    artifacts: [
      { kind: "excel", label: "Excel 执行报告", fileName: "result.xlsx", href: "file:///result.xlsx", exists: true },
      { kind: "html", label: "HTML 执行报告", fileName: "result.html", href: "file:///result.html", exists: true },
    ],
  });

  const html = renderVisualProgressHtml(state);

  assert.match(html, /data-phase="results"/);
  assert.match(html, /data-case-status="通过" class="status-row status-passed"/);
  assert.match(html, /data-case-status="不通过" class="status-row status-failed"/);
  assert.match(html, /data-case-status="待定" class="status-row status-pending"/);
  assert.match(html, /data-case-status="未执行" class="status-row status-idle"/);
  assert.match(html, /result\.xlsx/);
  assert.match(html, /result\.html/);
});

test("visual progress renders the current Test Case, action, targets, and four-state totals", () => {
  const state = createInitialVisualProgressState({
    manifestHash: "a".repeat(64),
    origins: ["http://127.0.0.1:64214"],
    caseTotal: 18,
  });
  state.phase = "running";
  state.caseIndex = 2;
  state.caseLabel = "第 2 / 18 条测试用例（Test Case）";
  state.caseId = "WEB-002";
  state.caseTitle = "创建订单并核对库存";
  state.module = "订单创建";
  state.actionIndex = 3;
  state.actionTotal = 6;
  state.actionType = "api.request";
  state.actionSummary = "POST /api/orders";
  state.actionStatus = "执行中";
  state.counts = { "通过": 1, "不通过": 0, "待定": 0, "未执行": 17 };

  const html = renderVisualProgressHtml(state);

  assert.match(html, /第 2 \/ 18 条测试用例（Test Case）/);
  assert.match(html, /WEB-002/);
  assert.match(html, /创建订单并核对库存/);
  assert.match(html, /api\.request/);
  assert.match(html, /POST \/api\/orders/);
  assert.match(html, /http:\/\/127\.0\.0\.1:64214/);
  assert.match(html, /通过/);
  assert.match(html, /不通过/);
  assert.match(html, /待定/);
  assert.match(html, /未执行/);
});

test("action summaries never expose credential or payload reference names", () => {
  const action = {
    type: "api.request",
    action_id: "API-001-request",
    target_alias: "api",
    method: "POST",
    path: "/api/orders",
    risk: "R1",
    header_refs: { Authorization: { source: "env", name: "SECRET_TOKEN" } },
    input_ref: { source: "fixture", name: "PRIVATE_ORDER_PAYLOAD" },
  } as ManifestAction;

  const summary = summarizeProgressAction(action);

  assert.equal(summary, "POST /api/orders");
  assert.doesNotMatch(summary, /SECRET_TOKEN|PRIVATE_ORDER_PAYLOAD/);
});

test("visual progress keeps each completed action visible for the configured slow motion", async () => {
  const pauses: number[] = [];
  const page = { evaluate: async () => undefined } as unknown as Page;
  const controller = new VisualProgressController(
    page,
    false,
    350,
    async (milliseconds) => { pauses.push(milliseconds); },
  );

  await controller.actionCompleted({
    action: {
      type: "api.request",
      action_id: "API-001-request",
      target_alias: "api",
      method: "GET",
      path: "/api/products",
      risk: "R0",
    },
    outcome: { status: "passed", actual: { status: 200 }, evidence: [] },
  } as unknown as ActionCompletedEvent);

  assert.deepEqual(pauses, [350]);
});
