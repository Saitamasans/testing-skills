import {
  ActionExecutionError,
  resolveDataReference,
  targetFor,
  type ActionStepResult,
  type ExecutionContext,
} from "../runtime/execution-context.js";
import { redact } from "../security/redactor.js";
import type { DatabaseSelectAction, DatabaseTarget } from "../types.js";
import { validateReadonlyQuery, type DatabaseDialect } from "./sql-readonly.js";

export interface RedactedRowSet {
  rows: Array<Record<string, unknown>>;
  row_count: number;
  bytes: number;
}

export interface DatabaseAdapter {
  dialect: DatabaseDialect;
  probeReadOnly(): Promise<boolean>;
  select(query: string, params: unknown, limit: number): Promise<RedactedRowSet>;
}

export class MissingDatabaseDriverError extends Error {
  constructor(dialect: DatabaseDialect, packageName: string) {
    super(`Optional ${dialect} driver is not installed. Run npm install ${packageName} in the runner project to enable it.`);
    this.name = "MissingDatabaseDriverError";
  }
}

export async function loadDatabaseAdapter(dialect: DatabaseDialect): Promise<DatabaseAdapter> {
  if (dialect === "postgresql") {
    const module = await import("./db-drivers/postgres.js");
    return module.loadPostgresAdapter();
  }
  const module = await import("./db-drivers/mysql.js");
  return module.loadMysqlAdapter();
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
  action: DatabaseSelectAction,
  context: ExecutionContext,
): Promise<ActionStepResult> {
  const target = targetFor(context, action.target_alias, "database") as DatabaseTarget;
  const parsed = validateReadonlyQuery(action.query, target.dialect);
  const adapter = context.databaseAdapters?.[target.dialect] ?? await loadDatabaseAdapter(target.dialect);
  if (!(await adapter.probeReadOnly())) {
    throw new ActionExecutionError("blocked", "db_read_only_probe", "Database account read-only capability could not be demonstrated");
  }
  const params = action.params_ref ? resolveDataReference(action.params_ref, context) : undefined;
  const limit = Math.min(action.limit ?? 100, 100);
  const result = await adapter.select(action.query, params, limit);
  assertBounded(result, limit);
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
}
