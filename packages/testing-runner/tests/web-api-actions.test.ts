import assert from "node:assert/strict";
import test from "node:test";

import { chromium, type Page } from "playwright";

import { executeAction } from "../src/actions/action-registry.js";
import { formalEvidenceScreenshotOptions } from "../src/actions/web-adapter.js";
import { createExecutionContext } from "../src/runtime/execution-context.js";
import { resolveCredentials } from "../src/security/credential-resolver.js";
import type { ManifestAction } from "../src/types.js";
import { startDemoApp } from "./fixtures/demo-app.js";
import { startSkillMartApp } from "./fixtures/skillmart-app.js";

test("executes a mixed approved API and Web flow with declared variable reuse", async () => {
  const app = await startDemoApp();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const context = createExecutionContext({
      targets: {
        api: { kind: "api", origin: app.baseUrl },
        web: { kind: "web", origin: app.baseUrl },
      },
      approvedOrigins: [new URL(app.baseUrl).origin],
      data: {
        item_payload: { name: "Created item" },
        username: "alice",
        password: "correct-password",
      },
      page,
      secrets: resolveCredentials([], {}),
    });
    const actions: ManifestAction[] = [
      {
        type: "api.request",
        action_id: "API-001-create",
        target_alias: "api",
        method: "POST",
        path: "/api/items",
        input_ref: { source: "fixture", name: "item_payload" },
        risk: "R1",
      },
      {
        type: "api.extract",
        action_id: "API-001-extract",
        target_alias: "api",
        from: "/body/id",
        as: "created_item_id",
        risk: "R0",
      },
      {
        type: "web.goto",
        action_id: "API-001-login-page",
        target_alias: "web",
        url: `${app.baseUrl}/login`,
        risk: "R0",
      },
      {
        type: "web.fill",
        action_id: "API-001-fill-user",
        target_alias: "web",
        locator: "label=Username",
        value_ref: { source: "fixture", name: "username" },
        risk: "R0",
      },
      {
        type: "web.fill",
        action_id: "API-001-fill-password",
        target_alias: "web",
        locator: "label=Password",
        value_ref: { source: "fixture", name: "password" },
        risk: "R0",
      },
      {
        type: "web.click",
        action_id: "API-001-submit",
        target_alias: "web",
        locator: "data-testid=login-submit",
        risk: "R0",
      },
      {
        type: "web.click",
        action_id: "API-001-open-item",
        target_alias: "web",
        locator: "text=Created item",
        risk: "R0",
      },
      {
        type: "web.assert",
        action_id: "API-001-web-assert",
        target_alias: "web",
        assertion: "text=Created item",
        risk: "R0",
      },
      {
        type: "api.request",
        action_id: "API-001-read",
        target_alias: "api",
        method: "GET",
        path: "/api/items/{{created_item_id}}",
        risk: "R0",
      },
      {
        type: "api.assert",
        action_id: "API-001-api-assert",
        target_alias: "api",
        assertion: "status is 200",
        risk: "R0",
      },
    ];

    const outcomes = [];
    for (const action of actions) outcomes.push(await executeAction(action, context));

    assert.deepEqual(outcomes.map(({ status }) => status), Array.from({ length: actions.length }, () => "passed"));
    assert.ok(
      outcomes
        .find((outcome) => outcome.action_id === "API-001-create")
        ?.attachments.some((item) => item.relativePath.endsWith("api-request-response.json")),
    );
    assert.ok(
      outcomes
        .find((outcome) => outcome.action_id === "API-001-web-assert")
        ?.attachments.some((item) => item.relativePath.endsWith("web-page.png") && Buffer.isBuffer(item.content)),
    );
    assert.equal(context.variables.get("created_item_id").value, app.lastCreatedItemId());
    assert.equal(context.variables.get("created_item_id").provenance.action_id, "API-001-extract");
  } finally {
    await browser.close();
    await app.close();
  }
});

