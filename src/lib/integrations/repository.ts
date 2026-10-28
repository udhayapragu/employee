import type { SqlTag } from "@/lib/db/sql";

export interface IntegrationRecord {
  key: string;
  displayName: string;
  category: string;
  description: string;
}

/** Display metadata only. Whether an integration is configured is decided from server environment, never stored. */
export async function listIntegrations(sql: SqlTag): Promise<IntegrationRecord[]> {
  const rows = await sql<{ key: string; display_name: string; category: string; description: string }>`
    SELECT key, display_name, category, description FROM integrations ORDER BY category ASC, display_name ASC
  `;
  return rows.map((row) => ({
    key: row.key,
    displayName: row.display_name,
    category: row.category,
    description: row.description,
  }));
}
