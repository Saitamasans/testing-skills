import type { DatabaseAdapter, DatabaseConnectionConfig } from "../database-adapter.js";
import { MissingDatabaseDriverError } from "../database-adapter.js";

function parameters(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  throw new Error("MySQL params_ref must resolve to an ordered array");
}

export async function loadMysqlAdapter(config: DatabaseConnectionConfig): Promise<DatabaseAdapter> {
  let module: typeof import("mysql2/promise");
  try {
    module = await import("mysql2/promise");
  } catch {
    throw new MissingDatabaseDriverError("mysql", "mysql2");
  }
  const pool = module.createPool({
    host: config.host,
    port: config.port ?? 3306,
    database: config.database,
    user: config.username,
    password: config.password,
    connectionLimit: 1,
    multipleStatements: false,
    ...(config.sslCa ? { ssl: { ca: config.sslCa, rejectUnauthorized: true } } : {}),
  });
  return {
    dialect: "mysql",
    async probeReadOnly() {
      const [rows] = await pool.query("SHOW GRANTS FOR CURRENT_USER");
      const grants = (rows as Array<Record<string, unknown>>)
        .flatMap((row) => Object.values(row).map(String))
        .join("\n")
        .toUpperCase();
      return !/\b(?:ALL PRIVILEGES|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRIGGER|REFERENCES|EXECUTE)\b/.test(grants);
    },
    async select(query, params, limit) {
      const connection = await pool.getConnection();
      try {
        await connection.query("SET TRANSACTION READ ONLY");
        await connection.beginTransaction();
        const bounded = `SELECT * FROM (${query.replace(/;\s*$/, "")}) AS testing_runner_query LIMIT ${limit + 1}`;
        const [rows] = await connection.query(bounded, parameters(params));
        await connection.rollback();
        const records = rows as Array<Record<string, unknown>>;
        return {
          rows: records,
          row_count: records.length,
          bytes: Buffer.byteLength(JSON.stringify(records), "utf8"),
        };
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}
