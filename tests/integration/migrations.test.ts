import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations, type MigrationResult } from "@/lib/db/migrations";
import type { SqlClient } from "@/lib/db/sql";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/** Runs the real runner on one dedicated connection, with an optional session search_path (like a role default). */
async function migrateOn(pool: Pool, options: { searchPath?: string; allowOtherSchemas?: boolean } = {}): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    if (options.searchPath) await client.query(`SET search_path TO ${options.searchPath}`);
    const sql: SqlClient = { query: async (text, params) => client.query(text, params) };
    return await runMigrations(sql, MIGRATIONS_DIR, { allowOtherSchemas: options.allowOtherSchemas ?? false });
  } finally {
    client.release();
  }
}

/** Test fixture only: builds the application tables in a role schema, the way a role default search_path would. */
async function createAppTablesIn(pool: Pool, schema: string): Promise<void> {
  const client = await pool.connect();
  try {
    const sqlText = readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8");
    await client.query(`SET search_path TO ${schema}`);
    await client.query(sqlText);
  } finally {
    client.release();
  }
}

async function tablesIn(pool: Pool, schema: string): Promise<string[]> {
  const result = await pool.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 ORDER BY 1", [schema]);
  return result.rows.map((row) => String(row.tablename));
}

describe.skipIf(!TEST_DATABASE_URL)("migration runner against real Postgres", () => {
  let pool: Pool;

  beforeAll(() => {
    if (!/test/i.test(new URL(TEST_DATABASE_URL as string).pathname)) throw new Error("Test database name must contain 'test'.");
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
  });

  beforeEach(async () => {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS owner_schema CASCADE;");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("creates the schema and ledger in public on a fresh database, then reports up to date", async () => {
    const first = await migrateOn(pool);
    expect(first).toEqual({ applied: ["0001_init.sql"], alreadyApplied: [] });
    expect(await tablesIn(pool, "public")).toEqual(expect.arrayContaining(["users", "schema_migrations", "manufacturer_leads"]));

    const second = await migrateOn(pool);
    expect(second).toEqual({ applied: [], alreadyApplied: ["0001_init.sql"] });
  });

  it("refuses when the ledger says 0001 is applied but public.users is missing, and changes nothing", async () => {
    await migrateOn(pool);
    await pool.query("DROP TABLE public.users CASCADE");
    const before = await tablesIn(pool, "public");

    await expect(migrateOn(pool)).rejects.toThrow("public.users is missing");
    expect(await tablesIn(pool, "public")).toEqual(before);
    const ledger = await pool.query("SELECT version FROM public.schema_migrations");
    expect(ledger.rows.map((row) => row.version)).toEqual(["0001_init.sql"]);
  });

  it("refuses, with no writes, when application tables exist only in a role schema on the search path", async () => {
    await pool.query("CREATE SCHEMA owner_schema");
    await createAppTablesIn(pool, "owner_schema");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

    await expect(migrateOn(pool, { searchPath: "owner_schema, public" })).rejects.toThrow("Refusing to create a second copy");
    expect(await tablesIn(pool, "public")).toEqual([]);
    expect(await tablesIn(pool, "owner_schema")).toContain("users");
  });

  it("with explicit approval, creates the schema in public and leaves the other schema untouched", async () => {
    await pool.query("CREATE SCHEMA owner_schema");
    await createAppTablesIn(pool, "owner_schema");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const elsewhereBefore = await tablesIn(pool, "owner_schema");

    const result = await migrateOn(pool, { searchPath: "owner_schema, public", allowOtherSchemas: true });
    expect(result.applied).toEqual(["0001_init.sql"]);
    expect(await tablesIn(pool, "public")).toContain("users");
    expect(await tablesIn(pool, "owner_schema")).toEqual(elsewhereBefore);
  });

  it("always targets public, even when the session search_path names another schema first", async () => {
    await pool.query("CREATE SCHEMA owner_schema");
    const result = await migrateOn(pool, { searchPath: "owner_schema, public" });
    expect(result.applied).toEqual(["0001_init.sql"]);
    expect(await tablesIn(pool, "owner_schema")).toEqual([]);
    expect(await tablesIn(pool, "public")).toContain("schema_migrations");
  });

  it("refuses when public.users exists but the ledger does not list 0001", async () => {
    await pool.query("CREATE TABLE public.users (id integer)");
    await expect(migrateOn(pool)).rejects.toThrow("does not list 0001_init.sql");
    expect(await tablesIn(pool, "public")).toEqual(["users"]);
  });
});
