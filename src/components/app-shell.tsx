import type { ReactNode } from "react";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { ModeBadge } from "./ui";
import { NavLinks, type NavItem } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

export interface ShellUser {
  displayName: string;
  email: string;
  role: Role;
}

export function AppShell({
  user,
  children,
  researchMode,
  researchMessage,
  navItems,
}: {
  user: ShellUser;
  children: ReactNode;
  researchMode: "mock" | "real" | "disabled" | "unavailable";
  researchMessage: string;
  navItems: NavItem[];
}) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[17rem_1fr]">
      <aside className="border-b border-line bg-panel/80 px-4 py-4 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r md:px-5 md:py-6">
        <div className="flex items-center justify-between gap-3 md:block">
          <div>
            <p className="text-lg font-semibold text-text">
              Bulkskart <span className="text-gold">AI</span>
            </p>
            <p className="text-xs text-muted">Manufacturer research and outreach</p>
          </div>
        </div>
        <div className="mt-4 md:mt-6">
          <NavLinks items={navItems} />
        </div>
        <div className="mt-6 hidden rounded-xl border border-line bg-ink/60 p-3 md:block">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Research mode</p>
          <div className="mt-2">
            <ModeBadge mode={researchMode} />
          </div>
          <p className="mt-2 text-xs text-muted">{researchMessage}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-ink/80 px-4 py-3 backdrop-blur sm:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <ModeBadge mode={researchMode} />
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-text">{user.displayName}</p>
              <p className="text-xs text-muted">
                {ROLE_LABELS[user.role]} · {user.email}
              </p>
            </div>
            <SignOutButton />
          </div>
        </header>
        <main id="main" className="w-full max-w-7xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
