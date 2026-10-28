import { z } from "zod";
import { requireApiUser } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { LEAD_STATUSES } from "@/lib/config/domain";
import type { SqlTag } from "@/lib/db/sql";
import { getSql } from "@/lib/db/client";
import { ApiError, jsonOk, parseJsonBody, withApi } from "@/lib/http/api";
import { checkManualStatusChange } from "@/lib/leads/lifecycle";
import {
  applyLeadUpdate,
  getLead,
  insertLeadNote,
  listLeadHistory,
  listLeadNotes,
  type LeadRecord,
} from "@/lib/leads/repository";
import { findAssignableUser } from "@/lib/users/repository";
import { canVerifyLead, verificationRequestSchema } from "@/lib/leads/verification";
import { assertSameOrigin } from "@/lib/security/origin";

/**
 * Lead changes are a closed set of actions. Each action accepts only the fields listed here, and the
 * strict schemas reject anything else. There is no generic field update.
 */
const leadPatchSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("change_status"),
      status: z.enum(LEAD_STATUSES),
      note: z.string().trim().min(3).max(2000).optional(),
    })
    .strict(),
  verificationRequestSchema.extend({ action: z.literal("verify") }),
  z
    .object({
      action: z.literal("assign"),
      assignedUserId: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("follow_up"),
      followUpAt: z.iso.datetime().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("add_note"),
      body: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal("resolve_duplicate"),
      decision: z.enum(["not_duplicate", "duplicate"]),
    })
    .strict(),
]);

async function loadLeadOr404(sql: SqlTag, leadId: string): Promise<LeadRecord> {
  const lead = await getLead(sql, leadId);
  if (!lead) throw new ApiError(404, "not_found", "Lead not found.");
  return lead;
}

function conflict(): ApiError {
  return new ApiError(409, "lead_changed", "This lead changed while you were editing. Reload it and try again.");
}

function forbidden(): ApiError {
  return new ApiError(403, "forbidden", "Your role does not allow this action.");
}

export const GET = withApi<{ id: string }>(async (request, { params, requestId }) => {
  await requireApiUser(request, "lead:read");
  const leadId = z.uuid().parse(params.id);
  const sql = getSql();

  const lead = await loadLeadOr404(sql, leadId);
  const [notes, history] = await Promise.all([listLeadNotes(sql, leadId), listLeadHistory(sql, leadId)]);
  return jsonOk({ lead, notes, history }, requestId);
});

export const PATCH = withApi<{ id: string }>(async (request, { params, requestId }) => {
  assertSameOrigin(request);
  const user = await requireApiUser(request, "lead:read");
  const leadId = z.uuid().parse(params.id);
  const body = await parseJsonBody(request, leadPatchSchema);
  const sql = getSql();
  const lead = await loadLeadOr404(sql, leadId);

  switch (body.action) {
    case "change_status": {
      if (!hasPermission(user.role, "lead:update")) throw forbidden();

      const check = checkManualStatusChange({
        from: lead.leadStatus,
        to: body.status,
        hasEvidenceNote: body.note !== undefined,
        verificationStatus: lead.verificationStatus,
      });
      if (!check.ok) throw new ApiError(422, check.code, check.message);

      const updated = await applyLeadUpdate(sql, {
        leadId: lead.id,
        actorId: user.id,
        expectedStatus: lead.leadStatus,
        leadStatus: body.status,
        auditAction: "lead.status_changed",
        auditMetadata: { fromStatus: lead.leadStatus, toStatus: body.status, hasNote: body.note !== undefined },
      });
      if (!updated) throw conflict();
      if (body.note) {
        await insertLeadNote(sql, { leadId: lead.id, authorId: user.id, body: body.note });
      }
      break;
    }

    case "verify": {
      if (!hasPermission(user.role, "lead:verify")) throw forbidden();

      const check = canVerifyLead(lead);
      if (!check.ok) throw new ApiError(422, check.code, check.message);

      const updated = await applyLeadUpdate(sql, {
        leadId: lead.id,
        actorId: user.id,
        expectedStatus: lead.leadStatus,
        verification: { evidenceSummary: body.evidenceSummary },
        auditAction: "lead.verified",
        auditMetadata: {
          fromStatus: lead.leadStatus,
          toStatus: "verified",
          sourceReviewed: true,
          businessIdentityConfirmed: true,
          manufacturingActivityConfirmed: true,
        },
      });
      if (!updated) throw conflict();
      break;
    }

    case "assign": {
      if (!hasPermission(user.role, "lead:update")) throw forbidden();
      if (body.assignedUserId !== null) {
        const assignee = await findAssignableUser(sql, body.assignedUserId);
        if (!assignee) throw new ApiError(422, "assignee_not_available", "Choose an active team member who can work leads.");
      }

      const updated = await applyLeadUpdate(sql, {
        leadId: lead.id,
        actorId: user.id,
        expectedStatus: lead.leadStatus,
        assignedUserId: body.assignedUserId,
        auditAction: "lead.assigned",
        auditMetadata: { assigned: body.assignedUserId !== null },
      });
      if (!updated) throw conflict();
      break;
    }

    case "follow_up": {
      if (!hasPermission(user.role, "lead:update")) throw forbidden();

      const updated = await applyLeadUpdate(sql, {
        leadId: lead.id,
        actorId: user.id,
        expectedStatus: lead.leadStatus,
        followUpAt: body.followUpAt,
        auditAction: "lead.follow_up_set",
        auditMetadata: { cleared: body.followUpAt === null },
      });
      if (!updated) throw conflict();
      break;
    }

    case "add_note": {
      if (!hasPermission(user.role, "lead:update")) throw forbidden();
      await insertLeadNote(sql, { leadId: lead.id, authorId: user.id, body: body.body });
      break;
    }

    case "resolve_duplicate": {
      if (!hasPermission(user.role, "lead:update")) throw forbidden();
      if (lead.possibleDuplicateOf === null || lead.leadStatus !== "needs_review") {
        throw new ApiError(422, "not_flagged", "This lead is not flagged as a possible duplicate.");
      }

      const updated =
        body.decision === "not_duplicate"
          ? await applyLeadUpdate(sql, {
              leadId: lead.id,
              actorId: user.id,
              expectedStatus: "needs_review",
              leadStatus: "discovered",
              clearDuplicateFlag: true,
              auditAction: "lead.duplicate_dismissed",
              auditMetadata: { fromStatus: "needs_review", toStatus: "discovered" },
            })
          : await applyLeadUpdate(sql, {
              leadId: lead.id,
              actorId: user.id,
              expectedStatus: "needs_review",
              leadStatus: "archived",
              auditAction: "lead.marked_duplicate",
              auditMetadata: { fromStatus: "needs_review", toStatus: "archived" },
            });
      if (!updated) throw conflict();
      break;
    }
  }

  const latest = await loadLeadOr404(sql, leadId);
  return jsonOk({ lead: latest }, requestId);
});
