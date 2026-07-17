import assert from "node:assert/strict";
import test from "node:test";

import { executeAction } from "../src/actions/action-registry.js";
import {
  loadDatabaseAdapter,
  type DatabaseAdapter,
} from "../src/actions/database-adapter.js";
import { validateReadonlyQuery } from "../src/actions/sql-readonly.js";
import { createExecutionContext } from "../src/runtime/execution-context.js";
import { resolveCredentials } from "../src/security/credential-resolver.js";
import type { ManifestAction } from "../src/types.js";

test("accepts single parameterized SELECT statements and read-only CTEs", () => {
  for (const sql of [
    "SELECT id, name FROM users WHERE id = $1 LIMIT 1",
    "WITH recent AS (SELECT id FROM users WHERE id = $1) SELECT id FROM recent",
  ]) {
    const parsed = validateReadonlyQuery(sql, "postgresql");
    assert.equal(parsed.statement_count, 1);
    assert.equal(parsed.dialect, "postgresql");
  }

  assert.equal(
    validateReadonlyQuery("SELECT id FROM users WHERE id = ? LIMIT 1", "mysql").dialect,
    "mysql",
  );
});

test("rejects writes, multi-statements, comments, locks, file functions and transaction controls", () => {
  const unsafeQueries = [
    "SELECT * FROM users; SELECT * FROM secrets",
    "SELECT * FROM users -- ; DROP TABLE users",
    "/* hide */ SELECT * FROM users",
    "INSERT INTO users(id) VALUES (1)",
    "UPDATE users SET name = $1",
    "DELETE FROM users",
    "DROP TABLE users",
    "ALTER TABLE users ADD COLUMN bad text",
    "CALL refresh_cache()",
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT * FROM users FOR UPDATE",
    "BEGIN; SELECT * FROM users",
    "WITH deleted AS (DELETE FROM users RETURNING *) SELECT * FROM deleted",
  ];

  for (const sql of unsafeQueries) {
    assert.throws(() => validateReadonlyQuery(sql, "postgresql"), /single read-only SELECT|comment|lock|function|transaction/i, sql);
  }
});

test("executes db.select through an injected read-only adapter and redacts bounded rows", async () => {
  const adapter: DatabaseAdapter = {
    dialect: "postgresql",
    probeReadOnly: async () => true,
    select: async () => ({
      rows: [
        { id: "u1", email: "customer@example.test", accessToken: "literal-token", status: "active" },
      ],
      row_count: 1,
      bytes: 96,
    }),
  };
  const context = createExecutionContext({
    targets: {
      database: {
        kind: "database",
        dialect: "postgresql",
        host: "db.example.test",
        database: "orders",
      },
    },
    approvedOrigins: [],
    data: {
      user_query: { id: "u1" },
      expected_status: "active",
    },
    secrets: resolveCredentials([], {}),
    databaseAdapters: { postgresql: adapter },
  });
  const action: ManifestAction = {
    type: "db.select",
    action_id: "DB-001",
    target_alias: "database",
    query: "SELECT id, email, status FROM users WHERE id = $1",
    params_ref: { source: "fixture", name: "user_query" },
    limit: 10,
    risk: "R0",
  };

  const outcome = await executeAction(action, context);

  assert.equal(outcome.status, "passed");
  assert.doesNotMatch(JSON.stringify(outcome.actual), /customer@example\.test|literal-token/);
  assert.match(JSON.stringify(outcome.actual), /row_count/);

  const countAssertion = await executeAction({
    type: "db.assert",
    action_id: "DB-001-count",
    target_alias: "database",
    assertion: "row-count equals 1",
    risk: "R0",
  } as ManifestAction, context);
  const fieldAssertion = await executeAction({
    type: "db.assert",
    action_id: "DB-001-status",
    target_alias: "database",
    assertion: "row 0 field status equals fixture:expected_status",
    risk: "R0",
  } as ManifestAction, context);

  assert.equal(countAssertion.status, "passed");
  assert.equal(fieldAssertion.status, "passed");
});

test("db.assert blocks when no prior database result exists", async () => {
  const context = createExecutionContext({
    targets: {
      database: {
        kind: "database",
        dialect: "postgresql",
        host: "db.example.test",
        database: "orders",
      },
    },
    approvedOrigins: [],
    secrets: resolveCredentials([], {}),
  });

  const outcome = await executeAction({
    type: "db.assert",
    action_id: "DB-NO-RESULT",
    target_alias: "database",
    assertion: "row-count equals 1",
    risk: "R0",
  } as ManifestAction, context);

  assert.equal(outcome.status, "blocked");
  assert.match(outcome.error?.message ?? "", /database result/i);
});

test("blocks db.select when read-only capability cannot be demonstrated", async () => {
  const adapter: DatabaseAdapter = {
    dialect: "postgresql",
    probeReadOnly: async () => false,
    select: async () => {
      throw new Error("select must not run");
    },
  };
  const context = createExecutionContext({
    targets: {
      database: {
        kind: "database",
        dialect: "postgresql",
        host: "db.example.test",
        database: "orders",
      },
    },
    approvedOrigins: [],
    secrets: resolveCredentials([], {}),
    databaseAdapters: { postgresql: adapter },
  });

  const outcome = await executeAction({
    type: "db.select",
    action_id: "DB-READONLY",
    target_alias: "database",
    query: "SELECT id FROM users",
    risk: "R0",
  }, context);

  assert.equal(outcome.status, "blocked");
  assert.match(outcome.error?.message ?? "", /read-only/i);
});

test("built-in database drivers require explicit credential aliases instead of guessing", async () => {
  const secrets = resolveCredentials([], {});
  await assert.rejects(() => loadDatabaseAdapter({
    kind: "database",
    dialect: "postgresql",
    host: "db.example.test",
    database: "orders",
  }, secrets), /credential aliases/i);
  await assert.rejects(() => loadDatabaseAdapter({
    kind: "database",
    dialect: "mysql",
    host: "db.example.test",
    database: "orders",
  }, secrets), /credential aliases/i);
});

test("built-in PostgreSQL and MySQL drivers load only from explicit runtime credential aliases", async () => {
  const secrets = resolveCredentials([
    { alias: "db_user", source: "configured_env", name: "TEST_DB_USER" },
    { alias: "db_password", source: "configured_env", name: "TEST_DB_PASSWORD" },
  ], {
    TEST_DB_USER: "readonly-user",
    TEST_DB_PASSWORD: "runtime-only-password",
  });
  for (const dialect of ["postgresql", "mysql"] as const) {
    const adapter = await loadDatabaseAdapter({
      kind: "database",
      dialect,
      host: "127.0.0.1",
      database: "orders",
      username_credential: "db_user",
      password_credential: "db_password",
    }, secrets);
    assert.equal(adapter.dialect, dialect);
    await adapter.close?.();
  }
});
