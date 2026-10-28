import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/auth/login";
import { createSession, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session";
import { insertAuditLog } from "@/lib/audit/log";
import { getEnv } from "@/lib/config/env";
import { getSql } from "@/lib/db/client";
import { ApiError, parseJsonBody, withApi } from "@/lib/http/api";
import { logEvent } from "@/lib/log/logger";
import { clientAddress, loginLimiter } from "@/lib/security/limits";
import { assertSameOrigin } from "@/lib/security/origin";

const loginSchema = z
  .object({
    email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
    password: z.string().min(1).max(256),
  })
  .strict();

export const POST = withApi(async (request, { requestId }) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, loginSchema);

  const byEmail = loginLimiter.check(`email:${body.email}`);
  const byAddress = loginLimiter.check(`ip:${clientAddress(request)}`);
  if (!byEmail.allowed || !byAddress.allowed) {
    throw new ApiError(429, "rate_limited", "Too many sign-in attempts. Wait a few minutes and try again.");
  }

  const sql = getSql();
  const user = await authenticate(sql, body.email, body.password);
  if (!user) {
    await insertAuditLog(sql, { actorId: null, action: "auth.login_failed", entityType: "user", entityId: null });
    logEvent("warn", "auth.login_failed", { requestId });
    throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
  }

  const env = getEnv();
  const { token, expiresAt } = await createSession(sql, user.id, env.SESSION_TTL_HOURS);
  await insertAuditLog(sql, { actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id });

  const response = NextResponse.json(
    { user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } },
    { status: 200, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    sessionCookieOptions(expiresAt, process.env.NODE_ENV === "production"),
  );
  return response;
});
