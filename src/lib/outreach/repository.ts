import type { SqlTag } from "@/lib/db/sql";
import { toCount, toIsoOrNull } from "@/lib/db/rows";
import type { OutreachChannel, OutreachLanguage } from "@/lib/config/domain";
import type { DraftAction, DraftStatus } from "./approval";

export interface DraftRecord {
  id: string;
  leadId: string;
  leadCompanyName: string;
  channel: OutreachChannel;
  language: OutreachLanguage;
  subject: string | null;
  messageBody: string;
  generationMode: "template" | "ai";
  approvalStatus: DraftStatus;
  createdById: string;
  createdByName: string | null;
  approvedById: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  decisionNote: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

type DraftRow = {
  id: string;
  lead_id: string;
  lead_company_name: string;
  channel: string;
  language: string;
  subject: string | null;
  message_body: string;
  generation_mode: string;
  approval_status: string;
  created_by: string;
  created_by_name: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: unknown;
  decision_note: string | null;
  created_at: unknown;
  updated_at: unknown;
};

function mapDraft(row: DraftRow): DraftRecord {
  return {
    id: row.id,
    leadId: row.lead_id,
    leadCompanyName: row.lead_company_name,
    channel: row.channel as OutreachChannel,
    language: row.language as OutreachLanguage,
    subject: row.subject,
    messageBody: row.message_body,
    generationMode: row.generation_mode === "ai" ? "ai" : "template",
    approvalStatus: row.approval_status as DraftStatus,
    createdById: row.created_by,
    createdByName: row.created_by_name,
    approvedById: row.approved_by,
    approvedByName: row.approved_by_name,
    approvedAt: toIsoOrNull(row.approved_at),
    decisionNote: row.decision_note,
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

export async function listDrafts(
  sql: SqlTag,
  input: { status: DraftStatus | null; leadId: string | null; page: number; pageSize: number },
): Promise<{ items: DraftRecord[]; total: number }> {
  const offset = (input.page - 1) * input.pageSize;
  const rows = await sql<DraftRow & { total: number }>`
    SELECT d.id, d.lead_id, l.company_name AS lead_company_name, d.channel, d.language, d.subject,
      d.message_body, d.generation_mode, d.approval_status, d.created_by, cu.display_name AS created_by_name,
      d.approved_by, au.display_name AS approved_by_name, d.approved_at, d.decision_note, d.created_at,
      d.updated_at, count(*) OVER()::int AS total
    FROM outreach_drafts d
    JOIN manufacturer_leads l ON l.id = d.lead_id
    JOIN users cu ON cu.id = d.created_by
    LEFT JOIN users au ON au.id = d.approved_by
    WHERE (${input.status}::text IS NULL OR d.approval_status = ${input.status}::text)
      AND (${input.leadId}::uuid IS NULL OR d.lead_id = ${input.leadId}::uuid)
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT ${input.pageSize} OFFSET ${offset}
  `;
  return { items: rows.map(mapDraft), total: rows[0] ? toCount(rows[0].total) : 0 };
}

export async function getDraft(sql: SqlTag, draftId: string): Promise<DraftRecord | null> {
  const rows = await sql<DraftRow>`
    SELECT d.id, d.lead_id, l.company_name AS lead_company_name, d.channel, d.language, d.subject,
      d.message_body, d.generation_mode, d.approval_status, d.created_by, cu.display_name AS created_by_name,
      d.approved_by, au.display_name AS approved_by_name, d.approved_at, d.decision_note, d.created_at,
      d.updated_at
    FROM outreach_drafts d
    JOIN manufacturer_leads l ON l.id = d.lead_id
    JOIN users cu ON cu.id = d.created_by
    LEFT JOIN users au ON au.id = d.approved_by
    WHERE d.id = ${draftId}::uuid
    LIMIT 1
  `;
  return rows[0] ? mapDraft(rows[0]) : null;
}

/** Inserts a draft and its audit row in one statement. */
export async function insertDraft(
  sql: SqlTag,
  input: {
    leadId: string;
    channel: OutreachChannel;
    language: OutreachLanguage;
    subject: string | null;
    messageBody: string;
    generationMode: "template" | "ai";
    createdById: string;
  },
): Promise<string> {
  const rows = await sql<{ id: string }>`
    WITH draft AS (
      INSERT INTO outreach_drafts (lead_id, channel, language, subject, message_body, generation_mode, approval_status, created_by)
      VALUES (
        ${input.leadId}::uuid, ${input.channel}, ${input.language}, ${input.subject}, ${input.messageBody},
        ${input.generationMode}, 'draft', ${input.createdById}::uuid
      )
      RETURNING id, lead_id
    ),
    audit AS (
      INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, safe_metadata_json)
      SELECT ${input.createdById}::uuid, 'outreach.draft_created', 'outreach_draft', id::text,
             jsonb_build_object('leadId', lead_id::text, 'channel', ${input.channel}::text,
                                'language', ${input.language}::text, 'generationMode', ${input.generationMode}::text)
      FROM draft
    )
    SELECT id FROM draft
  `;
  return rows[0].id;
}

/** Edits a draft's text. Allowed only for the author while the draft has not been submitted. */
export async function updateDraftContent(
  sql: SqlTag,
  input: { draftId: string; authorId: string; subject: string | null; messageBody: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    UPDATE outreach_drafts
    SET subject = ${input.subject}, message_body = ${input.messageBody}, updated_at = now()
    WHERE id = ${input.draftId}::uuid AND created_by = ${input.authorId}::uuid AND approval_status = 'draft'
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Moves a draft to its next status. Approval also advances the lead to Outreach Approved, but only when the
 * lead is still Verified or Contact Ready. The draft, lead change and audit row commit together in one statement.
 * Returns null when the draft is no longer in the expected status.
 */
export async function transitionDraft(
  sql: SqlTag,
  input: {
    draftId: string;
    expectedStatus: DraftStatus;
    nextStatus: DraftStatus;
    actorId: string;
    action: DraftAction;
    decisionNote: string | null;
  },
): Promise<{ id: string; leadId: string; approvalStatus: DraftStatus; leadAdvanced: boolean } | null> {
  const approving = input.nextStatus === "approved";
  const rows = await sql<{ id: string; lead_id: string; approval_status: string; lead_advanced: boolean }>`
    WITH draft AS (
      UPDATE outreach_drafts
      SET approval_status = ${input.nextStatus}::text,
          approved_by = CASE WHEN ${approving}::boolean THEN ${input.actorId}::uuid ELSE approved_by END,
          approved_at = CASE WHEN ${approving}::boolean THEN now() ELSE approved_at END,
          decision_note = COALESCE(${input.decisionNote}::text, decision_note),
          updated_at = now()
      WHERE id = ${input.draftId}::uuid AND approval_status = ${input.expectedStatus}::text
      RETURNING id, lead_id, approval_status
    ),
    lead AS (
      UPDATE manufacturer_leads
      SET lead_status = 'outreach_approved', updated_at = now()
      WHERE ${approving}::boolean
        AND id IN (SELECT lead_id FROM draft)
        AND lead_status IN ('verified', 'contact_ready')
      RETURNING id
    ),
    audit AS (
      INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, safe_metadata_json)
      SELECT ${input.actorId}::uuid, 'outreach.draft_' || ${input.action}::text, 'outreach_draft', draft.id::text,
             jsonb_build_object('leadId', draft.lead_id::text, 'toStatus', draft.approval_status,
                                'leadAdvanced', EXISTS (SELECT 1 FROM lead))
      FROM draft
    )
    SELECT draft.id, draft.lead_id, draft.approval_status, EXISTS (SELECT 1 FROM lead) AS lead_advanced
    FROM draft
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    leadId: row.lead_id,
    approvalStatus: row.approval_status as DraftStatus,
    leadAdvanced: row.lead_advanced === true,
  };
}