test("blocks undeclared actions, off-origin navigation and variables used before definition", async () => {
  const app = await startDemoApp();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const context = createExecutionContext({
      targets: { api: { kind: "api", origin: app.baseUrl }, web: { kind: "web", origin: app.baseUrl } },
      approvedOrigins: [new URL(app.baseUrl).origin],
      data: {},
      page,
      secrets: resolveCredentials([], {}),
    });

    assert.equal((await executeAction({
      type: "shell.exec",
      action_id: "unsafe",
      target_alias: "api",
      risk: "R0",
    } as never, context)).status, "blocked");
    assert.equal((await executeAction({
      type: "web.goto",
      action_id: "off-origin",
      target_alias: "web",
      url: "https://evil.example.test/",
      risk: "R0",
    }, context)).status, "blocked");
    assert.equal((await executeAction({
      type: "api.request",
      action_id: "missing-variable",
      target_alias: "api",
      method: "GET",
      path: "/api/items/{{missing_id}}",
      risk: "R0",
    }, context)).status, "blocked");
  } finally {
    await browser.close();
    await app.close();
  }
});

test("SSO and MFA pages produce manual_required instead of a business verdict", async () => {
  const app = await startDemoApp();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const context = createExecutionContext({
      targets: { web: { kind: "web", origin: app.baseUrl } },
      approvedOrigins: [new URL(app.baseUrl).origin],
      data: {},
      page,
      secrets: resolveCredentials([], {}),
      mode: "interactive",
    });
    const outcome = await executeAction({
      type: "web.goto",
      action_id: "mfa-page",
      target_alias: "web",
      url: `${app.baseUrl}/sso`,
      risk: "R0",
    }, context);

    assert.equal(outcome.status, "manual_required");
    assert.equal(outcome.error?.type, "manual_auth");
  } finally {
    await browser.close();
    await app.close();
  }
});

test("API requests resolve declared header, query and JSON body field references", async () => {
  const app = await startSkillMartApp();
  try {
    const context = createExecutionContext({
      targets: { api: { kind: "api", origin: app.baseUrl } },
      approvedOrigins: [new URL(app.baseUrl).origin],
      data: {
        user_a: "user-a",
        idempotency_key: "headers-and-fields-001",
        sku: "SKU-BOOK-001",
        quantity: 1,
        amount: 120,
      },
      secrets: resolveCredentials([], {}),
    });

    const create = await executeAction({
      type: "api.request",
      action_id: "create-with-header-refs",
      target_alias: "api",
      method: "POST",
      path: "/api/orders",
      header_refs: {
        "x-user-id": { source: "fixture", name: "user_a" },
        "x-idempotency-key": { source: "fixture", name: "idempotency_key" },
      },
      json_body_refs: {
        sku: { source: "fixture", name: "sku" },
        quantity: { source: "fixture", name: "quantity" },
      },
      risk: "R1",
    } as unknown as ManifestAction, context);
    assert.equal(create.status, "passed");
    assert.equal(context.lastApiResponse?.status, 201);

    const coupon = await executeAction({
      type: "api.request",
      action_id: "coupon-with-query-refs",
      target_alias: "api",
      method: "GET",
      path: "/api/coupons/SKILL20/eligibility",
      query_refs: { amount: { source: "fixture", name: "amount" } },
      risk: "R0",
    } as unknown as ManifestAction, context);
    assert.equal(coupon.status, "passed");
    assert.deepEqual(context.lastApiResponse?.body, { eligible: true, discount: 20 });
  } finally {
    await app.close();
  }
});

