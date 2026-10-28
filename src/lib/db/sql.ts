import { neon, Client as NeonClient } from "@neondatabase/serverless";
import type { Pool } from "pg";

/**
 * A tagged-template SQL function. Every query is parameterised: interpolated values are sent as
 * bind parameters, never concatenated into the query text. Production uses Neon. A local Postgres
 * (development and tests) uses `pg`. Repository code is identical for both.
 */
export type SqlTag = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

/** Minimal client interface used by the migration runner. */
export interface SqlClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when the connection string points at a Postgres on this machine rather than at Neon. */
export function isLocalDatabaseUrl(connectionString: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

function pgTag(query: (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>): SqlTag {
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    strings.forEach((part, index) => {
      text += part;
      if (index < values.length) text += `$${index + 1}`;
    });
    const result = await query(text, values);
    return result.rows;
  };
  return tag as unknown as SqlTag;
}

/** Wraps an existing `pg` pool. Used by the local launcher and the integration tests. */
export function createPgSqlTag(pool: Pool): SqlTag {
  return pgTag((text, values) => pool.query(text, values));
}

/** Local development database. The pg driver is loaded on first use, so Neon-only deployments never load it. */
function createLocalPgSql(connectionString: string): SqlTag {
  let pool: Promise<Pool> | undefined;
  return pgTag(async (text, values) => {
    pool ??= import("pg").then(({ Pool }) => new Pool({ connectionString, max: 5 }));
    return (await pool).query(text, values);
  });
}

export function createNeonSql(connectionString: string): SqlTag {
  const query = neon(connectionString);
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => query(strings, ...values);
  return tag as unknown as SqlTag;
}

/** Chooses the driver from the connection string: a local Postgres for localhost, otherwise Neon. */
export function createSqlForUrl(connectionString: string): SqlTag {
  return isLocalDatabaseUrl(connectionString) ? createLocalPgSql(connectionString) : createNeonSql(connectionString);
}

/** Opens one dedicated connection for migrations. Transactions need a single session, so this is not a pool. */
export async function openMigrationClient(connectionString: string): Promise<{ client: SqlClient; close: () => Promise<void> }> {
  if (isLocalDatabaseUrl(connectionString)) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString });
    await client.connect();
    return {
      client: { query: (text, params) => client.query(text, params) },
      close: () => client.end(),
    };
  }

  const client = new NeonClient(connectionString);
  await client.connect();
  return {
    client: { query: (text, params) => client.query(text, params) },
    close: () => client.end(),
  };
}
