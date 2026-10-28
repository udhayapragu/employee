import { z } from "zod";

/** Schema for one candidate returned by a provider. Unknown keys are rejected. */
export const providerCandidateSchema = z
  .object({
    companyName: z.string().trim().min(2).max(200),
    productCategory: z.string().min(1).max(80),
    state: z.string().trim().min(2).max(80),
    city: z.string().trim().min(1).max(80).nullable(),
    businessPhone: z.string().trim().max(40).nullable(),
    sourceName: z.string().trim().min(1).max(120),
    sourceUrl: z.string().min(1).max(2048),
    evidenceSummary: z.string().max(2000).nullable(),
    collectedAt: z.iso.datetime(),
    verificationStatus: z.enum(["unverified", "synthetic"]),
    isSynthetic: z.boolean(),
    researchQuery: z.string().max(500),
  })
  .strict()
  .refine((candidate) => (candidate.verificationStatus === "synthetic") === candidate.isSynthetic, {
    message: "Synthetic flags are inconsistent.",
  });

export type ProviderCandidate = z.infer<typeof providerCandidateSchema>;
