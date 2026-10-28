import { describe, expect, it } from "vitest";
import { researchInputSchema } from "@/lib/research/input";
import { providerCandidateSchema } from "@/lib/research/candidate";

const validInput = { category: "textiles", state: "tamil nadu", city: " Tiruppur ", limit: 5 };

describe("researchInputSchema", () => {
  it("accepts a valid request and canonicalises the state", () => {
    const parsed = researchInputSchema.parse(validInput);
    expect(parsed).toEqual({ category: "textiles", state: "Tamil Nadu", city: "Tiruppur", limit: 5 });
  });

  it("defaults the limit to 10 and treats a blank city as null", () => {
    const parsed = researchInputSchema.parse({ category: "textiles", state: "Kerala", city: "   " });
    expect(parsed).toEqual({ category: "textiles", state: "Kerala", city: null, limit: 10 });
  });

  it.each([0, -1, 21, 1.5, 999])("rejects limit %s", (limit) => {
    expect(researchInputSchema.safeParse({ ...validInput, limit }).success).toBe(false);
  });

  it("accepts the limit boundaries 1 and 20", () => {
    expect(researchInputSchema.safeParse({ ...validInput, limit: 1 }).success).toBe(true);
    expect(researchInputSchema.safeParse({ ...validInput, limit: 20 }).success).toBe(true);
  });

  it("rejects an unsupported product category", () => {
    const result = researchInputSchema.safeParse({ ...validInput, category: "weapons" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown state or a country-level value", () => {
    expect(researchInputSchema.safeParse({ ...validInput, state: "Atlantis" }).success).toBe(false);
    expect(researchInputSchema.safeParse({ ...validInput, state: "India" }).success).toBe(false);
  });

  it("rejects a city containing digits or symbols", () => {
    expect(researchInputSchema.safeParse({ ...validInput, city: "Tirupur<script>" }).success).toBe(false);
    expect(researchInputSchema.safeParse({ ...validInput, city: "Area 51" }).success).toBe(false);
  });

  it("rejects unknown keys, so a client cannot pass a URL to fetch", () => {
    const result = researchInputSchema.safeParse({ ...validInput, url: "https://evil.example/" });
    expect(result.success).toBe(false);
  });

  it("requires category, state and a numeric limit", () => {
    expect(researchInputSchema.safeParse({ state: "Kerala" }).success).toBe(false);
    expect(researchInputSchema.safeParse({ category: "textiles" }).success).toBe(false);
    expect(researchInputSchema.safeParse({ ...validInput, limit: "5" }).success).toBe(false);
  });
});

describe("providerCandidateSchema", () => {
  const candidate = {
    companyName: "Sample Unit",
    productCategory: "textiles",
    state: "Tamil Nadu",
    city: "Tiruppur",
    businessPhone: null,
    sourceName: "Test source",
    sourceUrl: "https://example.com/source/1",
    evidenceSummary: "Synthetic test evidence",
    collectedAt: "2026-10-28T10:00:00.000Z",
    verificationStatus: "unverified",
    isSynthetic: false,
    researchQuery: "category=textiles; state=Tamil Nadu; city=-; limit=5",
  };

  it("accepts a well-formed real candidate", () => {
    expect(providerCandidateSchema.safeParse(candidate).success).toBe(true);
  });

  it("rejects unknown fields that a provider might inject", () => {
    expect(providerCandidateSchema.safeParse({ ...candidate, verificationStatus2: "verified" }).success).toBe(false);
    expect(providerCandidateSchema.safeParse({ ...candidate, leadStatus: "archived" }).success).toBe(false);
  });

  it("refuses to let a provider mark a candidate verified", () => {
    expect(providerCandidateSchema.safeParse({ ...candidate, verificationStatus: "verified" }).success).toBe(false);
  });

  it("requires synthetic flags to agree", () => {
    expect(providerCandidateSchema.safeParse({ ...candidate, verificationStatus: "synthetic" }).success).toBe(false);
    expect(
      providerCandidateSchema.safeParse({ ...candidate, verificationStatus: "synthetic", isSynthetic: true }).success,
    ).toBe(true);
  });

  it("rejects a malformed collection timestamp", () => {
    expect(providerCandidateSchema.safeParse({ ...candidate, collectedAt: "yesterday" }).success).toBe(false);
  });
});