test("API request transport succeeds for an expected 4xx and leaves verdict to assertions", async () => {
  const app = await startSkillMartApp();
  try {
    const context = createExecutionContext({
      targets: { api: { kind: "api", origin: app.baseUrl } },
      approvedOrigins: [new URL(app.baseUrl).origin],
      data: { order_payload: { sku: "SKU-BOOK-001", quantity: 1 } },
      secrets: resolveCredentials([], {}),
    });
    const request = await executeAction({
      type: "api.request",
      action_id: "missing-identity",
      target_alias: "api",
      method: "POST",
      path: "/api/orders",
      input_ref: { source: "fixture", name: "order_payload" },
      risk: "R1",
    }, context);
    const assertion = await executeAction({
      type: "api.assert",
      action_id: "assert-401",
      target_alias: "api",
      assertion: "status is 401",
      risk: "R0",
    }, context);

    assert.equal(request.status, "passed");
    assert.equal(assertion.status, "passed");
  } finally {
    await app.close();
  }
});

test("API JSON assertions compare references and preserve declared root causes", async () => {
  const app = await startSkillMartApp();
  try {
    const context = createExecutionContext({
      targets: { api: { kind: "api", origin: app.baseUrl } },
      approvedOrigins: [new URL(app.baseUrl).origin],
      data: { expected_stock: 3, wrong_stock: 2 },
      secrets: resolveCredentials([], {}),
    });
    await executeAction({
      type: "api.request",
      action_id: "read-products",
      target_alias: "api",
      method: "GET",
      path: "/api/products",
      risk: "R0",
    }, context);
    const passing = await executeAction({
      type: "api.assert",
      action_id: "assert-stock-3",
      target_alias: "api",
      assertion: "body /body/products/0/stock equals fixture:expected_stock",
      risk: "R0",
    } as unknown as ManifestAction, context);
    const failing = await executeAction({
      type: "api.assert",
      action_id: "assert-stock-2",
      target_alias: "api",
      assertion: "body /body/products/0/stock equals fixture:wrong_stock",
      root_cause_key: "orders.idempotency.duplicate-lock",
      risk: "R0",
    } as unknown as ManifestAction, context);

    assert.equal(passing.status, "passed");
    assert.equal(failing.status, "failed");
    assert.equal(failing.root_cause_key, "orders.idempotency.duplicate-lock");
  } finally {
    await app.close();
  }
});

test("pending-only API assertions record an executed wording conflict as 待定", async () => {
  const app = await startSkillMartApp();
  try {
    const context = createExecutionContext({
      targets: { api: { kind: "api", origin: app.baseUrl } },
      approvedOrigins: [new URL(app.baseUrl).origin],
      data: { pending_verdict: "待定" },
      secrets: resolveCredentials([], {}),
    });
    await executeAction({
      type: "api.request",
      action_id: "coupon-boundary",
      target_alias: "api",
      method: "GET",
      path: "/api/coupons/SKILL20/eligibility?client_clicked_at=2026-07-15T23%3A59%3A59.000Z&server_received_at=2026-07-16T00%3A00%3A01.000Z",
      risk: "R0",
    }, context);
    const outcome = await executeAction({
      type: "api.assert",
      action_id: "coupon-boundary-pending",
      target_alias: "api",
      assertion: "body /body/verdict equals fixture:pending_verdict",
      verdict_policy: "pending_only",
      risk: "R0",
    } as unknown as ManifestAction, context);

    assert.equal(outcome.status, "pending");
    assert.deepEqual(outcome.actual, {
      assertion: "body /body/verdict equals fixture:pending_verdict",
      actual: "待定",
      expected: "待定",
    });
  } finally {
    await app.close();
  }
});

test("explicit execution gaps are blocked with inspectable evidence", async () => {
  const context = createExecutionContext({
    targets: { api: { kind: "api", origin: "http://127.0.0.1:1" } },
    approvedOrigins: ["http://127.0.0.1:1"],
    data: {},
    secrets: resolveCredentials([], {}),
  });
  const outcome = await executeAction({
    type: "execution.blocked",
    action_id: "missing-observation-entry",
    target_alias: "api",
    reason: "订单响应没有金额字段，无法判定金额断言",
    risk: "R0",
  } as unknown as ManifestAction, context);

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.error?.type, "execution_input_gap");
  assert.ok(outcome.attachments.some((item) => item.relativePath.endsWith("execution-blocked.json")));
});

