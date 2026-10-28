import path from "node:path";
import { runMigrations } from "../src/lib/db/migrations";
import { openMigrationClient } from "../src/lib/db/sql";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Set it in the environment or .env.local, then run again.");
    process.exit(1);
  }

  const { client, close } = await openMigrationClient(url);
  try {
    const result = await runMigrations(client, path.join(process.cwd(), "db", "migrations"));
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
