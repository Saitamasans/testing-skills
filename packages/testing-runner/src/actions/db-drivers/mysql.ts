import type { DatabaseAdapter } from "../database-adapter.js";
import { MissingDatabaseDriverError } from "../database-adapter.js";

export async function loadMysqlAdapter(): Promise<DatabaseAdapter> {
  throw new MissingDatabaseDriverError("mysql", "mysql2");
}
