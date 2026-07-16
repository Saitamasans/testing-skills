import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialVisualProgressState,
  renderVisualProgressHtml,
  summarizeProgressAction,
  VisualProgressController,
} from "../src/runtime/visual-progress.js";
import type { ActionCompletedEvent } from "../src/runtime/run-orchestrator.js";
import type { ManifestAction } from "../src/types.js";
import type { Page } from "playwright";

test("visual progress renders the current Test Case, action, targets, and four-state totals", () => {
  const state = createInitialVisualProgressState({
    manifestHash: "a".repeat(64),
    origins: ["http://127.0.0.1:64214"],
    caseTotal: 18,
  });
  state.phase = "running";
  state.caseIndex = 2;
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

  assert.match(html, /测试用例（Test Case） 2 \/ 18/);
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
