import assert from "node:assert/strict";
import test from "node:test";

import { formatSchemaErrors, validateDocument } from "../src/schema-registry.js";

const TEN_COLUMNS = [
  "用例 ID",
  "所属模块",
  "用例标题",
  "验证功能点",
  "前置条件",
  "测试步骤",
  "预期结果",
  "优先级",
  "执行结果",
  "备注",
] as const;

const validReport = {
  title: "接口回归测试",
  generated_at: "2026-07-15T09:00:00.000Z",
  skill_invocation: "single-api-test-full",
  sheets: [
    {
      name: "测试用例",
      kind: "test_cases",
      columns: TEN_COLUMNS,
      rows: [
        {
          values: [
            "API-001",
            "订单",
            "查询订单",
            "返回订单详情",
            "订单已存在",
            "调用查询接口",
            "返回 200",
            "P1",
            "未执行",
            "",
          ],
        },
      ],
    },
  ],
};

const validExecutionProfile = {
  protocol_version: "1.0.0",
  profile_id: "local-api",
  targets: {
    api: { kind: "api", origin: "https://api.example.test" },
  },
  credentials: {
    api_admin: { source: "env", name: "TESTING_API_TOKEN" },
  },
};

const validManifest = {
  protocol_version: "1.0.0",
  manifest_id: "manifest-001",
  runner: { version: "1.0.0" },
  source: { path: "report.json", sha256: "a".repeat(64) },
  cases: [
    {
      case_id: "API-001",
      original: Object.fromEntries(TEN_COLUMNS.map((column) => [column, ""])),
      steps: [
        {
          type: "api.request",
          action_id: "API-001-step-1",
          target_alias: "api",
          method: "GET",
          path: "/orders/1",
          input_ref: { source: "fixture", name: "order_query" },
          risk: "R0",
        },
      ],
    },
  ],
};

const validApproval = {
  protocol_version: "1.0.0",
  approval_id: "approval-001",
  manifest_hash: "b".repeat(64),
  source_hash: "a".repeat(64),
  runner: { version: "1.0.0" },
  rule_versions: ["1.0.0"],
  targets: ["https://api.example.test"],
  approved_risks: ["R0"],
  approved_r3_action_ids: [],
  issued_by: "tester@example.test",
  issued_at: "2026-07-15T09:00:00.000Z",
  expires_at: "2026-07-15T10:00:00.000Z",
};

const validRunResult = {
  protocol_version: "1.0.0",
  run_id: "run-001",
  manifest_hash: "b".repeat(64),
  run_status: "completed",
  started_at: "2026-07-15T09:01:00.000Z",
  completed_at: "2026-07-15T09:02:00.000Z",
  cases: [
    {
      case_id: "API-001",
      case_status: "通过",
      run_status: "completed",
      assertions: [],
      evidence: [],
    },
  ],
};

const validDocuments = [
  ["report", validReport],
  ["execution-profile", validExecutionProfile],
  ["run-manifest", validManifest],
  ["approval", validApproval],
  ["run-result", validRunResult],
] as const;

test("accepts one minimal valid fixture for every protocol document", () => {
  for (const [schemaId, fixture] of validDocuments) {
    const value = structuredClone(fixture);
    assert.equal(validateDocument(schemaId, value), value, schemaId);
  }
});

test("report rejects a fifth business status", () => {
  const value = structuredClone(validReport);
  value.sheets[0].rows[0].values[8] = "执行异常";
  assert.throws(() => validateDocument("report", value), /执行异常|执行结果/);
});

test("report accepts canonical divider rows with a dash status", () => {
  const value = structuredClone(validReport);
  value.sheets[0].rows.unshift({
    divider: true,
    values: ["【模块分割行】", "第 1 模块：订单", "订单流程", "-", "-", "-", "-", "-", "-", "模块起始分割"],
  } as never);

  assert.equal(validateDocument("report", value), value);
});

test("all versioned documents require protocol version 1.0.0", () => {
  for (const [schemaId, fixture] of validDocuments.slice(1)) {
    const value = structuredClone(fixture) as { protocol_version: string };
    value.protocol_version = "1.0";
    assert.throws(() => validateDocument(schemaId, value), /1\.0/);
  }
});

test("manifest requires Runner version 1.0.0", () => {
  const value = structuredClone(validManifest);
  delete (value.cases[0].steps[0] as { input_ref?: unknown }).input_ref;
  value.runner.version = "1.0.1";
  assert.throws(() => validateDocument("run-manifest", value), /\/runner\/version/);
});

test("manifest rejects arbitrary executable actions", () => {
  const value = structuredClone(validManifest);
  value.cases[0].steps[0] = { type: "shell.exec", command: "whoami" } as never;
  assert.throws(() => validateDocument("run-manifest", value), /shell\.exec/);
});

