import type { SqlTag } from "@/lib/db/sql";
import { toCount, toIsoOrNull } from "@/lib/db/rows";
import type { LeadStatus, VerificationStatus } from "@/lib/config/domain";
import type { ExistingLead, LeadIdentity } from "@/lib/research/duplicates";
import type { AuditMetadata } from "@/lib/audit/log";
import type { LeadListQuery } from "./query";

export interface LeadRecord {
  id: string;
  companyName: string;
  normalizedCompanyName: string;
  productCategory: string;
  state: string;
  city: string | null;
  businessPhone: string | null;
  normalizedPhone: string | null;
  sourceName: string;
  sourceUrl: string;
  evidenceSummary: string | null;
  verificationStatus: VerificationStatus;
  leadStatus: LeadStatus;
  isSynthetic: boolean;
  researchQuery: string;
  researchJobId: string | null;
  collectedAt: string | null;
  possibleDuplicateOf: string | null;
  possibleDuplicateCompany: string | null;
  duplicateReason: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  followUpAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface LeadNoteRecord {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string | null;
}

export interface LeadHistoryRecord {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  actorName: string | null;
  createdAt: string | null;
}

type LeadRow = {
  id: string;
  company_name: string;
  normalized_company_name: string;
  product_category: string;
  state: string;
  city: string | null;
  business_phone: string | null;
  normalized_phone: string | null;
  source_name: string;
  source_url: string;
  evidence_summary: string | null;
  verification_status: VerificationStatus;
  lead_status: LeadStatus;
  is_synthetic: boolean;
  research_query: string;
  research_job_id: string | null;
  collected_at: unknown;
  possible_duplicate_of: string | null;
  possible_duplicate_company: string | null;
  duplicate_reason: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  follow_up_at: unknown;
  last_verified_at: unknown;
  created_at: unknown;
  updated_at: unknown;
};

function mapLead(row: LeadRow): LeadRecord {
  return {
    id: row.id,
    companyName: row.company_name,
    normalizedCompanyName: row.normalized_company_name,
    productCategory: row.product_category,
    state: row.state,
    city: row.city,
    businessPhone: row.business_phone,
    normalizedPhone: row.normalized_phone,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    evidenceSummary: row.evidence_summary,
    verificationStatus: row.verification_status,
    leadStatus: row.lead_status,
    isSynthetic: row.is_synthetic,
    researchQuery: row.research_query,
    researchJobId: row.research_job_id,
    collectedAt: toIsoOrNull(row.collected_at),
    possibleDuplicateOf: row.possible_duplicate_of,
    possibleDuplicateCompany: row.possible_duplicate_company,
    duplicateReason: row.duplicate_reason,
    assignedUserId: row.assigned_user_id,
    assignedUserName: row.assigned_user_name,
    followUpAt: toIsoOrNull(row.follow_up_at),
    lastVerifiedAt: toIsoOrNull(row.last_verified_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

/**
 * Loads existing leads that could be duplicates of a candidate: same state with a similar name prefix,
 * the same phone number, or the same source URL. The result is bounded and then classified in memory.
 */
export async function findPossibleDuplicates(sql: SqlTag, candidate: LeadIdentity): Promise<ExistingLead[]> {
  const rows = await sql<{
    id: string;
    normalized_company_name: string;
    state: string;
    normalized_city: string;
    product_category: string;
    normalized_phone: string | null;
    normalized_source_url: string;
  }>`
    SELECT id, normalized_company_name, state, normalized_city, product_category, normalized_phone, normalized_source_url
    FROM manufacturer_leads
    WHERE (state = ${candidate.state} AND left(normalized_company_name, 4) = left(${candidate.normalizedCompanyName}, 4))
       OR (${candidate.normalizedPhone}::text IS NOT NULL AND normalized_phone = ${candidate.normalizedPhone}::text)
       OR normalized_source_url = ${candidate.normalizedSourceUrl}
    LIMIT 200
  `;
  return rows.map((row) => ({
    id: row.id,
    normalizedCompanyName: row.normalized_company_name,
    state: row.state,
    normalizedCity: row.normalized_city,
    productCategory: row.product_category,
    normalizedPhone: row.normalized_phone,
    normalizedSourceUrl: row.normalized_source_url,
  }));
}

export interface NewLeadValues {
  companyName: string;
  normalizedCompanyName: string;
  productCategory: string;
  state: string;
  city: string | null;
  normalizedCity: string;
  businessPhone: string | null;
  normalizedPhone: string | null;
  sourceName: string;
  sourceUrl: string;
  normalizedSourceUrl: string;
  evidenceSummary: string | null;
  verificationStatus: VerificationStatus;
  leadStatus: LeadStatus;
  isSynthetic: boolean;
  researchQuery: string;
  researchJobId: string;
  collectedAt: string;
  possibleDuplicateOf: string | null;
  duplicateReason: string | null;
}

/**
 * Inserts a discovered lead. The exact-duplicate unique index makes this safe under concurrency:
 * a conflicting row is not inserted and null is returned, so the caller counts the candidate as skipped.
 */
export async function insertDiscoveredLead(sql: SqlTag, lead: NewLeadValues): Promise<string | null> {
  const rows = await sql<{ id: string }>`
    INSERT INTO manufacturer_leads (
      company_name, normalized_company_name, product_category, state, city, normalized_city,
      business_phone, normalized_phone, source_name, source_url, normalized_source_url, evidence_summary,
      verification_status, lead_status, is_synthetic, research_query, research_job_id, collected_at,
      possible_duplicate_of, duplicate_reason
    )
    VALUES (
      ${lead.companyName}, ${lead.normalizedCompanyName}, ${lead.productCategory}, ${lead.state},
      ${lead.city}, ${lead.normalizedCity}, ${lead.businessPhone}, ${lead.normalizedPhone},
      ${lead.sourceName}, ${lead.sourceUrl}, ${lead.normalizedSourceUrl}, ${lead.evidenceSummary},
      ${lead.verificationStatus}, ${lead.leadStatus}, ${lead.isSynthetic}, ${lead.researchQuery},
      ${lead.researchJobId}::uuid, ${lead.collectedAt}::timestamptz,
      ${lead.possibleDuplicateOf}::uuid, ${lead.duplicateReason}
    )
    ON CONFLICT (normalized_company_name, state, normalized_city, product_category) DO NOTHING
    RETURNING id
  `;
  return rows[0]?.id ?? null;
}

/**
 * Filtered, sorted, paginated lead list. Every filter is an optional bind parameter, so no user text is
 * concatenated into SQL. The sort field is one of a fixed set and is mapped through CASE expressions.
 */
export async function listLeads(sql: SqlTag, query: LeadListQuery): Promise<{ items: LeadRecord[]; total: number }> {
  const f = query.filters;
  const offset = (query.page - 1) * query.pageSize;

  const rows = await sql<LeadRow & { total: number }>`
    WITH base AS (
      SELECT l.id, l.company_name, l.normalized_company_name, l.product_category, l.state, l.city,
        l.business_phone, l.normalized_phone, l.source_name, l.source_url, l.evidence_summary,
        l.verification_status, l.lead_status, l.is_synthetic, l.research_query, l.research_job_id,
        l.collected_at, l.possible_duplicate_of, pd.company_name AS possible_duplicate_company,
        l.duplicate_reason, l.assigned_user_id, au.display_name AS assigned_user_name, l.follow_up_at,
        l.last_verified_at, l.created_at, l.updated_at, l.normalized_city,
        CASE ${query.sort}
          WHEN 'company_name' THEN l.normalized_company_name
          WHEN 'state' THEN l.state || '|' || l.normalized_city
          WHEN 'updated_at' THEN to_char(l.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
          ELSE to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
        END AS sort_key
      FROM manufacturer_leads l
      LEFT JOIN manufacturer_leads pd ON pd.id = l.possible_duplicate_of
      LEFT JOIN users au ON au.id = l.assigned_user_id
      WHERE (${f.category}::text IS NULL OR l.product_category = ${f.category}::text)
        AND (${f.state}::text IS NULL OR l.state = ${f.state}::text)
        AND (${f.normalizedCity}::text IS NULL OR l.normalized_city = ${f.normalizedCity}::text)
        AND (${f.verification}::text IS NULL OR l.verification_status = ${f.verification}::text)
        AND (${f.status}::text IS NULL OR l.lead_status = ${f.status}::text)
        AND (${f.researchJobId}::uuid IS NULL OR l.research_job_id = ${f.researchJobId}::uuid)
        AND (${f.duplicatesOnly}::boolean = false OR l.possible_duplicate_of IS NOT NULL)
        AND (${f.namePattern}::text IS NULL OR l.company_name ILIKE ${f.namePattern}::text)
    )
    SELECT base.id, base.company_name, base.normalized_company_name, base.product_category, base.state,
      base.city, base.business_phone, base.normalized_phone, base.source_name, base.source_url,
      base.evidence_summary, base.verification_status, base.lead_status, base.is_synthetic,
      base.research_query, base.research_job_id, base.collected_at, base.possible_duplicate_of,
      base.possible_duplicate_company, base.duplicate_reason, base.assigned_user_id,
      base.assigned_user_name, base.follow_up_at, base.last_verified_at, base.created_at, base.updated_at,
      count(*) OVER()::int AS total
    FROM base
    ORDER BY CASE WHEN ${query.order} = 'asc' THEN base.sort_key END ASC NULLS LAST,
             CASE WHEN ${query.order} = 'desc' THEN base.sort_key END DESC NULLS LAST,
             base.id ASC
    LIMIT ${query.pageSize} OFFSET ${offset}
  `;

  return { items: rows.map(mapLead), total: rows[0] ? toCount(rows[0].total) : 0 };
}

export async function getLead(sql: SqlTag, leadId: string): Promise<LeadRecord | null> {
  const rows = await sql<LeadRow>`
    SELECT l.id, l.company_name, l.normalized_company_name, l.product_category, l.state, l.city,
      l.business_phone, l.normalized_phone, l.source_name, l.source_url, l.evidence_summary,
      l.verification_status, l.lead_status, l.is_synthetic, l.research_query, l.research_job_id,
      l.collected_at, l.possible_duplicate_of, pd.company_name AS possible_duplicate_company,
      l.duplicate_reason, l.assigned_user_id, au.display_name AS assigned_user_name, l.follow_up_at,
      l.last_verified_at, l.created_at, l.updated_at
    FROM manufacturer_leads l
    LEFT JOIN manufacturer_leads pd ON pd.id = l.possible_duplicate_of
    LEFT JOIN users au ON au.id = l.assigned_user_id
    WHERE l.id = ${leadId}::uuid
    LIMIT 1
  `;
  return rows[0] ? mapLead(rows[0]) : null;
}

export async function listLeadNotes(sql: SqlTag, leadId: string): Promise<LeadNoteRecord[]> {
  const rows = await sql<{ id: string; body: string; author_name: string | null; created_at: unknown }>`
    SELECT n.id, n.body, u.display_name AS author_name, n.created_at
    FROM lead_notes n
    JOIN users u ON u.id = n.author_user_id
    WHERE n.lead_id = ${leadId}::uuid
    ORDER BY n.created_at DESC
    LIMIT 50
  `;
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    authorName: row.author_name,
    createdAt: toIsoOrNull(row.created_at),
  }));
}

/** Adds a note and its audit entry in one statement, so a note never exists without its audit record. */
export async function insertLeadNote(
  sql: SqlTag,
  input: { leadId: string; authorId: string; body: string },
): Promise<string> {
  const rows = await sql<{ id: string }>`
    WITH note AS (
      INSERT INTO lead_notes (lead_id, author_user_id, body)
      VALUES (${input.leadId}::uuid, ${input.authorId}::uuid, ${input.body})
      RETURNING id, lead_id, author_user_id
    ),
    audit AS (
      INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, safe_metadata_json)
      SELECT author_user_id, 'lead.note_added', 'manufacturer_lead', lead_id::text, '{}'::jsonb FROM note
    )
    SELECT id FROM note
  `;
  return rows[0].id;
}

export async function listLeadHistory(sql: SqlTag, leadId: string): Promise<LeadHistoryRecord[]> {
  const rows = await sql<{
    id: string;
    action: string;
    safe_metadata_json: Record<string, unknown>;
    actor_name: string | null;
    created_at: unknown;
  }>`
    SELECT a.id, a.action, a.safe_metadata_json, u.display_name AS actor_name, a.created_at
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.entity_type = 'manufacturer_lead' AND a.entity_id = ${leadId}
    ORDER BY a.created_at DESC
    LIMIT 50
  `;
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    metadata: row.safe_metadata_json,
    actorName: row.actor_name,
    createdAt: toIsoOrNull(row.created_at),
  }));
}

