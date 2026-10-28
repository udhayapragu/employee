import { z } from "zod";
import type { AppEnv } from "@/lib/config/env";

export const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT_CHARACTERS = 4000;

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface TextGenerator {
  readonly id: "anthropic";
  generate: (input: { system: string; user: string; maxTokens: number }, signal: AbortSignal) => Promise<string>;
}

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).max(20),
});

/** Anthropic Messages API adapter. The key is sent only in a request header and never logged. */
export function createAnthropicGenerator(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): TextGenerator {
  return {
    id: "anthropic",
    async generate({ system, user, maxTokens }, signal) {
      let response: Response;
      try {
        response = await fetchImpl(ANTHROPIC_MESSAGES_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: user }],
          }),
          signal,
          cache: "no-store",
        });
      } catch {
        throw new AiProviderError("The AI provider could not be reached.");
      }

      if (!response.ok) {
        throw new AiProviderError(`The AI provider returned HTTP ${response.status}.`);
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new AiProviderError("The AI provider returned an invalid response.");
      }

      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) throw new AiProviderError("The AI provider returned an unexpected response shape.");

      const text = parsed.data.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("")
        .slice(0, MAX_OUTPUT_CHARACTERS);

      if (text.trim().length === 0) throw new AiProviderError("The AI provider returned an empty response.");
      return text;
    },
  };
}

/** Returns the configured text generator, or null in limited mode. Limited mode never calls an external AI service. */
export function resolveTextGenerator(env: AppEnv): TextGenerator | null {
  if (env.AI_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) {
    return createAnthropicGenerator(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
  }
  return null;
}