test("execution profile validates every field consumed by planning and runtime", () => {
  const value = structuredClone(validExecutionProfile) as Record<string, unknown>;
  value.manifest_id = "manifest-profile-001";
  value.public_targets = ["api"];
  value.data = {
    keyword: "数码宝贝",
    expected_count: 1,
  };
  value.cleanup_strategies = { "API-001": "api" };
  value.rule_versions = ["1.1.0"];
  value.risk_contexts = {
    "API-001-request": { environment_label: "isolated-test", shared_data: false },
  };
  value.case_plans = {
    "API-001": [
      {
        type: "api.request",
        action_id: "API-001-request",
        target_alias: "api",
        method: "GET",
        path: "/orders/1",
        risk: "R0",
      },
      {
        type: "api.assert",
        action_id: "API-001-assert",
        target_alias: "api",
        assertion: "status is 200",
        risk: "R0",
      },
    ],
  };

  assert.equal(validateDocument("execution-profile", value), value);
});

test("manifest accepts an explicit double click and rejects unsupported click counts", () => {
  const value = structuredClone(validManifest);
  value.cases[0].steps[0] = {
    type: "web.click",
    action_id: "WEB-001-double-click",
    target_alias: "web",
    locator: "data-testid=create-order",
    click_count: 2,
    risk: "R1",
  } as never;
  assert.equal(validateDocument("run-manifest", value), value);

  const unsupported = structuredClone(value);
  (unsupported.cases[0].steps[0] as { click_count: number }).click_count = 3;
  assert.throws(() => validateDocument("run-manifest", unsupported), /click_count/);
});

test("manifest accepts reference-only request controls and explicit execution verdict metadata", () => {
  const value = structuredClone(validManifest);
  value.cases[0].steps = [
    {
      type: "api.request",
      action_id: "API-001-request-controls",
      target_alias: "api",
      method: "POST",
      path: "/orders",
      header_refs: {
        "x-user-id": { source: "fixture", name: "user_a" },
        authorization: { source: "env", name: "api_authorization" },
      },
      query_refs: { dry_run: { source: "fixture", name: "dry_run" } },
      json_body_refs: { order_id: { source: "output", name: "order_id" } },
      risk: "R1",
    },
    {
      type: "api.request",
      action_id: "API-001-raw-body",
      target_alias: "api",
      method: "POST",
      path: "/orders",
      raw_body_ref: { source: "fixture", name: "malformed_json" },
      risk: "R1",
    },
    {
      type: "api.assert",
      action_id: "API-001-assert",
      target_alias: "api",
      assertion: "body /body/order_id equals output:order_id",
      verdict_policy: "pending_only",
      root_cause_key: "orders.idempotency.duplicate-lock",
      risk: "R0",
    },
    {
      type: "api.concurrent",
      action_id: "API-001-concurrent",
      target_alias: "api",
      method: "GET",
      path: "/orders",
      concurrency: 5,
      header_refs: { "x-user-id": { source: "fixture", name: "user_a" } },
      risk: "R0",
    },
    {
      type: "execution.blocked",
      action_id: "API-001-blocked",
      target_alias: "api",
      reason: "缺少金额可观察字段",
      risk: "R0",
    },
  ] as never;

  assert.equal(validateDocument("run-manifest", value), value);
});

test("execution profile rejects literal password fields", () => {
  const value = structuredClone(validExecutionProfile) as Record<string, unknown>;
  value.password = "do-not-store-this";
  assert.throws(() => validateDocument("execution-profile", value), /password/);
});

test("credential-bearing target URLs and database hosts are rejected", () => {
  const unsafeTargets = [
    { api: { kind: "api", origin: "https://admin:password@api.example.test" } },
    { api: { kind: "api", origin: "HTTPS://admin:password@api.example.test" } },
    { api: { kind: "api", origin: "https://api.example.test/orders?token=literal-token" } },
    {
      database: {
        kind: "database",
        dialect: "postgresql",
        host: "postgresql://admin:password@db.example.test/orders",
        database: "orders",
      },
    },
    {
      database: {
        kind: "database",
        dialect: "postgresql",
        host: "db.example.test",
        database: "postgresql://admin:password@db.example.test/orders",
      },
    },
  ];

  for (const targets of unsafeTargets) {
    const value = structuredClone(validExecutionProfile) as Record<string, unknown>;
    value.targets = targets;
    assert.throws(() => validateDocument("execution-profile", value), /password|origin|host|target/);
  }
});

test("approval rejects URL userinfo", () => {
  for (const unsafeTarget of [
    "https://admin:password@api.example.test",
    "HTTPS://admin:password@api.example.test",
    "https://api.example.test/orders?token=literal-token",
  ]) {
    const value = structuredClone(validApproval);
    value.targets[0] = unsafeTarget;
    assert.throws(() => validateDocument("approval", value), /password|token|targets/);
  }
});