test("API status assertions support requirement-safe negative comparisons", async () => {
  const app = await startSkillMartApp();
  try {
    const context = createExecutionContext({
      targets: { api: { kind: "api", origin: app.baseUrl } },
      approvedOrigins: [new URL(app.baseUrl).origin],
      data: {},
      secrets: resolveCredentials([], {}),
    });
    await executeAction({
      type: "api.request",
      action_id: "wrong-method",
      target_alias: "api",
      method: "GET",
      path: "/api/orders",
      risk: "R0",
    }, context);

    assert.equal((await executeAction({
      type: "api.assert",
      action_id: "not-created",
      target_alias: "api",
      assertion: "status is not 201",
      risk: "R0",
    } as unknown as ManifestAction, context)).status, "passed");
    assert.equal((await executeAction({
      type: "api.assert",
      action_id: "not-server-error",
      target_alias: "api",
      assertion: "status is not 500",
      risk: "R0",
    } as unknown as ManifestAction, context)).status, "passed");
  } finally {
    await app.close();
  }
});

test("concurrent API actions preserve every response for batch assertions and root-cause evidence", async () => {
  const app = await startSkillMartApp();
  try {
    const context = createExecutionContext({
      targets: { api: { kind: "api", origin: app.baseUrl } },
      approvedOrigins: [new URL(app.baseUrl).origin],
      data: {
        user_a: "user-a",
        idempotency_key: "concurrent-001",
        order_payload: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1 },
      },
      secrets: resolveCredentials([], {}),
    });
    const request = await executeAction({
      type: "api.concurrent",
      action_id: "concurrent-create",
      target_alias: "api",
      method: "POST",
      path: "/api/orders",
      concurrency: 2,
      input_ref: { source: "fixture", name: "order_payload" },
      header_refs: {
        "x-user-id": { source: "fixture", name: "user_a" },
        "x-idempotency-key": { source: "fixture", name: "idempotency_key" },
      },
      risk: "R1",
    } as unknown as ManifestAction, context);
    const statuses = await executeAction({
      type: "api.assert",
      action_id: "concurrent-statuses",
      target_alias: "api",
      assertion: "batch status all 201",
      risk: "R0",
    } as unknown as ManifestAction, context);
    const uniqueness = await executeAction({
      type: "api.assert",
      action_id: "concurrent-order-id",
      target_alias: "api",
      assertion: "batch body /body/order_id all equal",
      root_cause_key: "orders.idempotency.duplicate-lock",
      risk: "R0",
    } as unknown as ManifestAction, context);

    assert.equal(request.status, "passed");
    assert.equal(context.lastApiResponses?.length, 2);
    assert.equal(statuses.status, "passed");
    assert.equal(uniqueness.status, "failed");
    assert.equal(uniqueness.root_cause_key, "orders.idempotency.duplicate-lock");
  } finally {
    await app.close();
  }
});

test("formal Web evidence screenshots hide the visual progress host", async () => {
  assert.deepEqual(formalEvidenceScreenshotOptions(), {
    fullPage: true,
    style: "#testing-runner-visual-progress{display:none!important}",
  });
  let screenshotOptions: Parameters<Page["screenshot"]>[0];
  const page = {
    getByText: () => ({ count: async () => 1 }),
    screenshot: async (options: Parameters<Page["screenshot"]>[0]) => {
      screenshotOptions = options;
      return Buffer.from("png");
    },
  } as unknown as Page;
  const context = createExecutionContext({
    targets: { web: { kind: "web", origin: "http://127.0.0.1:64214" } },
    approvedOrigins: ["http://127.0.0.1:64214"],
    data: {},
    page,
    secrets: resolveCredentials([], {}),
  });

  const outcome = await executeAction({
    type: "web.assert",
    action_id: "clean-evidence",
    target_alias: "web",
    assertion: "text=订单创建成功",
    risk: "R0",
  }, context);

  assert.equal(outcome.status, "passed");
  assert.match(String(screenshotOptions?.style), /testing-runner-visual-progress/);
});
