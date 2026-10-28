import { describe, expect, it } from "vitest";
import {
  diceCoefficient,
  normalizeCity,
  normalizeCompanyName,
  normalizePhoneIN,
  normalizeSourceUrl,
  normalizeText,
} from "@/lib/normalize";

describe("normalizeCompanyName", () => {
  it("lowercases, strips punctuation and trailing legal suffixes", () => {
    expect(normalizeCompanyName("Textiles India Pvt. Ltd.")).toBe("textiles india");
    expect(normalizeCompanyName("ACME Industries Private Limited")).toBe("acme industries");
    expect(normalizeCompanyName("Gupta & Sons LLP")).toBe("gupta and sons");
  });

  it("keeps the word India when it is part of the business name", () => {
    expect(normalizeCompanyName("India Steel Works")).toBe("india steel works");
  });

  it("removes diacritics so spelling variants match", () => {
    expect(normalizeCompanyName("Café Spices Co")).toBe("cafe spices");
  });

  it("never reduces a name to nothing", () => {
    expect(normalizeCompanyName("Ltd")).toBe("ltd");
    expect(normalizeCompanyName("   ")).toBe("");
  });
});

describe("normalizeText and normalizeCity", () => {
  it("collapses whitespace and punctuation", () => {
    expect(normalizeText("  Tiruppur,   Tamil-Nadu!  ")).toBe("tiruppur tamil nadu");
  });

  it("returns an empty string for a missing city", () => {
    expect(normalizeCity(null)).toBe("");
    expect(normalizeCity(undefined)).toBe("");
    expect(normalizeCity("Coimbatore")).toBe("coimbatore");
  });
});

describe("normalizePhoneIN", () => {
  it.each([
    ["+91 98765 43210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091 9876543210", "+919876543210"],
    ["(0422) 2345678", null],
    ["98765-43210", "+919876543210"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhoneIN(input)).toBe(expected);
  });

  it.each([
    "1234567890",
    "+1 555 123 4567",
    "12345",
    "9876543210 ext 12",
    "98765 43210 / 98765 11111",
    "call me on 9876543210",
    "+91 5876543210",
    "",
    null,
    undefined,
  ])("rejects ambiguous or non-Indian input %s", (input) => {
    expect(normalizePhoneIN(input as string | null | undefined)).toBeNull();
  });
});

describe("normalizeSourceUrl", () => {
  it("accepts a public https URL and canonicalises it", () => {
    expect(normalizeSourceUrl("https://Example-Company.in/products/?utm_source=x#top")).toBe(
      "https://example-company.in/products",
    );
  });

  it.each([
    "http://example-company.in/",
    "javascript:alert(1)",
    "data:text/html,hello",
    "ftp://example.com/file",
    "https://user:pass@example.com/",
    "https://localhost/admin",
    "https://192.168.1.10/panel",
    "https://[::1]/",
    "https://intranet/",
    "not a url",
    "",
  ])("rejects %s", (input) => {
    expect(normalizeSourceUrl(input)).toBeNull();
  });

  it("rejects URLs longer than 2048 characters", () => {
    const long = `https://example.com/${"a".repeat(2100)}`;
    expect(normalizeSourceUrl(long)).toBeNull();
  });
});

describe("diceCoefficient", () => {
  it("is 1 for identical non-empty strings and 0 when strings are too short to form a bigram", () => {
    expect(diceCoefficient("acme", "acme")).toBe(1);
    expect(diceCoefficient("a", "a")).toBe(1);
    expect(diceCoefficient("a", "b")).toBe(0);
  });

  it("scores near-identical names above the duplicate threshold", () => {
    expect(diceCoefficient("shree ganesh textiles", "shree ganesh textile")).toBeGreaterThan(0.92);
  });

  it("scores unrelated names low", () => {
    expect(diceCoefficient("acme steel", "bluebird foods")).toBeLessThan(0.3);
  });
});
