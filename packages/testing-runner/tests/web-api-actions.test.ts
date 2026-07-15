import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { executeAction } from "../src/actions/action-registry.js";
import { createExecutionContext } from "../src/runtime/execution-context.js";
import { resolveCredentials } from "../src/security/credential-resolver.js";
import type { ManifestAction } from "../src/types.js";
import { startDemoApp } from "./fixtures/demo-app.js";

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
