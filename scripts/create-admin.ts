import { z } from "zod";
import { insertAuditLog } from "../src/lib/audit/log";
import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";
import { createNeonSql } from "../src/lib/db/sql";
import { countSuperAdmins, insertUser } from "../src/lib/users/repository";

/**
 * Creates the first super administrator. It refuses to run if one already exists, so it cannot be used
 * to add privileged accounts silently. Credentials come from the environment and are never printed.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const email = z.email().max(254).safeParse(process.env.ADMIN_EMAIL?.trim().toLowerCase());
  if (!email.success) throw new Error("Set ADMIN_EMAIL to a valid email address.");

  const password = process.env.ADMIN_PASSWORD ?? "";
  const passwordProblem = validatePasswordStrength(password);
  if (passwordProblem) throw new Error(`ADMIN_PASSWORD is not acceptable: ${passwordProblem}`);

  const sql = createNeonSql(url);
  if ((await countSuperAdmins(sql)) > 0) {
    throw new Error("A super administrator already exists. This script will not create another.");
  }

  const id = await insertUser(sql, {
    email: email.data,
    displayName: "Super Administrator",
    passwordHash: await hashPassword(password),
    role: "super_admin",
  });
  await insertAuditLog(sql, { actorId: id, action: "user.bootstrap_super_admin", entityType: "user", entityId: id });

  console.log("Super administrator created. Remove ADMIN_PASSWORD from the environment now.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Could not create the administrator.");
  process.exit(1);
});
