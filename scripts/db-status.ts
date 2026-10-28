import { readdirSync } from "node:fs";
import path from "node:path";
import { ALLOW_OTHER_SCHEMAS_ENV, readSnapshot, refusalReason, TARGET_SCHEMA } from "../src/lib/db/migrations";
import { openMigrationClient } from "../src/lib/db/sql";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");
const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Read-only report that uses the same snapshot and refusal rules as the migration runner, so the
 * decision printed here is the decision db:migrate would make. It runs only SELECT statements
 * (plus a session-only search_path setting), prints names and versions, and never changes data.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set. Set it in the environment or .env.local.");
    process.exit(1);
  }
  const connection = process.env.DATABASE_URL_UNPOOLED ? "direct" : "configured";
  const allowOtherSchemas = process.env[ALLOW_OTHER_SCHEMAS_ENV] === "1";

  const { client, close } = await openMigrationClient(url);
  try {
    const database = await client.query("SELECT current_database() AS name");
    const bySchema = await client.query(
      `SELECT schemaname, count(*)::int AS tables FROM pg_catalog.pg_tables
       WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
       GROUP BY schemaname ORDER BY schemaname`,
    );
    const snapshot = await readSnapshot(client);
    const files = readdirSync(MIGRATIONS_DIR).filter((file) => MIGRATION_FILE.test(file)).sort();
    const pending = files.filter((file) => !snapshot.appliedVersions.includes(file));
    const refusal = refusalReason(snapshot, allowOtherSchemas);

    const schemaSummary = bySchema.rows.map((row) => `${String(row.schemaname)}=${String(row.tables)}`).join(", ");
    console.log(`[db-status] Target database: ${String(database.rows[0].name)} (${connection} connection).`);
    console.log(`[db-status] Tables by schema: ${schemaSummary || "none"}.`);
    console.log(
      `[db-status] Migrations use schema ${TARGET_SCHEMA}: ledger ${snapshot.publicLedgerExists ? "present" : "absent"}, ` +
        `${TARGET_SCHEMA}.users ${snapshot.publicCanaryExists ? "present" : "absent"}.`,
    );
    console.log(`[db-status] Applied: ${snapshot.appliedVersions.length > 0 ? snapshot.appliedVersions.join(", ") : "none"}.`);
    console.log(`[db-status] Pending: ${pending.length > 0 ? pending.join(", ") : "none"}.`);
    if (refusal) {
      console.log(`[db-status] Migrate decision: REFUSE. ${refusal}`);
    } else if (pending.length > 0) {
      console.log(`[db-status] Migrate decision: PROCEED with ${pending.join(", ")}.`);
    } else {
      console.log("[db-status] Migrate decision: nothing to apply.");
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
