import {
  ActionExecutionError,
  resolveDataReference,
  targetFor,
  type ActionStepResult,
  type ExecutionContext,
} from "../runtime/execution-context.js";
import { redact } from "../security/redactor.js";
import type { RuntimeSecretStore } from "../security/credential-resolver.js";
import type { DatabaseAssertAction, DatabaseSelectAction, DatabaseTarget } from "../types.js";
import { validateReadonlyQuery, type DatabaseDialect } from "./sql-readonly.js";
import { isDeepStrictEqual } from "node:util";

export interface RedactedRowSet {
  rows: Array<Record<string, unknown>>;
  row_count: number;
  bytes: number;
}

export interface DatabaseAdapter {
  dialect: DatabaseDialect;
  probeReadOnly(): Promise<boolean>;
  select(query: string, params: unknown, limit: number): Promise<RedactedRowSet>;
  close?(): Promise<void>;
}

export class MissingDatabaseDriverError extends Error {
  constructor(dialect: DatabaseDialect, packageName: string) {
    super(`Optional ${dialect} driver is not installed. Run npm install ${packageName} in the runner project to enable it.`);
    this.name = "MissingDatabaseDriverError";
  }
}

export interface DatabaseConnectionConfig {
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  sslCa?: string;
}

function connectionConfig(target: DatabaseTarget, secrets: RuntimeSecretStore): DatabaseConnectionConfig {
  if (!target.username_credential || !target.password_credential) {
    throw new ActionExecutionError(
      "blocked",
      "missing_database_credentials",
      "Database target must declare username_credential and password_credential aliases; credentials are never guessed.",
    );
  }
  return {
    host: target.host,
    ...(target.port ? { port: target.port } : {}),
    database: target.database,
    username: secrets.get(target.username_credential),
    password: secrets.get(target.password_credential),
    ...(target.ssl_ca_credential ? { sslCa: secrets.get(target.ssl_ca_credential) } : {}),
  };
}

export async function loadDatabaseAdapter(target: DatabaseTarget, secrets: RuntimeSecretStore): Promise<DatabaseAdapter> {
  const config = connectionConfig(target, secrets);
  if (target.dialect === "postgresql") {
    const module = await import("./db-drivers/postgres.js");
    return module.loadPostgresAdapter(config);
  }
  const module = await import("./db-drivers/mysql.js");
  return module.loadMysqlAdapter(config);
}

function assertBounded(result: RedactedRowSet, limit: number): void {
  if (result.row_count > limit || result.rows.length > limit) {
    throw new ActionExecutionError("blocked", "db_result_overflow", `Database result exceeds row limit ${limit}`);
  }
  if (result.bytes > 1_000_000 || JSON.stringify(result.rows).length > 1_000_000) {
    throw new ActionExecutionError("blocked", "db_result_overflow", "Database result exceeds 1 MB evidence limit");
  }
}

export async function executeDatabaseAction(
  action: DatabaseSelectAction | DatabaseAssertAction,
  context: ExecutionContext,
): Promise<ActionStepResult> {
  if (action.type === "db.assert") return executeDatabaseAssert(action, context);
  const target = targetFor(context, action.target_alias, "database") as DatabaseTarget;
  const parsed = validateReadonlyQuery(action.query, target.dialect);
  const injected = context.databaseAdapters?.[target.dialect];
  const adapter = injected ?? await loadDatabaseAdapter(target, context.secrets);
  try {
    if (!(await adapter.probeReadOnly())) {
      throw new ActionExecutionError("blocked", "db_read_only_probe", "Database account read-only capability could not be demonstrated");
    }
    const params = action.params_ref ? resolveDataReference(action.params_ref, context) : undefined;
    const limit = Math.min(action.limit ?? 100, 100);
    const result = await adapter.select(action.query, params, limit);
    assertBounded(result, limit);
    context.lastDatabaseResult = result;
    return {
      status: "passed",
      actual: {
        dialect: target.dialect,
        query_sha256: parsed.query_sha256,
        row_count: result.row_count,
        bytes: result.bytes,
        rows: redact(result.rows, { fingerprints: context.redactionFingerprints }),
      },
    };
  } finally {
    if (!injected) await adapter.close?.();
  }
}

function rowField(row: Record<string, unknown> | undefined, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>)[part] : undefined,
  row);
}

function databaseAssertionResult(
  action: DatabaseAssertAction,
  context: ExecutionContext,
  actual: unknown,
  expected: unknown,
  passed: boolean,
): ActionStepResult {
  const details = {
    assertion: action.assertion,
    actual: redact(actual, { fingerprints: context.redactionFingerprints }),
    expected: redact(expected, { fingerprints: context.redactionFingerprints }),
  };
  return {
    status: passed ? "passed" : "failed",
    actual: details,
    attachments: [{
      relativePath: `${action.action_id}/db-assertion.json`,
      content: `${JSON.stringify(details, null, 2)}\n`,
    }],
    ...(passed ? {} : { error: { type: "business_assertion_failed", message: `Database assertion failed: ${action.assertion}` } }),
  };
}

function executeDatabaseAssert(action: DatabaseAssertAction, context: ExecutionContext): ActionStepResult {
  const result = context.lastDatabaseResult;
  if (!result) {
    throw new ActionExecutionError("blocked", "missing_database_result", "No prior database result is available for assertion");
  }
  const countEquals = action.assertion.match(/^row-count equals (\d+)$/i);
  if (countEquals) {
    const expected = Number(countEquals[1]);
    return databaseAssertionResult(action, context, result.row_count, expected, result.row_count === expected);
  }
  const countMinimum = action.assertion.match(/^row-count >= (\d+)$/i);
  if (countMinimum) {
    const expected = Number(countMinimum[1]);
    return databaseAssertionResult(action, context, result.row_count, `>= ${expected}`, result.row_count >= expected);
  }
  const field = action.assertion.match(
    /^row (\d+) field ([A-Za-z][A-Za-z0-9_.-]*) equals (fixture|output|env):([A-Za-z][A-Za-z0-9_.-]*)$/i,
  );
  if (field) {
    const actual = rowField(result.rows[Number(field[1])], field[2]!);
    const expected = resolveDataReference({
      source: field[3]!.toLowerCase() as "fixture" | "output" | "env",
      name: field[4]!,
    }, context);
    return databaseAssertionResult(action, context, actual, expected, isDeepStrictEqual(actual, expected));
  }
  throw new ActionExecutionError("blocked", "unsupported_assertion", `Unsupported database assertion: ${action.assertion}`);
}
