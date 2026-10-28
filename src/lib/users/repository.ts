import type { SqlTag } from "@/lib/db/sql";
import { toIsoOrNull } from "@/lib/db/rows";
import { isRole, type Role } from "@/lib/auth/permissions";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  passwordHash: string;
  createdAt: string | null;
}

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  password_hash: string;
  created_at: unknown;
};

function mapUser(row: UserRow): UserRecord | null {
  if (!isRole(row.role)) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    passwordHash: row.password_hash,
    createdAt: toIsoOrNull(row.created_at),
  };
}

export async function findUserByEmail(sql: SqlTag, email: string): Promise<UserRecord | null> {
  const rows = await sql<UserRow>`
    SELECT id, email, display_name, role, is_active, password_hash, created_at
    FROM users
    WHERE email = ${email.toLowerCase()}
    LIMIT 1
  `;
  return rows[0] ? mapUser(rows[0]) : null;
}

/** Used for assignment checks. Returns only the fields needed to validate the assignee. */
export async function findAssignableUser(sql: SqlTag, userId: string): Promise<{ id: string; role: Role } | null> {
  const rows = await sql<{ id: string; role: string }>`
    SELECT id, role FROM users
    WHERE id = ${userId}::uuid AND is_active = true AND role <> 'viewer'
    LIMIT 1
  `;
  const row = rows[0];
  return row && isRole(row.role) ? { id: row.id, role: row.role } : null;
}

export async function countSuperAdmins(sql: SqlTag): Promise<number> {
  const rows = await sql<{ n: number }>`SELECT count(*)::int AS n FROM users WHERE role = 'super_admin'`;
  return rows[0]?.n ?? 0;
}

export async function insertUser(
  sql: SqlTag,
  input: { email: string; displayName: string; passwordHash: string; role: Role },
): Promise<string> {
  const rows = await sql<{ id: string }>`
    INSERT INTO users (email, display_name, password_hash, role)
    VALUES (${input.email.toLowerCase()}, ${input.displayName}, ${input.passwordHash}, ${input.role})
    RETURNING id
  `;
  return rows[0].id;
}

/** Active team members who can own leads, for the assignment control. */
export async function listAssignableUsers(sql: SqlTag): Promise<{ id: string; displayName: string }[]> {
  const rows = await sql<{ id: string; display_name: string }>`
    SELECT id, display_name FROM users
    WHERE is_active = true AND role <> 'viewer'
    ORDER BY display_name ASC
    LIMIT 200
  `;
  return rows.map((row) => ({ id: row.id, displayName: row.display_name }));
}

export async function countUsers(sql: SqlTag): Promise<number> {
  const rows = await sql<{ n: number }>`SELECT count(*)::int AS n FROM users`;
  return rows[0]?.n ?? 0;
}
