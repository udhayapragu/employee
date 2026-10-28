import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SqlClient } from "./sql";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Every migration creates its objects in this schema. The connection's search_path is never used. */
export const TARGET_SCHEMA = "public";

/** Operators set this to "1" only after reviewing application tables that exist outside the target schema. */
export const ALLOW_OTHER_SCHEMAS_ENV = "MIGRATION_ALLOW_OTHER_SCHEMAS";

const LEDGER_TABLE = "schema_migrations";
/** The first migration creates this table, so its presence is what "0001_init.sql applied" must mean. */
const CANARY_TABLE = "users";
const FIRST_MIGRATION = "0001_init.sql";

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export interface SchemaSnapshot {
  /** Versions recorded in public.schema_migrations. Empty when that ledger does not exist. */
  appliedVersions: string[];
  publicLedgerExists: boolean;
  publicCanaryExists: boolean;
  /** Schema-qualified names of ledger or canary tables that exist outside the target schema. */
  otherSchemaTables: string[];
}

/**
 * Decides whether migrating is safe, from the snapshot alone. Returns the reason to refuse, or null.
 * Refusal happens before any write, so a refused run leaves the database untouched.
 */
export function refusalReason(snapshot: SchemaSnapshot, allowOtherSchemas: boolean): string | null {
  const ledgerSaysApplied = snapshot.appliedVersions.includes(FIRST_MIGRATION);

  if (ledgerSaysApplied && !snapshot.publicCanaryExists) {
    return `The ledger lists ${FIRST_MIGRATION} as applied, but ${TARGET_SCHEMA}.${CANARY_TABLE} is missing. Stop: do not re-run or delete the ledger until this is investigated.`;
  }
  if (!ledgerSaysApplied && snapshot.publicCanaryExists) {
    return `${TARGET_SCHEMA}.${CANARY_TABLE} exists but the ledger does not list ${FIRST_MIGRATION}. Investigate before migrating.`;
  }
  if (!snapshot.publicCanaryExists && snapshot.otherSchemaTables.length > 0 && !allowOtherSchemas) {
    return `Application tables exist outside ${TARGET_SCHEMA} (${snapshot.otherSchemaTables.join(", ")}). Refusing to create a second copy in ${TARGET_SCHEMA}. Set ${ALLOW_OTHER_SCHEMAS_ENV}=1 only after an operator has approved it.`;
  }
  return null;
}

/**
 * Reads the schema state without changing it. It pins the session search_path to the target schema,
 * which is session-only and not a data write, so every name below is resolved explicitly.
 */
export async function readSnapshot(client: SqlClient): Promise<SchemaSnapshot> {
  await client.query(`SET search_path TO ${TARGET_SCHEMA}`);

  const ledger = await client.query(`SELECT to_regclass('${TARGET_SCHEMA}.${LEDGER_TABLE}') IS NOT NULL AS present`);
  const publicLedgerExists = ledger.rows[0]?.present === true;
  const appliedVersions = publicLedgerExists
    ? (await client.query(`SELECT version FROM ${TARGET_SCHEMA}.${LEDGER_TABLE}`)).rows.map((row) => String(row.version))
    : [];

  const canary = await client.query(`SELECT to_regclass('${TARGET_SCHEMA}.${CANARY_TABLE}') IS NOT NULL AS present`);
  const others = await client.query(
    `SELECT schemaname || '.' || tablename AS name FROM pg_catalog.pg_tables
     WHERE tablename IN ('${CANARY_TABLE}', '${LEDGER_TABLE}')
       AND schemaname NOT IN ('pg_catalog', 'information_schema', '${TARGET_SCHEMA}')
     ORDER BY 1`,
  );

  return {
    appliedVersions,
    publicLedgerExists,
    publicCanaryExists: canary.rows[0]?.present === true,
    otherSchemaTables: others.rows.map((row) => String(row.name)),
  };
}

/**
 * Applies pending SQL migrations in filename order, all into the target schema. Each migration runs
 * inside its own transaction together with its ledger row. The client must be a single connection,
 * because BEGIN/COMMIT must share one session. Refuses before writing if the schema state is inconsistent.
 */
export async function runMigrations(
  client: SqlClient,
  migrationsDir: string,
  options: { allowOtherSchemas?: boolean } = {},
): Promise<MigrationResult> {
  const snapshot = await readSnapshot(client);
  const refusal = refusalReason(snapshot, options.allowOtherSchemas ?? false);
  if (refusal) throw new Error(refusal);

  await client.query(
    `CREATE TABLE IF NOT EXISTS ${TARGET_SCHEMA}.${LEDGER_TABLE} (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => MIGRATION_FILE.test(file))
    .sort();
  const done = new Set(snapshot.appliedVersions);
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
      await client.query(`INSERT INTO ${TARGET_SCHEMA}.${LEDGER_TABLE} (version) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      result.applied.push(file);
    } catch {
      await client.query("ROLLBACK");
      // Do not include the SQL error text: it can echo fragments of the schema or data.
      throw new Error(`Migration ${file} failed and was rolled back.`);
    }
  }

  if (result.applied.length > 0) {
    const after = await readSnapshot(client);
    if (!after.publicCanaryExists) {
      throw new Error(`Migrations finished but ${TARGET_SCHEMA}.${CANARY_TABLE} does not exist. Investigate before continuing.`);
    }
  }

  return result;
}
