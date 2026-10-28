import type { Metadata } from "next";
import { Badge, Card, CardTitle, ModeBadge, Notice, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/access";
import { hasPermission, permissionsFor, ROLE_LABELS } from "@/lib/auth/permissions";
import { getEnv } from "@/lib/config/env";
import { getSql } from "@/lib/db/client";
import { listIntegrations } from "@/lib/integrations/repository";
import { resolveResearchAvailability } from "@/lib/research/registry";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Settings" };

/** Describes each integration from server configuration as a status word. Values are never returned or displayed. */
function integrationStatus(key: string, env: ReturnType<typeof getEnv>): { label: string; tone: "success" | "warning" | "neutral" | "brand" } {
  switch (key) {
    case "mock_research":
      return env.RESEARCH_PROVIDER === "mock" ? { label: "Active", tone: "brand" } : { label: "Not selected", tone: "neutral" };
    case "google_places":
      if (env.RESEARCH_PROVIDER !== "google_places") return { label: "Not selected", tone: "neutral" };
      return env.GOOGLE_PLACES_API_KEY ? { label: "Configured", tone: "success" } : { label: "Key missing", tone: "warning" };
    case "anthropic":
      if (env.AI_PROVIDER !== "anthropic") return { label: "Not selected", tone: "neutral" };
      return env.ANTHROPIC_API_KEY ? { label: "Configured", tone: "success" } : { label: "Key missing", tone: "warning" };
    default:
      return { label: "Not implemented", tone: "neutral" };
  }
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const env = getEnv();
  const availability = resolveResearchAvailability(env);
  const canViewIntegrations = hasPermission(user.role, "settings:view");
  const integrations = canViewIntegrations ? await listIntegrations(getSql()) : [];

  return (
    <>
      <PageHeader eyebrow="Settings" title="Settings and access" description="Account, research mode and integration status. Secret values are never shown here." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Your account</CardTitle>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted">Name</dt>
              <dd className="text-text">{user.displayName}</dd>
            </div>
            <div>
              <dt className="text-muted">Email</dt>
              <dd className="break-all text-text">{user.email}</dd>
            </div>
            <div>
              <dt className="text-muted">Role</dt>
              <dd className="text-text">{ROLE_LABELS[user.role]}</dd>
            </div>
          </dl>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Permissions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {permissionsFor(user.role).map((permission) => (
              <Badge key={permission}>{permission}</Badge>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Research mode</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <ModeBadge mode={availability.available ? availability.mode : availability.mode === "disabled" ? "disabled" : "unavailable"} />
          </div>
          <p className="mt-3 text-sm text-muted">{availability.message}</p>
          <div className="mt-5 space-y-3 text-sm text-muted">
            <p>
              <span className="font-medium text-text">Mock mode</span> (RESEARCH_PROVIDER=mock) generates clearly labelled synthetic records for testing. It is the default.
            </p>
            <p>
              <span className="font-medium text-text">Google Places</span> needs RESEARCH_PROVIDER=google_places and GOOGLE_PLACES_API_KEY in the server environment. Billing must be enabled on the Google Cloud project. Google Maps Platform terms restrict how long Places content may be stored, so review them before production use.
            </p>
            <p>If the configured provider fails, the job is marked failed. The system never substitutes mock data.</p>
          </div>
        </Card>

        {canViewIntegrations ? (
          <Card className="lg:col-span-2">
            <CardTitle>Integrations</CardTitle>
            <ul className="divide-y divide-line">
              {integrations.map((integration) => {
                const status = integrationStatus(integration.key, env);
                return (
                  <li key={integration.key} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-text">{integration.displayName}</p>
                      <p className="mt-1 text-sm text-muted">{integration.description}</p>
                    </div>
                    <div className="shrink-0">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6">
              <Notice tone="gold" title="Not implemented: messaging and email">
                WhatsApp and email sending are not connected. Connecting them needs official provider onboarding, approved templates or domain authentication, and recorded opt-ins. No unofficial automation is used.
              </Notice>
            </div>
          </Card>
        ) : (
          <Card className="lg:col-span-2">
            <CardTitle>Integrations</CardTitle>
            <p className="text-sm text-muted">Integration status is visible to administrators.</p>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <CardTitle>Initial setup and access</CardTitle>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
            <li>Run database migrations with npm run db:migrate after setting DATABASE_URL on the server.</li>
            <li>Create the first super administrator with npm run admin:create, using ADMIN_EMAIL and ADMIN_PASSWORD from the environment. Remove the password from the environment afterwards.</li>
            <li>User accounts are created from the command line in this version. There is no self-service sign-up.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
