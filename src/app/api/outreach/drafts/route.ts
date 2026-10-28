import { z } from "zod";
import { requireApiUser } from "@/lib/auth/access";
import { getEnv } from "@/lib/config/env";
import { getSql } from "@/lib/db/client";
import { resolveTextGenerator } from "@/lib/ai/provider";
import { ApiError, jsonOk, parseJsonBody, withApi } from "@/lib/http/api";
import { getLead } from "@/lib/leads/repository";
import { DRAFT_STATUSES } from "@/lib/outreach/approval";
import { draftRequestSchema, createOutreachDraft } from "@/lib/outreach/drafting";
import { getDraft, listDrafts } from "@/lib/outreach/repository";
import { draftRequestLimiter } from "@/lib/security/limits";
import { assertSameOrigin } from "@/lib/security/origin";

const listQuerySchema = z.object({
  status: z.enum(DRAFT_STATUSES).optional(),
  leadId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = withApi(async (request, { requestId }) => {
  await requireApiUser(request, "lead:read");
  const query = listQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const result = await listDrafts(getSql(), {
    status: query.status ?? null,
    leadId: query.leadId ?? null,
    page: query.page,
    pageSize: query.pageSize,
  });
  return jsonOk({ ...result, page: query.page, pageSize: query.pageSize }, requestId);
});

/**
 * Creates a draft for a verified lead. The draft starts as a draft and is never sent. Approval is a separate step.
 */
export const POST = withApi(async (request, { requestId }) => {
  assertSameOrigin(request);
  const user = await requireApiUser(request, "draft:create");
  if (!draftRequestLimiter.check(`user:${user.id}`).allowed) {
    throw new ApiError(429, "rate_limited", "Too many draft requests. Wait a few minutes and try again.");
  }

  const body = await parseJsonBody(request, draftRequestSchema.extend({ useAi: z.boolean().default(false) }));
  const sql = getSql();

  const lead = await getLead(sql, body.leadId);
  if (!lead) throw new ApiError(404, "not_found", "Lead not found.");

  const created = await createOutreachDraft({
    sql,
    actorId: user.id,
    lead,
    channel: body.channel,
    language: body.language,
    generator: resolveTextGenerator(getEnv()),
    useAi: body.useAi,
  });
  const draft = await getDraft(sql, created.id);
  return jsonOk({ draft }, requestId, 201);
});
