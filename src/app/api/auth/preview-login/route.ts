import { NextResponse } from "next/server";
import { insertAuditLog } from "@/lib/audit/log";
import { previewLoginConfig } from "@/lib/auth/preview-login";
import { createSession, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { getSql } from "@/lib/db/client";
import { ApiError, withApi } from "@/lib/http/api";
import { logEvent } from "@/lib/log/logger";
import { clientAddress, loginLimiter } from "@/lib/security/limits";
import { assertSameOrigin } from "@/lib/security/origin";
import { findUserByEmail } from "@/lib/users/repository";

/**
 * Preview-only sign-in. Outside a preview deployment, or when the gate in src/lib/auth/preview-login.ts is
 * closed, this route answers exactly like a route that does not exist, so it reveals nothing about itself.
 * It reads one active account and creates a session for it. It never reads or changes a password or a user row.
 */
export const POST = withApi(async (request, { requestId }) => {
  const config = previewLoginConfig();
  if (!config.enabled) {
    logEvent("info", "auth.preview_login_unavailable", { requestId, reason: config.reason });
    throw new ApiError(404, "not_found", "Not found.");
  }

  assertSameOrigin(request);
  const limit = loginLimiter.check(`preview:ip:${clientAddress(request)}`);
  if (!limit.allowed) {
    throw new ApiError(429, "rate_limited", "Too many sign-in attempts. Wait a few minutes and try again.");
  }

  const sql = getSql();
  const account = await findUserByEmail(sql, config.email);
  if (!account || !account.isActive) {
    logEvent("info", "auth.preview_login_unavailable", { requestId, reason: "the preview account is missing or inactive" });
    throw new ApiError(404, "not_found", "Not found.");
  }

  const { token, expiresAt } = await createSession(sql, account.id, getEnv().SESSION_TTL_HOURS);
  await insertAuditLog(sql, {
    actorId: account.id,
    action: "auth.preview_login",
    entityType: "user",
    entityId: account.id,
    metadata: { preview: true },
  });
  logEvent("warn", "auth.preview_login", { requestId });

  const response = NextResponse.json(
    { user: { id: account.id, email: account.email, displayName: account.displayName, role: account.role } },
    { status: 200, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt, process.env.NODE_ENV === "production"));
  return response;
});
