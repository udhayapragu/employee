import type { SqlTag } from "@/lib/db/sql";
import { findUserByEmail } from "@/lib/users/repository";
import { hashPassword, verifyPassword } from "./password";
import type { SessionUser } from "./session";

let timingPlaceholder: Promise<string> | null = null;

/** A real scrypt hash computed once, so unknown emails cost the same time as known ones. */
function placeholderHash(): Promise<string> {
  timingPlaceholder ??= hashPassword("placeholder-password-for-timing-only");
  return timingPlaceholder;
}

/**
 * Checks credentials. Returns the user, or null for any failure, so the response never reveals whether
 * the email exists. Inactive accounts cannot sign in.
 */
export async function authenticate(sql: SqlTag, email: string, password: string): Promise<SessionUser | null> {
  const user = await findUserByEmail(sql, email);
  const hash = user?.passwordHash ?? (await placeholderHash());
  const passwordMatches = await verifyPassword(password, hash);

  if (!user || !user.isActive || !passwordMatches) return null;
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}
