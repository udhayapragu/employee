import { insertAuditLog } from "@/lib/audit/log";
import { requireApiUser } from "@/lib/auth/access";
import { toCsv } from "@/lib/export/csv";
import { getSql } from "@/lib/db/client";
import { ApiError, withApi } from "@/lib/http/api";
import { parseLeadListQuery } from "@/lib/leads/query";
import { listLeads, type LeadRecord } from "@/lib/leads/repository";
import { exportLimiter } from "@/lib/security/limits";

const EXPORT_LIMIT = 5000;

const HEADERS = [
  "Company",
  "Product category",
  "State",
  "City",
  "Business phone (E.164)",
  "Source name",
  "Source URL",
  "Verification status",
  "Lead status",
  "Synthetic test record",
  "Duplicate flagged",
  "Assigned to",
  "Collected at",
  "Date added",
];

function row(lead: LeadRecord): (string | boolean | null)[] {
  return [
    lead.companyName,
    lead.productCategory,
    lead.state,
    lead.city,
    lead.normalizedPhone,
    lead.sourceName,
    lead.sourceUrl,
    lead.verificationStatus,
    lead.leadStatus,
    lead.isSynthetic,
    lead.possibleDuplicateOf !== null,
    lead.assignedUserName,
    lead.collectedAt,
    lead.createdAt,
  ];
}

/**
 * Exports the leads matching the current filters, bounded to 5,000 rows. Every cell is protected against
 * spreadsheet formula injection by the CSV helper. Each export is recorded in the audit log.
 */
export const GET = withApi(async (request, { requestId }) => {
  const user = await requireApiUser(request, "lead:export");
  if (!exportLimiter.check(`user:${user.id}`).allowed) {
    throw new ApiError(429, "rate_limited", "Too many exports. Wait a few minutes and try again.");
  }

  const parsed = parseLeadListQuery(new URL(request.url).searchParams);
  if (!parsed.success) throw parsed.error;

  const sql = getSql();
  const result = await listLeads(sql, { ...parsed.data, page: 1, pageSize: EXPORT_LIMIT });
  const csv = toCsv(HEADERS, result.items.map(row));

  await insertAuditLog(sql, {
    actorId: user.id,
    action: "lead.exported",
    entityType: "manufacturer_lead",
    entityId: null,
    metadata: { rowCount: result.items.length, truncated: result.total > EXPORT_LIMIT },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bulkskart-leads-${stamp}.csv"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
});
