import { cookies } from "next/headers";
import { ApiError } from "@/lib/http/api";
import { getSql } from "@/lib/db/client";
import { hasPermission, type Permission } from "./permissions";
import { findSessionUser, SESSION_COOKIE_NAME, type SessionUser } from "./session";

/** Reads one cookie value from a raw Cookie header. */
export function readCookieFromHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return rest.join("=") || null;
  }
  return null;
}

/** Server components and layouts: resolves the signed-in user from the request cookies. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!token) return null;
  return findSessionUser(getSql(), token);
}

/** Route handlers: resolves the signed-in user from the request's Cookie header. */
export async function getUserFromRequest(request: Request): Promise<SessionUser | null> {
  const token = readCookieFromHeader(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (!token) return null;
  return findSessionUser(getSql(), token);
}

/**
 * Requires an authenticated user and, when given, a permission. Throws ApiError 401 or 403.
 * Every protected API route calls this itself; the UI hiding a control is never a security control.
 */
export async function requireApiUser(request: Request, permission?: Permission): Promise<SessionUser> {
  const user = await getUserFromRequest(request);
  if (!user) {
    throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  }
  if (permission && !hasPermission(user.role, permission)) {
    throw new ApiError(403, "forbidden", "Your role does not allow this action.");
  }
  return user;
}
