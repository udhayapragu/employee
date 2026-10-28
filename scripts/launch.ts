import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { insertAuditLog } from "../src/lib/audit/log";
import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";
import { createSqlForUrl, openMigrationClient, urlsDisagree } from "../src/lib/db/sql";
import { ALLOW_OTHER_SCHEMAS_ENV, runMigrations } from "../src/lib/db/migrations";
import { countSuperAdmins, insertUser } from "../src/lib/users/repository";
import { z } from "zod";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const PRODUCTION = process.argv.includes("--production");

/**
 * One command to bring a fresh or existing database up to date and start the app:
 * 1. Load .env.local and .env (values already in the environment take precedence).
 * 2. Import every pending versioned migration, in filename order, each in its own transaction.
 * 3. Create the first super administrator, only if ADMIN_EMAIL and ADMIN_PASSWORD are set and none exists.
 * 4. Start the development server, or build and start the production server with --production.
 */
function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(ROOT, file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
}

function latestMigrationName(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
  return files[files.length - 1] ?? "none";
}

async function importSchema(): Promise<void> {
  // Direct connection for migrations, as in scripts/migrate.ts.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const disagreement = urlsDisagree(process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED);
  if (disagreement) throw new Error(`Refusing to import the schema: ${disagreement}`);
  const { client, close } = await openMigrationClient(url);
  try {
    const result = await runMigrations(client, MIGRATIONS_DIR, {
      allowOtherSchemas: process.env[ALLOW_OTHER_SCHEMAS_ENV] === "1",
    });
    const applied = result.applied.length > 0 ? result.applied.join(", ") : "none";
    console.log(`[launch] Schema imported. Newly applied: ${applied}. Schema version: ${latestMigrationName()}.`);
  } finally {
    await close();
  }
}

async function bootstrapAdministrator(url: string): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) return;

  if (!z.email().safeParse(email).success) throw new Error("ADMIN_EMAIL is not a valid email address.");
  const problem = validatePasswordStrength(password);
  if (problem) throw new Error(`ADMIN_PASSWORD is not acceptable: ${problem}`);

  const sql = createSqlForUrl(url);
  if ((await countSuperAdmins(sql)) > 0) {
    console.log("[launch] A super administrator already exists. Skipping administrator creation.");
    return;
  }

  const id = await insertUser(sql, {
    email,
    displayName: "Super Administrator",
    passwordHash: await hashPassword(password),
    role: "super_admin",
  });
  await insertAuditLog(sql, { actorId: id, action: "user.bootstrap_super_admin", entityType: "user", entityId: id });
  console.log(`[launch] Super administrator ${email} created. You can now remove ADMIN_PASSWORD from the environment.`);
}

function startServer(port: string): void {
  const next = path.join(ROOT, "node_modules", ".bin", "next");
  if (PRODUCTION) {
    const build = spawnSync(next, ["build"], { stdio: "inherit" });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }

  const args = PRODUCTION ? ["start", "-p", port] : ["dev", "-p", port];
  console.log(`[launch] Starting ${PRODUCTION ? "production" : "development"} server at http://localhost:${port}`);
  const server = spawn(next, args, { stdio: "inherit", env: process.env });

  const forward = (signal: NodeJS.Signals) => server.kill(signal);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  server.on("exit", (code) => process.exit(code ?? 0));
}

async function main(): Promise<void> {
  loadEnvFiles();

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[launch] DATABASE_URL is not set. Add it to .env.local (see .env.example), then run again.");
    process.exit(1);
  }

  await importSchema();
  await bootstrapAdministrator(url);
  startServer(process.env.PORT ?? "3000");
}

main().catch((error: unknown) => {
  console.error(`[launch] ${error instanceof Error ? error.message : "Launch failed."}`);
  process.exit(1);
});
