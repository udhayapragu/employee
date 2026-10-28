import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell, type ShellUser } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-links";
import { SetupRequired } from "@/components/setup-required";
import { getCurrentUser } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { getEnv } from "@/lib/config/env";
import { DatabaseNotConfiguredError } from "@/lib/db/client";
import { resolveResearchAvailability } from "@/lib/research/registry";

/** Every dashboard page is protected here and again inside each data read. This layout is not the only check. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      return (
        <main className="grid min-h-screen place-items-center px-4 py-12">
          <SetupRequired />
        </main>
      );
    }
    throw error;
  }
  if (!user) redirect("/login");

  const availability = resolveResearchAvailability(getEnv());
  const navItems: NavItem[] = [{ href: "/", label: "Overview" }];
  if (hasPermission(user.role, "research:view")) navItems.push({ href: "/research", label: "Manufacturer research" });
  if (hasPermission(user.role, "lead:read")) {
    navItems.push({ href: "/leads", label: "Leads" }, { href: "/outreach", label: "Outreach drafts" });
  }
  navItems.push({ href: "/settings", label: "Settings" });

  const shellUser: ShellUser = { displayName: user.displayName, email: user.email, role: user.role };
  return (
    <AppShell
      user={shellUser}
      researchMode={availability.available ? availability.mode : availability.mode === "disabled" ? "disabled" : "unavailable"}
      researchMessage={availability.message}
      navItems={navItems}
    >
      {children}
    </AppShell>
  );
}
