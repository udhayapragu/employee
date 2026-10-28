import type { SqlTag } from "@/lib/db/sql";

export type AuditMetadata = Record<string, string | number | boolean | null | string[]>;

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: AuditMetadata;
}

/**
 * Appends one audit row. Metadata must be safe to store: identifiers, status names and counts only.
 * Never pass personal data, note bodies, secrets or raw provider responses.
 */
export async function insertAuditLog(sql: SqlTag, entry: AuditEntry): Promise<void> {
  await sql`
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, safe_metadata_json)
    VALUES (
      ${entry.actorId}::uuid,
      ${entry.action},
      ${entry.entityType},
      ${entry.entityId},
      ${JSON.stringify(entry.metadata ?? {})}::jsonb
    )
  `;
}
