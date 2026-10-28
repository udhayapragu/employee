import type { SqlTag } from "@/lib/db/sql";
import { toCount } from "@/lib/db/rows";

export interface OverviewStats {
  totalLeads: number;
  syntheticLeads: number;
  needsReview: number;
  verifiedLeads: number;
  researchJobsCompleted: number;
  researchJobsFailed: number;
  draftsPendingReview: number;
}

/** Counts come from the database only. Synthetic test records are reported separately from real leads. */
export async function getOverviewStats(sql: SqlTag): Promise<OverviewStats> {
  const rows = await sql<Record<string, unknown>>`
    SELECT
      (SELECT count(*) FROM manufacturer_leads WHERE is_synthetic = false) AS total_leads,
      (SELECT count(*) FROM manufacturer_leads WHERE is_synthetic = true) AS synthetic_leads,
      (SELECT count(*) FROM manufacturer_leads WHERE lead_status = 'needs_review') AS needs_review,
      (SELECT count(*) FROM manufacturer_leads WHERE verification_status = 'verified') AS verified_leads,
      (SELECT count(*) FROM research_jobs WHERE status = 'completed') AS jobs_completed,
      (SELECT count(*) FROM research_jobs WHERE status = 'failed') AS jobs_failed,
      (SELECT count(*) FROM outreach_drafts WHERE approval_status = 'pending_review') AS drafts_pending
  `;
  const row = rows[0] ?? {};
  return {
    totalLeads: toCount(row.total_leads),
    syntheticLeads: toCount(row.synthetic_leads),
    needsReview: toCount(row.needs_review),
    verifiedLeads: toCount(row.verified_leads),
    researchJobsCompleted: toCount(row.jobs_completed),
    researchJobsFailed: toCount(row.jobs_failed),
    draftsPendingReview: toCount(row.drafts_pending),
  };
}
