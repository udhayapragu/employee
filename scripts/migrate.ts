import path from "node:path";
import { Client } from "@neondatabase/serverless";
import { runMigrations } from "../src/lib/db/migrations";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Set it in the environment or .env.local, then run again.");
    process.exit(1);
  }

  const client = new Client(url);
  await client.connect();
  try {
    const result = await runMigrations(client, path.join(process.cwd(), "db", "migrations"));
    const applied = result.applied.length > 0 ? result.applied.join(", ") : "none";
    console.log(`Migrations applied: ${applied}. Already up to date: ${result.alreadyApplied.length}.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migration failed.");
  process.exit(1);
});
