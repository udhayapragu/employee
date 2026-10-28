import type { Pool } from "pg";
import type { SqlTag } from "@/lib/db/sql";

/**
 * Adapts a `pg` pool to the same tagged-template interface used with Neon in production.
 * Interpolated values become numbered bind parameters, so the SQL under test is the production SQL.
 */
export function createPgSqlTag(pool: Pool): SqlTag {
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    strings.forEach((part, index) => {
      text += part;
      if (index < values.length) text += `$${index + 1}`;
    });
    const result = await pool.query(text, values);
    return result.rows;
  };
  return tag as unknown as SqlTag;
}
