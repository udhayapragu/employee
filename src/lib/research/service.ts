import { randomUUID } from "node:crypto";
import { insertAuditLog } from "@/lib/audit/log";
import { isCategorySlug, resolveIndianState, type IndianState } from "@/lib/config/domain";
import type { SqlTag } from "@/lib/db/sql";
import { findPossibleDuplicates, insertDiscoveredLead } from "@/lib/leads/repository";
import { logEvent } from "@/lib/log/logger";
import { ApiError } from "@/lib/http/api";
import { normalizeCity, normalizeCompanyName, normalizePhoneIN, normalizeSourceUrl } from "@/lib/normalize";
import { providerCandidateSchema } from "./candidate";
import { classifyCandidate, type DuplicateDecision } from "./duplicates";
import type { ResearchInput } from "./input";
import {
  completeJob,
  countJobsByUserSince,
  countRunningJobs,
  failJob,
  findAgentTaskByKey,
  finishAgentTask,
  insertAgentTask,
  insertRunningJob,
  setAgentTaskOutput,
  type JobCounts,
} from "./jobs-repository";
import { ResearchProviderError, type ProviderId, type ProviderMode, type ResearchProvider } from "./types";

export const RESEARCH_LIMITS = {
  jobsPerUserPerHour: 10,
  maxConcurrentJobs: 2,
  staleJobMinutes: 10,
  providerTimeoutMs: 15_000,
} as const;

export interface ResearchRunOutcome {
  jobId: string;
  status: "completed" | "failed";
  providerId: ProviderId;
  providerMode: ProviderMode;
  counts: JobCounts;
  errorSummary: string | null;
  /** True when an earlier request with the same Idempotency-Key produced this result. */
  reused: boolean;
}

export interface RunResearchParams {
  sql: SqlTag;
  provider: ResearchProvider;
  actorId: string;
  input: ResearchInput;
  idempotencyKey: string | null;
}

type CandidateResult = { kind: "inserted" | "needs_review" | "skipped" };

const EMPTY_COUNTS: JobCounts = { discovered: 0, inserted: 0, skipped: 0, needsReview: 0 };

function outcomeFromOutput(output: Record<string, unknown>, jobId: string): ResearchRunOutcome {
  const counts = (output.counts ?? EMPTY_COUNTS) as JobCounts;
  return {
    jobId,
    status: output.status === "failed" ? "failed" : "completed",
    providerId: output.providerId === "google_places" ? "google_places" : "mock",
    providerMode: output.providerMode === "real" ? "real" : "mock",
    counts,
    errorSummary: typeof output.errorSummary === "string" ? output.errorSummary : null,
    reused: true,
  };
}

function describeProviderFailure(error: unknown): string {
  if (error instanceof ResearchProviderError) return error.message;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "The research provider did not respond in time.";
  }
  return "The research provider failed unexpectedly.";
}

/** Validates a candidate and saves it. Duplicates are skipped. Possible duplicates are kept and flagged. */
async function saveCandidate(
  sql: SqlTag,
  raw: unknown,
  input: ResearchInput,
  jobId: string,
): Promise<CandidateResult> {
  const parsed = providerCandidateSchema.safeParse(raw);
  if (!parsed.success) return { kind: "skipped" };
  const candidate = parsed.data;

  const state = resolveIndianState(candidate.state);
  const category = isCategorySlug(candidate.productCategory) ? candidate.productCategory : null;
  if (!state || !category || state !== input.state || category !== input.category) return { kind: "skipped" };

  const normalizedCompanyName = normalizeCompanyName(candidate.companyName);
  const sourceUrl = normalizeSourceUrl(candidate.sourceUrl);
  if (normalizedCompanyName.length < 2 || !sourceUrl) return { kind: "skipped" };

  const normalizedPhone = normalizePhoneIN(candidate.businessPhone);
  const city = candidate.city ? candidate.city.trim() : null;
  const normalizedCity = normalizeCity(city);
  const identity = {
    normalizedCompanyName,
    state: state as IndianState,
    normalizedCity,
    productCategory: category,
    normalizedPhone,
    normalizedSourceUrl: sourceUrl,
  };

  const existing = await findPossibleDuplicates(sql, identity);
  const decision: DuplicateDecision = classifyCandidate(identity, existing);
  if (decision.kind === "exact") return { kind: "skipped" };

  const flagged = decision.kind === "possible";
  const leadId = await insertDiscoveredLead(sql, {
    companyName: candidate.companyName,
    normalizedCompanyName,
    productCategory: category,
    state,
    city,
    normalizedCity,
    businessPhone: candidate.businessPhone,
    normalizedPhone,
    sourceName: candidate.sourceName,
    sourceUrl,
    normalizedSourceUrl: sourceUrl,
    evidenceSummary: candidate.evidenceSummary,
    verificationStatus: candidate.isSynthetic ? "synthetic" : flagged ? "needs_review" : "unverified",
    leadStatus: flagged ? "needs_review" : "discovered",
    isSynthetic: candidate.isSynthetic,
    researchQuery: candidate.researchQuery,
    researchJobId: jobId,
    collectedAt: candidate.collectedAt,
    possibleDuplicateOf: flagged ? decision.existingId : null,
    duplicateReason: flagged ? decision.reason : null,
  });

  // A null result means a concurrent insert matched the exact-duplicate key first.
  if (!leadId) return { kind: "skipped" };
  return { kind: flagged ? "needs_review" : "inserted" };
}

