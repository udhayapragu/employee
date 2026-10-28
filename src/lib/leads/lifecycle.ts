import type { LeadStatus, VerificationStatus } from "@/lib/config/domain";

/** Allowed lead-status transitions. Anything not listed is rejected. */
const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  discovered: ["needs_review", "verified", "not_interested", "archived"],
  needs_review: ["discovered", "verified", "not_interested", "archived"],
  verified: ["contact_ready", "needs_review", "not_interested", "opted_out", "archived"],
  contact_ready: ["outreach_approved", "verified", "not_interested", "opted_out", "archived"],
  outreach_approved: ["contacted", "contact_ready", "not_interested", "opted_out", "archived"],
  contacted: ["replied", "not_interested", "opted_out", "archived"],
  replied: ["interested", "not_interested", "opted_out", "archived"],
  interested: ["registration_started", "not_interested", "opted_out", "archived"],
  registration_started: ["registered", "not_interested", "archived"],
  registered: ["subscription_active", "archived"],
  subscription_active: ["archived"],
  not_interested: ["needs_review", "archived"],
  opted_out: ["archived"],
  archived: ["needs_review"],
};

/**
 * Statuses a person may set by hand. Others are set only by the system:
 * - verified: through the verification checklist
 * - outreach_approved: when an outreach draft is approved
 * - registration and subscription statuses: only from genuine application or financial records,
 *   which this version does not yet receive
 */
export const MANUAL_STATUS_TARGETS: readonly LeadStatus[] = [
  "needs_review",
  "contact_ready",
  "contacted",
  "replied",
  "interested",
  "not_interested",
  "opted_out",
  "archived",
];

/** Moves into these statuses need a written evidence note, so no contact is recorded without support. */
const EVIDENCE_REQUIRED: ReadonlySet<LeadStatus> = new Set<LeadStatus>(["contacted", "replied", "interested"]);

export type CheckResult = { ok: true } | { ok: false; code: string; message: string };

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function checkManualStatusChange(input: {
  from: LeadStatus;
  to: LeadStatus;
  hasEvidenceNote: boolean;
  verificationStatus: VerificationStatus;
}): CheckResult {
  if (input.from === input.to) {
    return { ok: false, code: "no_change", message: "The lead is already in that status." };
  }
  if (!MANUAL_STATUS_TARGETS.includes(input.to)) {
    return {
      ok: false,
      code: "status_not_manual",
      message: "This status is set by the system from a verified process, not by hand.",
    };
  }
  if (!canTransition(input.from, input.to)) {
    return { ok: false, code: "invalid_transition", message: `A lead cannot move from ${labelFor(input.from)} to ${labelFor(input.to)}.` };
  }
  if (input.to === "contact_ready" && input.verificationStatus !== "verified") {
    return { ok: false, code: "requires_verification", message: "Verify the lead before marking it contact ready." };
  }
  if (EVIDENCE_REQUIRED.has(input.to) && !input.hasEvidenceNote) {
    return { ok: false, code: "requires_evidence_note", message: "Add a note describing the evidence for this status." };
  }
  return { ok: true };
}

const CONTACTABLE_BLOCKED: ReadonlySet<LeadStatus> = new Set<LeadStatus>([
  "not_interested",
  "opted_out",
  "archived",
  "registration_started",
  "registered",
  "subscription_active",
]);

/** Statuses from which outreach drafts may be created. Opted-out and archived leads are never contacted. */
export function isContactableStatus(status: LeadStatus): boolean {
  return !CONTACTABLE_BLOCKED.has(status) && status !== "discovered" && status !== "needs_review";
}

/** Statuses from which the verification checklist may be completed. */
export function canStartVerification(status: LeadStatus): boolean {
  return status === "discovered" || status === "needs_review" || status === "verified" || status === "contact_ready";
}

export function labelFor(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
