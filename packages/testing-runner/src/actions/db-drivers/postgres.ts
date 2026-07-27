import type { DatabaseAdapter, DatabaseConnectionConfig } from "../database-adapter.js";
import { MissingDatabaseDriverError } from "../database-adapter.js";

function parameters(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  throw new Error("PostgreSQL params_ref must resolve to an ordered array");
}

export async function loadPostgresAdapter(config: DatabaseConnectionConfig): Promise<DatabaseAdapter> {
  let module: typeof import("pg");
  try {
    module = await import("pg");
  } catch {
    throw new MissingDatabaseDriverError("postgresql", "pg");
  }
  const pool = new module.Pool({
    host: config.host,
    port: config.port ?? 5432,
    database: config.database,
    user: config.username,
    password: config.password,
    max: 1,
    application_name: "saitamasans-testing-runner",
    ...(config.sslCa ? { ssl: { ca: config.sslCa, rejectUnauthorized: true } } : {}),
  });
  return {
    dialect: "postgresql",
    async probeReadOnly() {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM information_schema.role_table_grants
            WHERE grantee = current_user
              AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES')) AS table_write_grants,
          has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects
      `);
      const row = result.rows[0] as { table_write_grants?: number | string; can_create_database_objects?: boolean } | undefined;
      return Number(row?.table_write_grants ?? 1) === 0 && row?.can_create_database_objects === false;
    },
    async select(query, params, limit) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        const bounded = `SELECT * FROM (${query.replace(/;\s*$/, "")}) AS testing_runner_query LIMIT ${limit + 1}`;
        const result = await client.query(bounded, parameters(params));
        await client.query("ROLLBACK");
        return {
          rows: result.rows as Array<Record<string, unknown>>,
          row_count: result.rowCount ?? result.rows.length,
          bytes: Buffer.byteLength(JSON.stringify(result.rows), "utf8"),
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
