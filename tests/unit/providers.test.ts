import { describe, expect, it, vi } from "vitest";
import { getEnv } from "@/lib/config/env";
import { createGooglePlacesProvider, GOOGLE_PLACES_SEARCH_ENDPOINT } from "@/lib/research/providers/google-places";
import { mockResearchProvider } from "@/lib/research/providers/mock";
import { resolveResearchAvailability } from "@/lib/research/registry";
import { ResearchProviderError, type ResearchQuery } from "@/lib/research/types";

const query: ResearchQuery = { category: "textiles", state: "Tamil Nadu", city: "Tiruppur", limit: 3 };
const signal = AbortSignal.timeout(5000);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const place = (overrides: Record<string, unknown> = {}) => ({
  id: "p1",
  displayName: { text: "Sample Knitwear Unit" },
  nationalPhoneNumber: "098765 43210",
  googleMapsUri: "https://maps.google.com/?cid=123",
  addressComponents: [
    { longText: "Tiruppur", types: ["locality"] },
    { longText: "Tamil Nadu", types: ["administrative_area_level_1"] },
  ],
  ...overrides,
});

describe("mock research provider", () => {
  it("returns exactly the requested number of clearly labelled synthetic records", async () => {
    const results = (await mockResearchProvider.search(query, signal)) as Record<string, unknown>[];
    expect(results).toHaveLength(3);
    for (const record of results) {
      expect(record.companyName).toMatch(/^\[SYNTHETIC\]/);
      expect(record.isSynthetic).toBe(true);
      expect(record.verificationStatus).toBe("synthetic");
      expect(record.businessPhone).toBeNull();
      expect(String(record.sourceUrl)).toMatch(/^https:\/\/example\.com\/synthetic\//);
    }
  });

  it("is deterministic, so a repeated search produces the same records", async () => {
    const first = await mockResearchProvider.search(query, signal);
    const second = await mockResearchProvider.search(query, signal);
    expect((second as { companyName: string }[]).map((r) => r.companyName)).toEqual(
      (first as { companyName: string }[]).map((r) => r.companyName),
    );
  });
});

describe("Google Places research provider", () => {
  it("maps a valid listing to a candidate and never invents missing fields", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ places: [place()] }));
    const provider = createGooglePlacesProvider("test-key-1234567890", fetchImpl as unknown as typeof fetch);

    const results = (await provider.search(query, signal)) as Record<string, unknown>[];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      companyName: "Sample Knitwear Unit",
      productCategory: "textiles",
      state: "Tamil Nadu",
      city: "Tiruppur",
      businessPhone: "098765 43210",
      sourceUrl: "https://maps.google.com/?cid=123",
      verificationStatus: "unverified",
      isSynthetic: false,
    });
  });

  it("sends the API key in a header and only search parameters in the body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ places: [] }));
    const provider = createGooglePlacesProvider("test-key-1234567890", fetchImpl as unknown as typeof fetch);
    await provider.search(query, signal);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GOOGLE_PLACES_SEARCH_ENDPOINT);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key-1234567890");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["languageCode", "maxResultCount", "regionCode", "textQuery"]);
    expect(JSON.stringify(body)).not.toContain("test-key");
    expect(body.maxResultCount).toBe(3);
  });

  it("drops results from another state rather than guessing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        places: [
          place({ addressComponents: [{ longText: "Kerala", types: ["administrative_area_level_1"] }] }),
          place({ displayName: { text: "Correct State Unit" } }),
        ],
      }),
    );
    const provider = createGooglePlacesProvider("test-key-1234567890", fetchImpl as unknown as typeof fetch);
    const results = (await provider.search(query, signal)) as { companyName: string }[];
    expect(results.map((r) => r.companyName)).toEqual(["Correct State Unit"]);
  });

  it("drops results without a citable Google listing URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ places: [place({ googleMapsUri: "http://insecure.example/x" })] }));
    const provider = createGooglePlacesProvider("test-key-1234567890", fetchImpl as unknown as typeof fetch);
    expect(await provider.search(query, signal)).toEqual([]);
  });

  it("skips malformed items while keeping valid ones", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ places: [{ displayName: 42 }, place()] }));
    const provider = createGooglePlacesProvider("test-key-1234567890", fetchImpl as unknown as typeof fetch);
    expect(await provider.search(query, signal)).toHaveLength(1);
  });

  it("honours the requested limit even when the API returns more", async () => {
    const many = Array.from({ length: 8 }, (_, i) => place({ id: `p${i}`, displayName: { text: `Unit ${i} Works` } }));
    const fetchImpl = vi.fn(async () => jsonResponse({ places: many }));
    const provider = createGooglePlacesProvider("test-key-1234567890", fetchImpl as unknown as typeof fetch);
    expect(await provider.search(query, signal)).toHaveLength(3);
  });

  it("fails clearly on an HTTP error without echoing the response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("secret upstream detail", { status: 403 }));
    const provider = createGooglePlacesProvider("test-key-1234567890", fetchImpl as unknown as typeof fetch);
    const error = await provider.search(query, signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResearchProviderError);
    expect((error as ResearchProviderError).message).toBe("Google Places request failed with HTTP 403.");
    expect((error as ResearchProviderError).message).not.toContain("secret");
  });

  it("rejects an invalid JSON body and an unexpected top-level shape", async () => {
    const invalid = createGooglePlacesProvider("test-key-1234567890", (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch);
    await expect(invalid.search(query, signal)).rejects.toThrow("invalid JSON");

    const wrongShape = createGooglePlacesProvider("test-key-1234567890", (async () => jsonResponse({ places: "nope" })) as unknown as typeof fetch);
    await expect(wrongShape.search(query, signal)).rejects.toThrow("unexpected response shape");
  });
});

describe("resolveResearchAvailability", () => {
  it("defaults to labelled mock mode", () => {
    const availability = resolveResearchAvailability(getEnv({}));
    expect(availability).toMatchObject({ available: true, mode: "mock" });
  });

  it("is unavailable, not silently mock, when real research is selected without a key", () => {
    const availability = resolveResearchAvailability(getEnv({ RESEARCH_PROVIDER: "google_places" }));
    expect(availability.available).toBe(false);
    expect(availability.message).toContain("GOOGLE_PLACES_API_KEY");
  });

  it("is available in real mode when the key is configured", () => {
    const availability = resolveResearchAvailability(
      getEnv({ RESEARCH_PROVIDER: "google_places", GOOGLE_PLACES_API_KEY: "test-key-1234567890" }),
    );
    expect(availability).toMatchObject({ available: true, mode: "real" });
  });

  it("is unavailable when research is disabled", () => {
    const availability = resolveResearchAvailability(getEnv({ RESEARCH_PROVIDER: "disabled" }));
    expect(availability).toMatchObject({ available: false, mode: "disabled" });
  });
});
