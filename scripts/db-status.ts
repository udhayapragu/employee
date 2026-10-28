import { readdirSync } from "node:fs";
import path from "node:path";
import { openMigrationClient } from "../src/lib/db/sql";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");
const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Read-only report for the database the migrations would change. It runs only SELECT statements,
 * prints names and versions (never credentials or row data), and never changes anything.
 * Run it before npm run db:migrate to confirm the target database and what would be applied.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set. Set it in the environment or .env.local.");
    process.exit(1);
  }
  const connection = process.env.DATABASE_URL_UNPOOLED ? "direct" : "configured";

  const { client, close } = await openMigrationClient(url);
  try {
    const database = await client.query("SELECT current_database() AS name");
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    const tableNames = tables.rows.map((row) => String(row.table_name));
    const hasLedger = tableNames.includes("schema_migrations");
    const applied = hasLedger
      ? (await client.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((row) => String(row.version))
      : [];
    const files = readdirSync(MIGRATIONS_DIR).filter((file) => MIGRATION_FILE.test(file)).sort();
    const pending = files.filter((file) => !applied.includes(file));

    console.log(`[db-status] Target database: ${String(database.rows[0].name)} (${connection} connection).`);
    console.log(`[db-status] Tables in public (${tableNames.length}): ${tableNames.length > 0 ? tableNames.join(", ") : "none"}.`);
    console.log(`[db-status] Applied migrations: ${applied.length > 0 ? applied.join(", ") : "none"}.`);
    console.log(`[db-status] Pending migrations: ${pending.length > 0 ? pending.join(", ") : "none"}.`);
    if (tableNames.includes("users") && !hasLedger) {
      console.log("[db-status] WARNING: a users table exists but schema_migrations does not. Do not run db:migrate until this is understood, because 0001_init.sql would fail on CREATE TABLE users.");
    }
    console.log("[db-status] Read-only: no changes were made.");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Status check failed.");
  process.exit(1);
});