test("manifest rejects URL userinfo and literal credentials in original source rows", () => {
  const unsafeUrl = structuredClone(validManifest);
  unsafeUrl.cases[0].steps[0] = {
    type: "web.goto",
    action_id: "API-001-step-1",
    target_alias: "web",
    url: "https://admin:password@app.example.test",
    risk: "R0",
  } as never;
  assert.throws(() => validateDocument("run-manifest", unsafeUrl), /password|url/);

  const unsafeQueryCredential = structuredClone(validManifest);
  unsafeQueryCredential.cases[0].steps[0] = {
    type: "web.goto",
    action_id: "API-001-step-1",
    target_alias: "web",
    url: "https://app.example.test/login?token=literal-token",
    risk: "R0",
  } as never;
  assert.throws(() => validateDocument("run-manifest", unsafeQueryCredential), /token|url/);

  const unsafeOriginal = structuredClone(validManifest);
  unsafeOriginal.cases[0].original["前置条件"] = "password=super-secret";
  assert.throws(() => validateDocument("run-manifest", unsafeOriginal), /password|前置条件/);
});

test("manifest data inputs use structured references instead of literal strings", () => {
  const unsafeActions = [
    {
      type: "web.fill",
      action_id: "API-001-fill",
      target_alias: "web",
      locator: "label=Password",
      value_ref: "literal-password",
      risk: "R1",
    },
    {
      type: "api.request",
      action_id: "API-001-request",
      target_alias: "api",
      method: "POST",
      path: "/orders",
      input_ref: '{"token":"literal-token"}',
      risk: "R1",
    },
    {
      type: "db.select",
      action_id: "API-001-query",
      target_alias: "database",
      query: "SELECT id FROM orders WHERE id = $1",
      params_ref: "postgresql://admin:password@db.example.test/orders",
      risk: "R0",
    },
  ];

  for (const action of unsafeActions) {
    const value = structuredClone(validManifest);
    value.cases[0].steps[0] = action as never;
    assert.throws(() => validateDocument("run-manifest", value), /_ref|literal|password/);
  }
});

test("API and cleanup paths reject every query string and fragment", () => {
  const unsafeActions = [
    {
      type: "web.goto",
      action_id: "API-001-login-page",
      target_alias: "web",
      url: "https://app.example.test/login?access_token=literal-token",
      risk: "R0",
    },
    {
      type: "api.request",
      action_id: "API-001-search",
      target_alias: "api",
      method: "GET",
      path: "/search?mode=tokenization",
      risk: "R0",
    },
    {
      type: "cleanup.api",
      action_id: "API-001-cleanup",
      target_alias: "api",
      method: "DELETE",
      path: "/session#cleanup",
      risk: "R1",
    },
  ];

  for (const action of unsafeActions) {
    const value = structuredClone(validManifest);
    value.cases[0].steps[0] = action as never;
    assert.throws(() => validateDocument("run-manifest", value), /token|path|url/);
  }
});

test("persisted assertions and SQL reject credential literals", () => {
  const unsafeActions = [
    {
      type: "api.assert",
      action_id: "API-001-auth",
      target_alias: "api",
      assertion: "Authorization: Bearer literal-token",
      risk: "R0",
    },
    {
      type: "web.assert",
      action_id: "API-001-cookie",
      target_alias: "web",
      assertion: "Cookie: session=literal-cookie",
      risk: "R0",
    },
    {
      type: "db.select",
      action_id: "API-001-password",
      target_alias: "database",
      query: "SELECT id FROM users WHERE password = 'literal-secret'",
      risk: "R0",
    },
  ];

  for (const action of unsafeActions) {
    const value = structuredClone(validManifest);
    value.cases[0].steps[0] = action as never;
    assert.throws(() => validateDocument("run-manifest", value), /assertion|query|Bearer|Cookie|password/);
  }
});

test("run results classify snake, kebab, and camel credential aliases", () => {
  const secretKeys = [
    "user_password",
    "dbPassword",
    "new-password",
    "password_value",
    "accessToken",
    "refresh_token",
    "idToken",
    "clientSecret",
    "apiKey",
    "authorization",
    "proxyAuthorization",
    "cookie",
    "setCookie",
    "connectionString",
  ];

  for (const secretKey of secretKeys) {
    const value = structuredClone(validRunResult);
    value.cases[0].assertions = [
      {
        assertion_id: "assertion-1",
        passed: false,
        actual: { response: [{ metadata: { [secretKey]: "literal-secret" } }] },
      },
    ] as never;
    assert.throws(() => validateDocument("run-result", value), new RegExp(secretKey.replace("-", "\\-"), "i"));
  }
});

