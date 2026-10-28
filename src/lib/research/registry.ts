import { describeResearchAvailability, type AppEnv } from "@/lib/config/env";
import { createGooglePlacesProvider } from "./providers/google-places";
import { mockResearchProvider } from "./providers/mock";
import type { ResearchProvider } from "./types";

export type ResearchAvailability =
  | { available: true; provider: ResearchProvider; mode: "mock" | "real"; message: string }
  | { available: false; mode: "disabled" | "real"; message: string };

/**
 * Chooses the research provider from server configuration. If the configured provider cannot run,
 * this returns unavailable. It never falls back to mock data.
 */
export function resolveResearchAvailability(env: AppEnv): ResearchAvailability {
  const status = describeResearchAvailability(env);
  if (!status.available) {
    return { available: false, mode: status.mode === "disabled" ? "disabled" : "real", message: status.message };
  }
  if (status.mode === "mock") {
    return { available: true, provider: mockResearchProvider, mode: "mock", message: status.message };
  }
  if (env.GOOGLE_PLACES_API_KEY) {
    return {
      available: true,
      provider: createGooglePlacesProvider(env.GOOGLE_PLACES_API_KEY),
      mode: "real",
      message: status.message,
    };
  }
  return { available: false, mode: "real", message: status.message };
}
