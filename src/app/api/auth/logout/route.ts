import { NextResponse } from "next/server";
import { insertAuditLog } from "@/lib/audit/log";
import { getUserFromRequest, readCookieFromHeader } from "@/lib/auth/access";
import { deleteSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getSql } from "@/lib/db/client";
import { withApi } from "@/lib/http/api";
import { assertSameOrigin } from "@/lib/security/origin";

export const POST = withApi(async (request, { requestId }) => {
  assertSameOrigin(request);
  const sql = getSql();
  const user = await getUserFromRequest(request);
  const token = readCookieFromHeader(request.headers.get("cookie"), SESSION_COOKIE_NAME);

  if (token) await deleteSession(sql, token);
  if (user) {
    await insertAuditLog(sql, { actorId: user.id, action: "auth.logout", entityType: "user", entityId: user.id });
  }

  const response = NextResponse.json(
    { ok: true },
    { status: 200, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
});
