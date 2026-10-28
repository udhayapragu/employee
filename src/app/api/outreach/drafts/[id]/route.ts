import { z } from "zod";
import { insertAuditLog } from "@/lib/audit/log";
import { requireApiUser } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { getSql } from "@/lib/db/client";
import { ApiError, jsonOk, parseJsonBody, withApi } from "@/lib/http/api";
import { planDraftTransition } from "@/lib/outreach/approval";
import { getDraft, transitionDraft, updateDraftContent } from "@/lib/outreach/repository";
import { assertSameOrigin } from "@/lib/security/origin";

const draftPatchSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("edit"),
      subject: z.string().trim().min(1).max(200).nullable(),
      messageBody: z.string().trim().min(1).max(3000),
    })
    .strict(),
  z.object({ action: z.literal("submit") }).strict(),
  z.object({ action: z.literal("approve") }).strict(),
  z
    .object({
      action: z.literal("reject"),
      decisionNote: z.string().trim().min(3).max(500),
    })
    .strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);

export const GET = withApi<{ id: string }>(async (request, { params, requestId }) => {
  await requireApiUser(request, "lead:read");
  const draftId = z.uuid().parse(params.id);
  const draft = await getDraft(getSql(), draftId);
  if (!draft) throw new ApiError(404, "not_found", "Draft not found.");
  return jsonOk({ draft }, requestId);
});

/**
 * Edits or moves a draft through approval. Each action is checked on the server against the actor's role
 * and the draft's status. Approval changes the draft and lead status only. Nothing is sent.
 */
export const PATCH = withApi<{ id: string }>(async (request, { params, requestId }) => {
  assertSameOrigin(request);
  const user = await requireApiUser(request, "lead:read");
  const draftId = z.uuid().parse(params.id);
  const body = await parseJsonBody(request, draftPatchSchema);
  const sql = getSql();

  const draft = await getDraft(sql, draftId);
  if (!draft) throw new ApiError(404, "not_found", "Draft not found.");

  const canCreate = hasPermission(user.role, "draft:create");
  const canReview = hasPermission(user.role, "draft:review");

  if (body.action === "edit") {
    if (!canCreate) throw new ApiError(403, "forbidden", "Your role cannot edit drafts.");
    const updated = await updateDraftContent(sql, {
      draftId,
      authorId: user.id,
      subject: body.subject,
      messageBody: body.messageBody,
    });
    if (!updated) {
      throw new ApiError(409, "draft_not_editable", "Only the author can edit a draft that has not been submitted.");
    }
    await insertAuditLog(sql, {
      actorId: user.id,
      action: "outreach.draft_edited",
      entityType: "outreach_draft",
      entityId: draftId,
    });
  } else {
    if ((body.action === "submit" || body.action === "cancel") && !canCreate && !canReview) {
      throw new ApiError(403, "forbidden", "Your role cannot change this draft.");
    }
    if ((body.action === "approve" || body.action === "reject") && !canReview) {
      throw new ApiError(403, "forbidden", "Your role cannot review drafts.");
    }

    const decisionNote = body.action === "reject" ? body.decisionNote : null;
    const plan = planDraftTransition(
      { status: draft.approvalStatus, createdById: draft.createdById },
      body.action,
      { id: user.id, canReview },
      decisionNote,
    );
    if (!plan.ok) throw new ApiError(plan.httpStatus, plan.code, plan.message);

    const result = await transitionDraft(sql, {
      draftId,
      expectedStatus: draft.approvalStatus,
      nextStatus: plan.to,
      actorId: user.id,
      action: body.action,
      decisionNote,
    });
    if (!result) throw new ApiError(409, "draft_changed", "This draft changed while you were working on it. Reload it.");
  }

  const latest = await getDraft(sql, draftId);
  return jsonOk({ draft: latest }, requestId);
});
