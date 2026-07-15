import type { DatabaseAdapter } from "../database-adapter.js";
import { MissingDatabaseDriverError } from "../database-adapter.js";

export async function loadPostgresAdapter(): Promise<DatabaseAdapter> {
  throw new MissingDatabaseDriverError("postgresql", "pg");
}
