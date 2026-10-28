import { z } from "zod";
import { INDIAN_STATES, isCategorySlug, resolveIndianState, type IndianState } from "@/lib/config/domain";

/** Letters (any script), combining marks, spaces, dots, apostrophes and hyphens. No digits or symbols. */
const CITY_PATTERN = /^[\p{L}\p{M} .'-]+$/u;

export const researchInputSchema = z
  .object({
    category: z
      .string()
      .trim()
      .refine(isCategorySlug, { message: "Choose a supported product category." }),
    state: z
      .string()
      .trim()
      .max(80)
      .refine((value) => resolveIndianState(value) !== null, {
        message: "Choose a valid Indian state or union territory.",
      }),
    city: z
      .string()
      .trim()
      .max(80)
      .nullish()
      .transform((value) => (value && value.length > 0 ? value : null))
      .refine((value) => value === null || CITY_PATTERN.test(value), {
        message: "City may contain letters, spaces, dots, apostrophes and hyphens only.",
      }),
    limit: z.number().int().min(1, "Limit must be at least 1.").max(20, "Limit cannot exceed 20.").default(10),
  })
  .strict()
  .transform((value) => ({
    category: value.category,
    state: resolveIndianState(value.state) as IndianState,
    city: value.city,
    limit: value.limit,
  }));

export type ResearchInput = z.output<typeof researchInputSchema>;

export { INDIAN_STATES };
