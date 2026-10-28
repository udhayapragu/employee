export const ROLES = ["super_admin", "admin", "researcher", "marketing", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "overview:view",
  "research:run",
  "research:view",
  "lead:read",
  "lead:update",
  "lead:verify",
  "lead:export",
  "draft:create",
  "draft:review",
  "settings:view",
  "users:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ADMIN_PERMISSIONS: Permission[] = PERMISSIONS.filter((permission) => permission !== "users:manage");

/**
 * Explicit role matrix. Authorization is enforced on the server for every protected operation.
 * Draft review is limited to admins; the author of a draft can never approve it (see outreach/approval.ts).
 */
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set<Permission>(PERMISSIONS),
  admin: new Set<Permission>(ADMIN_PERMISSIONS),
  researcher: new Set<Permission>([
    "overview:view",
    "research:run",
    "research:view",
    "lead:read",
    "lead:update",
    "lead:verify",
    "lead:export",
  ]),
  marketing: new Set<Permission>(["overview:view", "research:view", "lead:read", "lead:export", "draft:create"]),
  viewer: new Set<Permission>(["overview:view", "research:view", "lead:read"]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(role, permission));
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  researcher: "Researcher",
  marketing: "Marketing",
  viewer: "Viewer",
};