test("semantic errors include the nested JSON Pointer", () => {
  const value = structuredClone(validRunResult);
  value.cases[0].assertions = [
    {
      assertion_id: "assertion-1",
      passed: false,
      actual: { response: [{ dbPassword: "literal-secret" }] },
    },
  ] as never;

  assert.throws(
    () => validateDocument("run-result", value),
    /\/cases\/0\/assertions\/0\/actual\/response\/0\/dbPassword/,
  );
});

test("run-result strings reject auth schemes, connection URIs, and URL userinfo", () => {
  const unsafeValues = [
    "Bearer literal-token",
    "Basic dXNlcjpwYXNzd29yZA==",
    "postgresql://admin:password@db.example.test/orders",
    "https://admin:password@api.example.test/result",
    "HTTPS://admin:password@api.example.test/result",
  ];

  for (const unsafeValue of unsafeValues) {
    const value = structuredClone(validRunResult);
    value.cases[0].assertions = [
      {
        assertion_id: "assertion-1",
        passed: false,
        actual: { messages: [unsafeValue] },
        expected: "safe",
      },
    ] as never;
    assert.throws(() => validateDocument("run-result", value), /actual|Bearer|Basic|postgresql|password/);
  }

  const evidenceValue = structuredClone(validRunResult);
  evidenceValue.cases[0].evidence = [
    { path: "https://admin:password@files.example.test/evidence.json", sha256: "c".repeat(64) },
  ];
  assert.throws(() => validateDocument("run-result", evidenceValue), /path|password/);
});

test("safe absence and masking prose remains valid", () => {
  const manifest = structuredClone(validManifest);
  manifest.cases[0].steps[0] = {
    type: "api.assert",
    action_id: "API-001-safe-auth",
    target_alias: "api",
    assertion: "Authorization: header must be absent; Cookie: not present",
    risk: "R0",
  } as never;
  manifest.cases[0].original["备注"] = "Authorization: omitted; Cookie: empty";
  assert.equal(validateDocument("run-manifest", manifest), manifest);

  const result = structuredClone(validRunResult);
  result.cases[0].assertions = [
    {
      assertion_id: "assertion-1",
      passed: true,
      actual: {
        authorization: "header must be absent",
        cookie: "not present",
        proxyAuthorization: "redacted",
        clientSecret: "masked",
        accessToken: "omitted",
        refresh_token: "empty",
        connectionString: "null",
        apiKey: null,
        password_value: "已脱敏",
        setCookie: "未返回",
      },
    },
  ] as never;
  assert.equal(validateDocument("run-result", result), result);
});

test("safe business text, nested data, paths, and parameterized SQL remain valid", () => {
  const manifest = structuredClone(validManifest);
  manifest.cases[0].original["前置条件"] = "Password field is required; tokenization remains enabled";
  manifest.cases[0].steps[0] = {
    type: "db.select",
    action_id: "API-001-query",
    target_alias: "database",
    query: "SELECT id FROM users WHERE password = $1 AND access_token = :accessToken AND client_secret = ? AND token = @token",
    params_ref: { source: "fixture", name: "user_query_params" },
    risk: "R0",
  } as never;
  assert.equal(validateDocument("run-manifest", manifest), manifest);

  const result = structuredClone(validRunResult);
  result.cases[0].assertions = [
    {
      assertion_id: "assertion-1",
      passed: true,
      actual: {
        order: {
          status: "paid",
          tokenization: "completed",
          secretary: "available",
          messages: ["Password field is required", "business token expired"],
        },
      },
      expected: [{ status: "paid", retry_count: 0 }],
    },
  ] as never;
  assert.equal(validateDocument("run-result", result), result);

  const request = structuredClone(validManifest);
  request.cases[0].steps[0].path = "/search";
  assert.equal(validateDocument("run-manifest", request), request);
});

test("manifest requires its protocol version", () => {
  const value = structuredClone(validManifest) as Partial<typeof validManifest>;
  delete value.protocol_version;
  assert.throws(() => validateDocument("run-manifest", value), /protocol_version/);
});

test("business and runtime states remain separate", () => {
  const value = structuredClone(validRunResult);
  value.cases[0].case_status = "executor_error";
  assert.throws(() => validateDocument("run-result", value), /case_status/);
});

test("schema errors expose normalized JSON Pointer messages", () => {
  const value = structuredClone(validManifest) as Partial<typeof validManifest>;
  delete value.protocol_version;

  let caught: Error | undefined;
  try {
    validateDocument("run-manifest", value);
  } catch (error) {
    caught = error as Error;
  }

  assert.ok(caught);
  assert.deepEqual(formatSchemaErrors(caught), [
    "/protocol_version: must have required property 'protocol_version'",
  ]);
});
