export const DRAFT_STATUSES = ["draft", "pending_review", "approved", "rejected", "cancelled"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export type DraftAction = "submit" | "approve" | "reject" | "cancel";

export interface DraftActor {
  id: string;
  canReview: boolean;
}

export interface DraftSnapshot {
  status: DraftStatus;
  createdById: string;
}

export type TransitionPlan =
  | { ok: true; to: DraftStatus; advancesLead: boolean }
  | { ok: false; httpStatus: 403 | 409 | 422; code: string; message: string };

/**
 * Approval state machine for outreach drafts.
 * - Only the author can submit a draft, and only the author can edit it while it is a draft.
 * - An approver with review permission can approve or reject, but never their own draft.
 * - Approval changes only the draft and, where it applies, the lead's outreach status.
 *   It never sends anything.
 */
export function planDraftTransition(
  draft: DraftSnapshot,
  action: DraftAction,
  actor: DraftActor,
  decisionNote: string | null,
): TransitionPlan {
  const isAuthor = actor.id === draft.createdById;

  switch (action) {
    case "submit": {
      if (!isAuthor) {
        return { ok: false, httpStatus: 403, code: "not_author", message: "Only the author can submit this draft." };
      }
      if (draft.status !== "draft") {
        return { ok: false, httpStatus: 409, code: "invalid_transition", message: "Only drafts can be submitted for review." };
      }
      return { ok: true, to: "pending_review", advancesLead: false };
    }

    case "approve":
    case "reject": {
      if (!actor.canReview) {
        return { ok: false, httpStatus: 403, code: "forbidden", message: "Your role cannot review drafts." };
      }
      if (isAuthor) {
        return {
          ok: false,
          httpStatus: 403,
          code: "self_approval_forbidden",
          message: "You cannot review a draft you wrote. Ask another reviewer.",
        };
      }
      if (draft.status !== "pending_review") {
        return { ok: false, httpStatus: 409, code: "invalid_transition", message: "Only drafts pending review can be decided." };
      }
      if (action === "reject" && (!decisionNote || decisionNote.trim().length < 3)) {
        return { ok: false, httpStatus: 422, code: "note_required", message: "Give a short reason when rejecting a draft." };
      }
      return action === "approve"
        ? { ok: true, to: "approved", advancesLead: true }
        : { ok: true, to: "rejected", advancesLead: false };
    }

    case "cancel": {
      if (!isAuthor && !actor.canReview) {
        return { ok: false, httpStatus: 403, code: "forbidden", message: "Only the author or a reviewer can cancel this draft." };
      }
      if (draft.status !== "draft" && draft.status !== "pending_review") {
        return { ok: false, httpStatus: 409, code: "invalid_transition", message: "Only open drafts can be cancelled." };
      }
      return { ok: true, to: "cancelled", advancesLead: false };
    }
  }
}

export function canEditDraft(draft: DraftSnapshot, actorId: string): boolean {
  return draft.status === "draft" && draft.createdById === actorId;
}
