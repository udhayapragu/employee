import { diceCoefficient } from "@/lib/normalize";

/** Minimum name similarity for a "possible duplicate" flag. Flags never merge or delete records. */
export const SIMILAR_NAME_THRESHOLD = 0.92;

/**
 * Names that differ in a number ("Unit 1" and "Unit 2", "Plant 3" and "Plant 4") are different businesses.
 * Character similarity alone cannot see that, so numbers must agree before names are called similar.
 */
function namesSimilar(a: string, b: string): boolean {
  const numbersA = (a.match(/\d+/g) ?? []).join(" ");
  const numbersB = (b.match(/\d+/g) ?? []).join(" ");
  if (numbersA !== numbersB) return false;
  return diceCoefficient(a, b) >= SIMILAR_NAME_THRESHOLD;
}

export interface LeadIdentity {
  normalizedCompanyName: string;
  state: string;
  normalizedCity: string;
  productCategory: string;
  normalizedPhone: string | null;
  normalizedSourceUrl: string;
}

export interface ExistingLead extends LeadIdentity {
  id: string;
}

export type DuplicateDecision =
  | { kind: "new" }
  | { kind: "exact"; existingId: string; reason: string }
  | { kind: "possible"; existingId: string; reason: string };

/**
 * Conservative duplicate classification.
 * - exact: same name, state, city and category, or the same source page and business name. The candidate is skipped.
 * - possible: a similar name in the same state, or a shared phone number. The candidate is kept and flagged for review.
 * - new: no relevant match.
 * A shared phone number alone never causes a merge, because one number can serve several businesses.
 */
export function classifyCandidate(candidate: LeadIdentity, existing: readonly ExistingLead[]): DuplicateDecision {
  for (const row of existing) {
    if (
      row.normalizedCompanyName === candidate.normalizedCompanyName &&
      row.state === candidate.state &&
      row.normalizedCity === candidate.normalizedCity &&
      row.productCategory === candidate.productCategory
    ) {
      return { kind: "exact", existingId: row.id, reason: "same name, state, city and category" };
    }
    if (
      row.normalizedSourceUrl === candidate.normalizedSourceUrl &&
      row.normalizedCompanyName === candidate.normalizedCompanyName
    ) {
      return { kind: "exact", existingId: row.id, reason: "same source page and business name" };
    }
  }

  const reasons = new Set<string>();
  let firstMatchId: string | null = null;

  for (const row of existing) {
    const matched: string[] = [];
    if (row.state === candidate.state) {
      if (row.normalizedCompanyName === candidate.normalizedCompanyName) {
        matched.push("same name in same state");
      } else if (namesSimilar(row.normalizedCompanyName, candidate.normalizedCompanyName)) {
        matched.push("similar name in same state");
      }
    }
    if (candidate.normalizedPhone && row.normalizedPhone === candidate.normalizedPhone) {
      matched.push("same phone number");
    }
    if (matched.length > 0) {
      firstMatchId ??= row.id;
      matched.forEach((reason) => reasons.add(reason));
    }
  }

  if (firstMatchId) {
    return { kind: "possible", existingId: firstMatchId, reason: [...reasons].join("; ").slice(0, 300) };
  }
  return { kind: "new" };
}
