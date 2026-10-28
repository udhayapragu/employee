import { z } from "zod";
import {
  isCategorySlug,
  LEAD_STATUSES,
  resolveIndianState,
  VERIFICATION_STATUSES,
  type IndianState,
  type LeadStatus,
  type VerificationStatus,
} from "@/lib/config/domain";
import { escapeLikePattern } from "@/lib/db/rows";
import { normalizeCity } from "@/lib/normalize";

export const LEAD_SORT_FIELDS = ["company_name", "state", "created_at", "updated_at"] as const;
export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];
export type SortOrder = "asc" | "desc";

export interface LeadListFilters {
  category: string | null;
  state: IndianState | null;
  normalizedCity: string | null;
  verification: VerificationStatus | null;
  status: LeadStatus | null;
  /** LIKE pattern for company-name search with wildcards escaped. Null when there is no search text. */
  namePattern: string | null;
  researchJobId: string | null;
  duplicatesOnly: boolean;
}

export interface LeadListQuery {
  filters: LeadListFilters;
  sort: LeadSortField;
  order: SortOrder;
  page: number;
  pageSize: number;
}

const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Query-string schema for the lead list. Blank values are removed before parsing. */
export const leadListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    category: optionalText(80).refine((value) => value === undefined || isCategorySlug(value), {
      message: "Unsupported product category.",
    }),
    state: optionalText(80).refine((value) => value === undefined || resolveIndianState(value) !== null, {
      message: "Unsupported Indian state or union territory.",
    }),
    city: optionalText(80),
    verification: z.enum(VERIFICATION_STATUSES).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    q: optionalText(100),
    researchJobId: z.uuid().optional(),
    duplicates: z.enum(["true", "false"]).optional(),
    sort: z.enum(LEAD_SORT_FIELDS).default("created_at"),
    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .transform((input): LeadListQuery => {
    const city = input.city ? normalizeCity(input.city) : "";
    const search = input.q && input.q.length > 0 ? input.q : null;
    return {
      filters: {
        category: input.category ?? null,
        state: input.state ? resolveIndianState(input.state) : null,
        normalizedCity: city.length > 0 ? city : null,
        verification: input.verification ?? null,
        status: input.status ?? null,
        namePattern: search ? `%${escapeLikePattern(search)}%` : null,
        researchJobId: input.researchJobId ?? null,
        duplicatesOnly: input.duplicates === "true",
      },
      sort: input.sort,
      order: input.order,
      page: input.page,
      pageSize: input.pageSize,
    };
  });

/** Parses URLSearchParams for the lead list. Blank values are treated as absent. */
export function parseLeadListQuery(searchParams: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (value.trim() !== "") raw[key] = value;
  }
  return leadListQuerySchema.safeParse(raw);
}
