import { getEnv } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";

/**
 * CSRF defence for cookie-authenticated mutations. A state-changing request must carry an Origin
 * header matching this application. Requests without Origin are refused.
 */
/**
 * The protocol the browser used. Behind a proxy this comes from x-forwarded-proto, otherwise from the URL.
 * Only http and https are accepted.
 */
function requestProtocol(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "http" || forwarded === "https") return forwarded;
  return new URL(request.url).protocol.replace(/:$/, "");
}

export function isSameOriginRequest(request: Request, env: { APP_ORIGIN?: string } = getEnv()): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  const allowed = new Set<string>([new URL(request.url).origin]);
  // The Host header is what the browser addressed. A cross-site page cannot change it, and
  // request.url can differ from it (for example when a proxy or `next start` rewrites the host).
  const host = request.headers.get("host");
  if (host) allowed.add(`${requestProtocol(request)}://${host}`);
  if (env.APP_ORIGIN) allowed.add(new URL(env.APP_ORIGIN).origin);
  return allowed.has(origin);
}

/** Throws a 403 ApiError unless the request comes from this application's origin. */
export function assertSameOrigin(request: Request): void {
  if (!isSameOriginRequest(request)) {
    throw new ApiError(403, "csrf_rejected", "This request was refused because it did not come from this site.");
  }
}
