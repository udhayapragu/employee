import { getEnv } from "@/lib/config/env";
import { createSqlForUrl, type SqlTag } from "./sql";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("Database is not configured on this server.");
    this.name = "DatabaseNotConfiguredError";
  }
}

let cachedSql: SqlTag | null = null;

/** Returns the shared SQL function for server-side code. Never import this from client components. */
export function getSql(): SqlTag {
  if (cachedSql) return cachedSql;
  const { DATABASE_URL } = getEnv();
  if (!DATABASE_URL) throw new DatabaseNotConfiguredError();
  cachedSql = createSqlForUrl(DATABASE_URL);
  return cachedSql;
}
