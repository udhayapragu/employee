import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SqlClient } from "./sql";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Applies pending SQL migrations in filename order. Each migration runs inside its own transaction
 * together with its schema_migrations row, so a failed migration leaves no partial state.
 * The client must be a single connection, because BEGIN/COMMIT must share one session.
 */
export async function runMigrations(client: SqlClient, migrationsDir: string): Promise<MigrationResult> {
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => MIGRATION_FILE.test(file))
    .sort();

  const existing = await client.query("SELECT version FROM schema_migrations");
  const done = new Set(existing.rows.map((row) => String(row.version)));

  const result: MigrationResult = { applied: [], alreadyApplied: [] };

  for (const file of files) {
    if (done.has(file)) {
      result.alreadyApplied.push(file);
      continue;
    }
    const sqlText = readFileSync(path.join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sqlText);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      result.applied.push(file);
    } catch {
      await client.query("ROLLBACK");
      // Do not include the SQL error text: it can echo fragments of the schema or data.
      throw new Error(`Migration ${file} failed and was rolled back.`);
    }
  }

  return result;
}
