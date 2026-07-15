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

test("database driver loading is fixed and reports missing optional packages without installing", async () => {
  await assert.rejects(() => loadDatabaseAdapter("postgresql"), /npm install pg/i);
  await assert.rejects(() => loadDatabaseAdapter("mysql"), /npm install mysql2/i);
});
