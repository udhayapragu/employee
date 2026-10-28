import { categoryLabel } from "@/lib/config/domain";
import { buildResearchQueryLabel, type ResearchProvider, type ResearchQuery } from "../types";

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Mock provider for development and UI testing. It produces deterministic, clearly labelled synthetic
 * records on reserved example domains. It never produces real business names, phone numbers or sources.
 * Because output is deterministic, repeating a search reports the same records as skipped duplicates.
 */
export const mockResearchProvider: ResearchProvider = {
  id: "mock",
  mode: "mock",
  async search(query: ResearchQuery) {
    const collectedAt = new Date().toISOString();
    const label = categoryLabel(query.category);
    const researchQuery = buildResearchQueryLabel(query);

    return Array.from({ length: query.limit }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      const slug = [query.category, query.state, query.city ?? "statewide", number].map(slugPart).join("-");
      return {
        companyName: `[SYNTHETIC] ${label} Demo Unit ${number}`,
        productCategory: query.category,
        state: query.state,
        city: query.city,
        businessPhone: null,
        sourceName: "Mock provider (synthetic data)",
        sourceUrl: `https://example.com/synthetic/${slug}`,
        evidenceSummary: "Synthetic development record. It is not a real business and has not been verified.",
        collectedAt,
        verificationStatus: "synthetic",
        isSynthetic: true,
        researchQuery,
      };
    });
  },
};
