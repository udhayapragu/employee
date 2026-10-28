import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { SetupRequired } from "@/components/setup-required";
import { Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/access";
import { DatabaseNotConfiguredError } from "@/lib/db/client";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  try {
    const user = await getCurrentUser();
    if (user) redirect("/");
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

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-2xl font-semibold text-text">
            Bulkskart <span className="text-gold">AI</span>
          </p>
          <p className="mt-2 text-sm text-muted">Sign in to manage research, leads and outreach approvals.</p>
        </div>
        <Card>
          <LoginForm />
        </Card>
        <p className="mt-6 text-center text-xs text-muted">Access is by invitation. Contact an administrator if you need an account.</p>
      </div>
    </main>
  );
}
