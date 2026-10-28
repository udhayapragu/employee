import type { SqlTag } from "@/lib/db/sql";
import { toCount, toIsoOrNull } from "@/lib/db/rows";
import type { ResearchInput } from "./input";
import type { ProviderId, ProviderMode } from "./types";

export interface ResearchJobRecord {
  id: string;
  requestedById: string;
  requestedByName: string | null;
  category: string;
  state: string;
  city: string | null;
  requestedLimit: number;
  provider: ProviderId;
  providerMode: ProviderMode;
  status: string;
  discoveredCount: number;
  insertedCount: number;
  skippedCount: number;
  needsReviewCount: number;
  errorSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

export interface JobCounts {
  discovered: number;
  inserted: number;
  skipped: number;
  needsReview: number;
}

type JobRow = {
  id: string;
  requested_by: string;
  requested_by_name: string | null;
  category: string;
  state: string;
  city: string | null;
  requested_limit: number;
  provider: string;
  provider_mode: string;
  status: string;
  discovered_count: number;
  inserted_count: number;
  skipped_count: number;
  needs_review_count: number;
  error_summary: string | null;
  started_at: unknown;
  completed_at: unknown;
  created_at: unknown;
};

function mapJob(row: JobRow): ResearchJobRecord {
  return {
    id: row.id,
    requestedById: row.requested_by,
    requestedByName: row.requested_by_name,
    category: row.category,
    state: row.state,
    city: row.city,
    requestedLimit: toCount(row.requested_limit),
    provider: row.provider === "google_places" ? "google_places" : "mock",
    providerMode: row.provider_mode === "real" ? "real" : "mock",
    status: row.status,
    discoveredCount: toCount(row.discovered_count),
    insertedCount: toCount(row.inserted_count),
    skippedCount: toCount(row.skipped_count),
    needsReviewCount: toCount(row.needs_review_count),
    errorSummary: row.error_summary,
    startedAt: toIsoOrNull(row.started_at),
    completedAt: toIsoOrNull(row.completed_at),
    createdAt: toIsoOrNull(row.created_at),
  };
}

export async function listResearchJobs(
  sql: SqlTag,
  page: number,
  pageSize: number,
): Promise<{ items: ResearchJobRecord[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const rows = await sql<JobRow & { total: number }>`
    SELECT j.id, j.requested_by, u.display_name AS requested_by_name, j.category, j.state, j.city,
           j.requested_limit, j.provider, j.provider_mode, j.status, j.discovered_count, j.inserted_count,
           j.skipped_count, j.needs_review_count, j.error_summary, j.started_at, j.completed_at, j.created_at,
           count(*) OVER()::int AS total
    FROM research_jobs j
    JOIN users u ON u.id = j.requested_by
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  return { items: rows.map(mapJob), total: rows[0] ? toCount(rows[0].total) : 0 };
}

export async function getResearchJob(sql: SqlTag, jobId: string): Promise<ResearchJobRecord | null> {
  const rows = await sql<JobRow>`
    SELECT j.id, j.requested_by, u.display_name AS requested_by_name, j.category, j.state, j.city,
           j.requested_limit, j.provider, j.provider_mode, j.status, j.discovered_count, j.inserted_count,
           j.skipped_count, j.needs_review_count, j.error_summary, j.started_at, j.completed_at, j.created_at
    FROM research_jobs j
    JOIN users u ON u.id = j.requested_by
    WHERE j.id = ${jobId}::uuid
    LIMIT 1
  `;
  return rows[0] ? mapJob(rows[0]) : null;
}

/** Jobs started by one user in the last hour. Used for a database-backed quota shared across instances. */
export async function countJobsByUserSince(sql: SqlTag, userId: string, minutes: number): Promise<number> {
  const rows = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM research_jobs
    WHERE requested_by = ${userId}::uuid AND created_at > now() - make_interval(mins => ${minutes})
  `;
  return toCount(rows[0]?.n);
}

/** Jobs still marked running and started recently. Stale rows are ignored so a crash cannot block the queue forever. */
export async function countRunningJobs(sql: SqlTag, staleAfterMinutes: number): Promise<number> {
  const rows = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM research_jobs
    WHERE status = 'running' AND started_at > now() - make_interval(mins => ${staleAfterMinutes})
  `;
  return toCount(rows[0]?.n);
}

export async function insertRunningJob(
  sql: SqlTag,
  input: { requestedBy: string; query: ResearchInput; provider: ProviderId; providerMode: ProviderMode },
): Promise<string> {
  const rows = await sql<{ id: string }>`
    INSERT INTO research_jobs (requested_by, category, state, city, requested_limit, provider, provider_mode, status, started_at)
    VALUES (
      ${input.requestedBy}::uuid, ${input.query.category}, ${input.query.state}, ${input.query.city},
      ${input.query.limit}, ${input.provider}, ${input.providerMode}, 'running', now()
    )
    RETURNING id
  `;
  return rows[0].id;
}

export async function completeJob(sql: SqlTag, jobId: string, counts: JobCounts): Promise<void> {
  await sql`
    UPDATE research_jobs
    SET status = 'completed',
        discovered_count = ${counts.discovered},
        inserted_count = ${counts.inserted},
        skipped_count = ${counts.skipped},
        needs_review_count = ${counts.needsReview},
        completed_at = now(),
        updated_at = now()
    WHERE id = ${jobId}::uuid
  `;
}

export async function failJob(sql: SqlTag, jobId: string, errorSummary: string): Promise<void> {
  await sql`
    UPDATE research_jobs
    SET status = 'failed', error_summary = ${errorSummary.slice(0, 500)}, completed_at = now(), updated_at = now()
    WHERE id = ${jobId}::uuid
  `;
}

/** Inserts an idempotency record. Returns the task ID, or null when the key already exists. */
export async function insertAgentTask(
  sql: SqlTag,
  input: { idempotencyKey: string; taskType: string; payload: unknown; jobId: string | null },
): Promise<string | null> {
  const rows = await sql<{ id: string }>`
    INSERT INTO agent_tasks (agent_name, task_type, input_json, status, attempts, idempotency_key, output_json, started_at)
    VALUES (
      'SCOUT', ${input.taskType}, ${JSON.stringify(input.payload)}::jsonb, 'running', 1, ${input.idempotencyKey},
      ${JSON.stringify({ researchJobId: input.jobId })}::jsonb, now()
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;
  return rows[0]?.id ?? null;
}

export async function findAgentTaskByKey(
  sql: SqlTag,
  idempotencyKey: string,
): Promise<{ id: string; status: string; output: Record<string, unknown> | null } | null> {
  const rows = await sql<{ id: string; status: string; output_json: Record<string, unknown> | null }>`
    SELECT id, status, output_json FROM agent_tasks WHERE idempotency_key = ${idempotencyKey} LIMIT 1
  `;
  const row = rows[0];
  return row ? { id: row.id, status: row.status, output: row.output_json } : null;
}

export async function setAgentTaskOutput(sql: SqlTag, taskId: string, output: Record<string, unknown>): Promise<void> {
  await sql`
    UPDATE agent_tasks SET output_json = ${JSON.stringify(output)}::jsonb, updated_at = now()
    WHERE id = ${taskId}::uuid
  `;
}

export async function finishAgentTask(
  sql: SqlTag,
  taskId: string,
  outcome: { status: "completed" | "failed"; output: Record<string, unknown>; errorSummary: string | null },
): Promise<void> {
  await sql`
    UPDATE agent_tasks
    SET status = ${outcome.status},
        output_json = ${JSON.stringify(outcome.output)}::jsonb,
        error_summary = ${outcome.errorSummary},
        completed_at = now(),
        updated_at = now()
    WHERE id = ${taskId}::uuid
  `;
}
