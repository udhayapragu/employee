import { z } from "zod";
import { categoryLabel, resolveIndianState } from "@/lib/config/domain";
import { normalizeSourceUrl } from "@/lib/normalize";
import { buildResearchQueryLabel, ResearchProviderError, type ResearchProvider, type ResearchQuery } from "../types";

export const GOOGLE_PLACES_SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.nationalPhoneNumber",
  "places.googleMapsUri",
  "places.formattedAddress",
  "places.addressComponents",
].join(",");
const MAX_RESPONSE_CHARACTERS = 512 * 1024;

const envelopeSchema = z.object({ places: z.array(z.unknown()).max(20).optional() });

const placeSchema = z.object({
  displayName: z.object({ text: z.string().min(1).max(300) }),
  nationalPhoneNumber: z.string().max(60).optional(),
  googleMapsUri: z.string().min(1).max(2048),
  addressComponents: z
    .array(z.object({ longText: z.string().min(1).max(200), types: z.array(z.string().max(60)).max(20) }))
    .max(30)
    .optional(),
});

function componentText(
  components: { longText: string; types: string[] }[] | undefined,
  type: string,
): string | null {
  return components?.find((component) => component.types.includes(type))?.longText ?? null;
}

/**
 * Maps one Places result to a candidate. Returns null when the result cannot be trusted for this query:
 * the state does not match, or there is no Google Maps listing URL to cite. Missing fields are never guessed.
 */
function toCandidate(
  place: z.infer<typeof placeSchema>,
  query: ResearchQuery,
  collectedAt: string,
): Record<string, unknown> | null {
  const stateName = componentText(place.addressComponents, "administrative_area_level_1");
  const state = stateName ? resolveIndianState(stateName) : null;
  if (!state || state !== query.state) return null;

  const sourceUrl = normalizeSourceUrl(place.googleMapsUri);
  if (!sourceUrl) return null;

  return {
    companyName: place.displayName.text,
    productCategory: query.category,
    state,
    city: componentText(place.addressComponents, "locality"),
    businessPhone: place.nationalPhoneNumber ?? null,
    sourceName: "Google Places API (text search)",
    sourceUrl,
    evidenceSummary:
      "Listed in Google Places text search results for this query. The listing shows a business name, not proof of manufacturing activity.",
    collectedAt,
    verificationStatus: "unverified",
    isSynthetic: false,
    researchQuery: buildResearchQueryLabel(query),
  };
}

/**
 * Real research via the documented Google Places API (New) text search.
 * Requires an API key from server-side configuration. The request is bounded by the caller's abort signal.
 * Storage of Places content is restricted by Google Maps Platform terms; review them before production use.
 */
export function createGooglePlacesProvider(apiKey: string, fetchImpl: typeof fetch = fetch): ResearchProvider {
  return {
    id: "google_places",
    mode: "real",
    async search(query, signal) {
      const location = query.city ? `${query.city}, ${query.state}` : query.state;
      const response = await fetchImpl(GOOGLE_PLACES_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
          "x-goog-fieldmask": FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: `${categoryLabel(query.category)} manufacturer in ${location}, India`,
          maxResultCount: query.limit,
          regionCode: "IN",
          languageCode: "en",
        }),
        signal,
        cache: "no-store",
      });

      if (!response.ok) {
        throw new ResearchProviderError(`Google Places request failed with HTTP ${response.status}.`, response.status);
      }

      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARACTERS) {
        throw new ResearchProviderError("Google Places returned a response that was too large.");
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ResearchProviderError("Google Places returned an invalid JSON response.");
      }

      const envelope = envelopeSchema.safeParse(json);
      if (!envelope.success) {
        throw new ResearchProviderError("Google Places returned an unexpected response shape.");
      }

      const collectedAt = new Date().toISOString();
      const candidates: Record<string, unknown>[] = [];
      for (const raw of envelope.data.places ?? []) {
        const parsed = placeSchema.safeParse(raw);
        if (!parsed.success) continue;
        const candidate = toCandidate(parsed.data, query, collectedAt);
        if (candidate) candidates.push(candidate);
        if (candidates.length >= query.limit) break;
      }
      return candidates;
    },
  };
}
