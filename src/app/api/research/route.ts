import { requireApiUser } from "@/lib/auth/access";
import { getEnv } from "@/lib/config/env";
import { getSql } from "@/lib/db/client";
import { ApiError, jsonOk, parseJsonBody, withApi } from "@/lib/http/api";
import { researchInputSchema } from "@/lib/research/input";
import { resolveResearchAvailability } from "@/lib/research/registry";
import { runResearchJob } from "@/lib/research/service";
import { researchRequestLimiter } from "@/lib/security/limits";
import { assertSameOrigin } from "@/lib/security/origin";

export const maxDuration = 30;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function parseIdempotencyKey(value: string | null): string | null {
  if (value === null) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApiError(400, "invalid_idempotency_key", "Idempotency-Key must be 8 to 128 letters, digits, '-' or '_'.");
  }
  return value;
}

/**
 * Starts a research job. The provider is chosen from server configuration. The client supplies only the
 * search parameters (category, state, optional city, limit), never a URL to fetch.
 */
export const POST = withApi(async (request, { requestId }) => {
  assertSameOrigin(request);
  const user = await requireApiUser(request, "research:run");

  if (!researchRequestLimiter.check(`user:${user.id}`).allowed) {
    throw new ApiError(429, "rate_limited", "Too many research requests. Wait a few minutes and try again.");
  }

  const input = await parseJsonBody(request, researchInputSchema);
  const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));

  const availability = resolveResearchAvailability(getEnv());
  if (!availability.available) {
    throw new ApiError(503, "research_unavailable", availability.message);
  }

  const outcome = await runResearchJob({
    sql: getSql(),
    provider: availability.provider,
    actorId: user.id,
    input,
    idempotencyKey,
  });

  const status = outcome.status === "failed" ? 502 : outcome.reused ? 200 : 201;
  return jsonOk({ job: outcome, mode: availability.mode, message: availability.message }, requestId, status);
});