export interface LeadUpdate {
  leadId: string;
  actorId: string;
  /** Compare-and-set guard: the update applies only if the lead is still in this status. */
  expectedStatus: LeadStatus;
  /** New lead status, when it changes. */
  leadStatus?: LeadStatus;
  /** Assignment change. null clears the assignment. */
  assignedUserId?: string | null;
  /** Follow-up change. null clears the follow-up date. */
  followUpAt?: string | null;
  /** Records a completed verification checklist. Sets verified status and timestamp. */
  verification?: { evidenceSummary: string };
  /** Clears a flagged duplicate after a human decides it is not a duplicate. */
  clearDuplicateFlag?: boolean;
  auditAction: string;
  auditMetadata: AuditMetadata;
}

/**
 * Applies a lead change and its audit row in one statement (CTE). The WHERE clause checks the expected
 * status, so concurrent edits cannot silently overwrite a status change. Returns null on conflict.
 * A verification never applies to a synthetic record, enforced here as well as in the application layer.
 */
export async function applyLeadUpdate(sql: SqlTag, update: LeadUpdate): Promise<{ id: string } | null> {
  const hasStatus = update.leadStatus !== undefined;
  const newStatus = update.leadStatus ?? update.expectedStatus;
  const verifying = update.verification !== undefined;
  const assignmentChanged = update.assignedUserId !== undefined;
  const followUpChanged = update.followUpAt !== undefined;
  const clearing = update.clearDuplicateFlag === true;

  const rows = await sql<{ id: string }>`
    WITH upd AS (
      UPDATE manufacturer_leads
      SET lead_status = CASE
            WHEN ${verifying}::boolean THEN 'verified'
            WHEN ${hasStatus}::boolean THEN ${newStatus}::text
            ELSE lead_status
          END,
          verification_status = CASE
            WHEN ${verifying}::boolean THEN 'verified'
            WHEN ${clearing}::boolean AND verification_status = 'needs_review' THEN 'unverified'
            ELSE verification_status
          END,
          evidence_summary = CASE WHEN ${verifying}::boolean THEN ${update.verification?.evidenceSummary ?? null}::text ELSE evidence_summary END,
          last_verified_at = CASE WHEN ${verifying}::boolean THEN now() ELSE last_verified_at END,
          assigned_user_id = CASE WHEN ${assignmentChanged}::boolean THEN ${update.assignedUserId ?? null}::uuid ELSE assigned_user_id END,
          follow_up_at = CASE WHEN ${followUpChanged}::boolean THEN ${update.followUpAt ?? null}::timestamptz ELSE follow_up_at END,
          possible_duplicate_of = CASE WHEN ${clearing}::boolean THEN NULL ELSE possible_duplicate_of END,
          duplicate_reason = CASE WHEN ${clearing}::boolean THEN NULL ELSE duplicate_reason END,
          updated_at = now()
      WHERE id = ${update.leadId}::uuid
        AND lead_status = ${update.expectedStatus}::text
        AND (${verifying}::boolean = false OR is_synthetic = false)
      RETURNING id
    ),
    audit AS (
      INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, safe_metadata_json)
      SELECT ${update.actorId}::uuid, ${update.auditAction}, 'manufacturer_lead', id::text,
             ${JSON.stringify(update.auditMetadata)}::jsonb
      FROM upd
    )
    SELECT id FROM upd
  `;
  return rows[0] ?? null;
}
