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

test("execution profile rejects literal password fields", () => {
  const value = structuredClone(validExecutionProfile) as Record<string, unknown>;
  value.password = "do-not-store-this";
  assert.throws(() => validateDocument("execution-profile", value), /password/);
});

test("credential-bearing target URLs and database hosts are rejected", () => {
  const unsafeTargets = [
    { api: { kind: "api", origin: "https://admin:password@api.example.test" } },
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
