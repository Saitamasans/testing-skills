import { createHash } from "node:crypto";

import sqlParser from "node-sql-parser";

export type DatabaseDialect = "mysql" | "postgresql";

export interface ParsedSelect {
  dialect: DatabaseDialect;
  statement_count: 1;
  query_sha256: string;
}

const { Parser } = sqlParser as unknown as {
  Parser: new () => {
    astify(sql: string, options: { database: string }): unknown;
  };
};

const parser = new Parser();

function parserDialect(dialect: DatabaseDialect): string {
  return dialect === "postgresql" ? "postgresql" : "mysql";
}

function rejectUnsafeText(sql: string): void {
  if (/--|\/\*/.test(sql)) throw new Error("SQL comment is not allowed in a read-only query");
  if (/;\s*\S/.test(sql) || sql.trim().includes(";")) {
    throw new Error("Only a single read-only SELECT statement is allowed");
  }
  if (/\{\{|\}\}/.test(sql)) throw new Error("SQL interpolation markers are not allowed");
  if (/\b(?:insert|update|delete|drop|alter|create|truncate|merge|call|execute|grant|revoke|copy|load|begin|commit|rollback|savepoint)\b/i.test(sql)) {
    throw new Error("Only a single read-only SELECT statement is allowed");
  }
  if (/\b(?:start\s+transaction|set\s+transaction|lock\s+table|unlock\s+tables)\b/i.test(sql)) {
    throw new Error("SQL transaction or lock control is not allowed");
  }
  if (/\bfor\s+(?:update|share)\b/i.test(sql)) throw new Error("Locking SELECT clauses are not allowed");
  if (/\b(?:pg_read_file|pg_ls_dir|load_file)\s*\(/i.test(sql) || /\binto\s+(?:out|dump)file\b/i.test(sql)) {
    throw new Error("File-capable SQL function is not allowed");
  }
}

function assertSelectOnly(node: unknown): void {
  if (!node || typeof node !== "object") {
    throw new Error("Only a single read-only SELECT statement is allowed");
  }
  const record = node as { type?: string; with?: Array<{ stmt?: unknown }> | null };
  if (record.type !== "select") throw new Error("Only a single read-only SELECT statement is allowed");
  for (const cte of record.with ?? []) assertSelectOnly(cte.stmt);
}

export function validateReadonlyQuery(sql: string, dialect: DatabaseDialect): ParsedSelect {
  rejectUnsafeText(sql);
  let ast: unknown;
  try {
    ast = parser.astify(sql, { database: parserDialect(dialect) });
  } catch (error) {
    throw new Error(`SQL parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) throw new Error("Only a single read-only SELECT statement is allowed");
  assertSelectOnly(statements[0]);
  return {
    dialect,
    statement_count: 1,
    query_sha256: createHash("sha256").update(sql, "utf8").digest("hex"),
  };
}
