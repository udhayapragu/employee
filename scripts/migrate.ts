import path from "node:path";
import { ALLOW_OTHER_SCHEMAS_ENV, runMigrations, TARGET_SCHEMA } from "../src/lib/db/migrations";
import { openMigrationClient } from "../src/lib/db/sql";

async function main(): Promise<void> {
  // Migrations run over the direct (unpooled) connection when Neon provides one. The pooled
  // connection is for application traffic and does not support the session state migrations rely on.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Set it in the environment or .env.local, then run again.");
    process.exit(1);
  }

  // Report the target database name (never the credentials) so it can be matched against the Neon console.
  const databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || "(default)";
  const connection = process.env.DATABASE_URL_UNPOOLED ? "direct" : "configured";
  const allowOtherSchemas = process.env[ALLOW_OTHER_SCHEMAS_ENV] === "1";
  console.log(`[migrate] Target database: ${databaseName} (${connection} connection), schema: ${TARGET_SCHEMA}.`);
  if (allowOtherSchemas) {
    console.log(`[migrate] ${ALLOW_OTHER_SCHEMAS_ENV}=1: application tables outside ${TARGET_SCHEMA} will not block this run.`);
  }

  const { client, close } = await openMigrationClient(url);
  try {
    const result = await runMigrations(client, path.join(process.cwd(), "db", "migrations"), { allowOtherSchemas });
    const applied = result.applied.length > 0 ? result.applied.join(", ") : "none";
    console.log(`Migrations applied: ${applied}. Already up to date: ${result.alreadyApplied.length}.`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migration failed.");
  process.exit(1);
});
