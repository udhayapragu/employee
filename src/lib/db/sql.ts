import { neon } from "@neondatabase/serverless";

/**
 * A tagged-template SQL function. Every query is parameterised: interpolated values are sent as
 * bind parameters, never concatenated into the query text. Implemented by Neon in production and
 * by the `pg` driver in integration tests, so repository code is identical in both.
 */
export type SqlTag = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

/** Minimal client interface used by the migration runner. */
export interface SqlClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export function createNeonSql(connectionString: string): SqlTag {
  const query = neon(connectionString);
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => query(strings, ...values);
  return tag as unknown as SqlTag;
}
