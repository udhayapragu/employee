import { z } from "zod";
import type { LeadStatus } from "@/lib/config/domain";
import { canStartVerification, type CheckResult } from "./lifecycle";

/**
 * The defined verification procedure. A reviewer must confirm each checklist item after opening the source,
 * and must describe the evidence. Only then may a lead be marked verified. Attestations are recorded in the audit log.
 */
export const VERIFICATION_CHECKLIST = [
  {
    key: "sourceReviewed",
    label: "I opened the source link and reviewed the listing myself.",
  },
  {
    key: "businessIdentityConfirmed",
    label: "The company name, city and state match the source.",
  },
  {
    key: "manufacturingActivityConfirmed",
    label: "Public information shows the business manufactures this product category.",
  },
] as const;

export const verificationRequestSchema = z
  .object({
    sourceReviewed: z.literal(true),
    businessIdentityConfirmed: z.literal(true),
    manufacturingActivityConfirmed: z.literal(true),
    evidenceSummary: z.string().trim().min(20, "Describe the evidence in at least 20 characters.").max(2000),
  })
  .strict();

export type VerificationRequest = z.infer<typeof verificationRequestSchema>;

export function canVerifyLead(lead: { isSynthetic: boolean; leadStatus: LeadStatus }): CheckResult {
  if (lead.isSynthetic) {
    return { ok: false, code: "synthetic_record", message: "Synthetic test records cannot be verified." };
  }
  if (!canStartVerification(lead.leadStatus)) {
    return {
      ok: false,
      code: "status_blocks_verification",
      message: "This lead's current status does not allow verification.",
    };
  }
  return { ok: true };
}
