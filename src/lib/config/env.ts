import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url().optional(),
  RESEARCH_PROVIDER: z.enum(["mock", "google_places", "disabled"]).default("mock"),
  GOOGLE_PLACES_API_KEY: z.string().min(10).max(200).optional(),
  AI_PROVIDER: z.enum(["none", "anthropic"]).default("none"),
  ANTHROPIC_API_KEY: z.string().min(10).max(300).optional(),
  ANTHROPIC_MODEL: z.string().min(3).max(100).default("claude-haiku-5-5"),
  APP_ORIGIN: z.url().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Thrown when server configuration is missing or invalid. Messages name variables only, never values. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function getEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "unknown")))];
    throw new ConfigError(`Invalid server configuration for: ${names.join(", ")}`);
  }
  return parsed.data;
}

/** True when a research provider can run. Used to show status in the UI without exposing values. */
export function describeResearchAvailability(env: AppEnv): { available: boolean; mode: "mock" | "real" | "disabled"; message: string } {
  if (env.RESEARCH_PROVIDER === "disabled") {
    return { available: false, mode: "disabled", message: "Research is disabled by configuration (RESEARCH_PROVIDER=disabled)." };
  }
  if (env.RESEARCH_PROVIDER === "mock") {
    return {
      available: true,
      mode: "mock",
      message: "MOCK MODE: results are synthetic test records, not real manufacturers.",
    };
  }
  if (env.GOOGLE_PLACES_API_KEY) {
    return { available: true, mode: "real", message: "REAL MODE: Google Places API text search." };
  }
  return {
    available: false,
    mode: "real",
    message: "Real research is unavailable: set GOOGLE_PLACES_API_KEY on the server (see README) to enable Google Places research.",
  };
}
