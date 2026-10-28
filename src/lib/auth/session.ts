import { createHash, randomBytes } from "node:crypto";
import type { SqlTag } from "@/lib/db/sql";
import { isRole, type Role } from "./permissions";

export const SESSION_COOKIE_NAME = "bs_session";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only a hash of the session token is stored, so a database read cannot be replayed as a cookie. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  sql: SqlTag,
  userId: string,
  ttlHours: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await sql`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}::uuid, ${hashSessionToken(token)}, ${expiresAt.toISOString()}::timestamptz)
  `;
  return { token, expiresAt };
}

export async function findSessionUser(sql: SqlTag, token: string | null | undefined): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 200) return null;

  const rows = await sql<{ id: string; email: string; display_name: string; role: string }>`
    SELECT u.id, u.email, u.display_name, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashSessionToken(token)}
      AND s.expires_at > now()
      AND u.is_active = true
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || !isRole(row.role)) return null;

  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}

export async function deleteSession(sql: SqlTag, token: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE token_hash = ${hashSessionToken(token)}`;
}

export function sessionCookieOptions(expiresAt: Date, secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
