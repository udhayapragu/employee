import { createRateLimiter } from "./rate-limit";

/** Per-instance request limits. Database-backed quotas for research jobs are in research/service.ts. */
export const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
export const researchRequestLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
export const draftRequestLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
export const exportLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });

/** Client address for rate-limit keys. The platform sets x-forwarded-for; the first entry is the client. */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : "unknown";
}
