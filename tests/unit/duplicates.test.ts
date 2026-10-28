import { describe, expect, it } from "vitest";
import { classifyCandidate, type ExistingLead, type LeadIdentity } from "@/lib/research/duplicates";

const base: LeadIdentity = {
  normalizedCompanyName: "shree ganesh textiles",
  state: "Tamil Nadu",
  normalizedCity: "tiruppur",
  productCategory: "textiles",
  normalizedPhone: "+919876543210",
  normalizedSourceUrl: "https://example.in/a",
};

function existing(overrides: Partial<ExistingLead> = {}): ExistingLead {
  return { id: "11111111-1111-4111-8111-111111111111", ...base, normalizedSourceUrl: "https://example.in/other", normalizedPhone: null, ...overrides };
}

describe("classifyCandidate", () => {
  it("treats an unrelated record as new", () => {
    expect(classifyCandidate(base, [existing({ normalizedCompanyName: "bluebird foods", state: "Kerala" })])).toEqual({
      kind: "new",
    });
  });

  it("skips an exact match on name, state, city and category", () => {
    const decision = classifyCandidate(base, [existing()]);
    expect(decision.kind).toBe("exact");
  });

  it("skips the same source page and business name even when other fields differ", () => {
    const decision = classifyCandidate(base, [existing({ normalizedSourceUrl: base.normalizedSourceUrl, productCategory: "garments" })]);
    expect(decision).toMatchObject({ kind: "exact", reason: "same source page and business name" });
  });

  it("flags the same name in the same state under another category for review", () => {
    const decision = classifyCandidate(base, [existing({ productCategory: "garments" })]);
    expect(decision).toMatchObject({ kind: "possible" });
    expect(decision.kind === "possible" && decision.reason).toContain("same name in same state");
  });

  it("flags a similar name in the same state for review", () => {
    const decision = classifyCandidate({ ...base, normalizedCompanyName: "shree ganesh textile" }, [existing()]);
    expect(decision.kind).toBe("possible");
    expect(decision.kind === "possible" && decision.reason).toContain("similar name in same state");
  });

  it("does not flag names that differ only by a number as similar", () => {
    const decision = classifyCandidate(
      { ...base, normalizedCompanyName: "shree ganesh textiles 2", normalizedPhone: null },
      [existing({ normalizedCompanyName: "shree ganesh textiles 1", normalizedPhone: null })],
    );
    expect(decision.kind).toBe("new");
  });

  it("flags a shared phone number but never treats it as an exact duplicate", () => {
    const decision = classifyCandidate(
      { ...base, normalizedCompanyName: "bluebird foods", state: "Kerala" },
      [existing({ normalizedPhone: base.normalizedPhone, state: "Tamil Nadu" })],
    );
    expect(decision).toMatchObject({ kind: "possible", reason: "same phone number" });
  });

  it("does not match a similar name across different states", () => {
    const decision = classifyCandidate(base, [existing({ state: "Kerala" })]);
    expect(decision.kind).toBe("new");
  });

  it("reports the first matching existing record for review", () => {
    const decision = classifyCandidate(base, [
      existing({ id: "aaaa", normalizedCompanyName: "other name", state: "Kerala" }),
      existing({ id: "bbbb", productCategory: "garments" }),
    ]);
    expect(decision).toMatchObject({ kind: "possible", existingId: "bbbb" });
  });

  it("caps the stored reason length", () => {
    const decision = classifyCandidate({ ...base, normalizedPhone: "+919876543210" }, [
      existing({ productCategory: "garments", normalizedPhone: "+919876543210" }),
    ]);
    expect(decision.kind === "possible" && decision.reason.length).toBeLessThanOrEqual(300);
  });
});