/**
 * Runs one research job end to end: idempotency, quotas, provider call, validation, duplicate
 * classification, persistence and counts. Counts always satisfy discovered = inserted + skipped.
 * Failures are recorded on the job and the task. A failed run never falls back to mock data.
 */
export async function runResearchJob(params: RunResearchParams): Promise<ResearchRunOutcome> {
  const { sql, provider, actorId, input } = params;

  if (params.idempotencyKey) {
    const existing = await findAgentTaskByKey(sql, scopedKey(actorId, params.idempotencyKey));
    if (existing) {
      const jobId = typeof existing.output?.researchJobId === "string" ? existing.output.researchJobId : null;
      if (existing.status === "running" || !jobId) {
        throw new ApiError(409, "request_in_progress", "A request with this Idempotency-Key is already in progress.");
      }
      return outcomeFromOutput(existing.output ?? {}, jobId);
    }
  }

  const hourlyCount = await countJobsByUserSince(sql, actorId, 60);
  if (hourlyCount >= RESEARCH_LIMITS.jobsPerUserPerHour) {
    throw new ApiError(429, "research_quota_exceeded", "You have reached the hourly research limit. Try again later.");
  }
  const runningCount = await countRunningJobs(sql, RESEARCH_LIMITS.staleJobMinutes);
  if (runningCount >= RESEARCH_LIMITS.maxConcurrentJobs) {
    throw new ApiError(429, "too_many_running_jobs", "Other research jobs are running. Try again shortly.");
  }

  const key = params.idempotencyKey ? scopedKey(actorId, params.idempotencyKey) : scopedKey(actorId, randomUUID());
  const taskId = await insertAgentTask(sql, {
    idempotencyKey: key,
    taskType: "research.search",
    payload: { category: input.category, state: input.state, city: input.city, limit: input.limit },
    jobId: null,
  });
  if (!taskId) {
    throw new ApiError(409, "request_in_progress", "A request with this Idempotency-Key is already in progress.");
  }

  const jobId = await insertRunningJob(sql, {
    requestedBy: actorId,
    query: input,
    provider: provider.id,
    providerMode: provider.mode,
  });
  await setAgentTaskOutput(sql, taskId, { researchJobId: jobId });

  let rawCandidates: unknown[];
  try {
    const result = await provider.search(
      { category: input.category, state: input.state, city: input.city, limit: input.limit },
      AbortSignal.timeout(RESEARCH_LIMITS.providerTimeoutMs),
    );
    if (!Array.isArray(result)) throw new ResearchProviderError("The research provider returned an invalid result.");
    rawCandidates = result.slice(0, input.limit);
  } catch (error) {
    const summary = describeProviderFailure(error);
    await failJob(sql, jobId, summary);
    await finishAgentTask(sql, taskId, {
      status: "failed",
      output: { researchJobId: jobId, status: "failed", providerId: provider.id, providerMode: provider.mode, errorSummary: summary, counts: EMPTY_COUNTS },
      errorSummary: summary,
    });
    logEvent("warn", "research.provider_failed", { jobId, providerId: provider.id, reason: summary });
    return { jobId, status: "failed", providerId: provider.id, providerMode: provider.mode, counts: EMPTY_COUNTS, errorSummary: summary, reused: false };
  }

  const counts: JobCounts = { discovered: rawCandidates.length, inserted: 0, skipped: 0, needsReview: 0 };
  try {
    for (const raw of rawCandidates) {
      const result = await saveCandidate(sql, raw, input, jobId);
      if (result.kind === "skipped") counts.skipped += 1;
      else counts.inserted += 1;
      if (result.kind === "needs_review") counts.needsReview += 1;
    }

    await completeJob(sql, jobId, counts);
    const output = { researchJobId: jobId, status: "completed", providerId: provider.id, providerMode: provider.mode, counts, errorSummary: null };
    await finishAgentTask(sql, taskId, { status: "completed", output, errorSummary: null });
    await insertAuditLog(sql, {
      actorId,
      action: "research.job.completed",
      entityType: "research_job",
      entityId: jobId,
      metadata: {
        providerMode: provider.mode,
        discovered: counts.discovered,
        inserted: counts.inserted,
        skipped: counts.skipped,
        needsReview: counts.needsReview,
      },
    });
    logEvent("info", "research.job.completed", { jobId, providerMode: provider.mode, ...counts });

    return { jobId, status: "completed", providerId: provider.id, providerMode: provider.mode, counts, errorSummary: null, reused: false };
  } catch (error) {
    const summary = "Saving research results failed. Some records may have been saved; review the job before retrying.";
    await failJob(sql, jobId, summary);
    await finishAgentTask(sql, taskId, {
      status: "failed",
      output: { researchJobId: jobId, status: "failed", providerId: provider.id, providerMode: provider.mode, errorSummary: summary, counts },
      errorSummary: summary,
    });
    logEvent("error", "research.save_failed", { jobId, errorName: error instanceof Error ? error.name : "unknown" });
    throw new ApiError(500, "research_save_failed", summary, { jobId });
  }
}

function scopedKey(actorId: string, key: string): string {
  return `research:${actorId}:${key}`.slice(0, 200);
}
