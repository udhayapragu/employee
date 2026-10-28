import path from "node:path";
import { Pool } from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPgSqlTag } from "../helpers/pg-sql";
import { hashPassword } from "@/lib/auth/password";
import type { SessionUser } from "@/lib/auth/session";
import { runMigrations } from "@/lib/db/migrations";
import type { SqlTag } from "@/lib/db/sql";
import { insertUser } from "@/lib/users/repository";
import { runResearchJob } from "@/lib/research/service";
import { mockResearchProvider } from "@/lib/research/providers/mock";

// Pages read the signed-in user through getCurrentUser(). Tests choose the role; data comes from Postgres.
const state = vi.hoisted(() => ({ sql: null as unknown as SqlTag, user: null as SessionUser | null }));

vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getSql: () => state.sql };
});
vi.mock("@/lib/auth/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/access")>();
  return { ...actual, getCurrentUser: async () => state.user };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/",
}));

import OverviewPage from "@/app/(dashboard)/page";
import LeadsPage from "@/app/(dashboard)/leads/page";
import LeadDetailPage from "@/app/(dashboard)/leads/[id]/page";
import OutreachPage from "@/app/(dashboard)/outreach/page";
import ResearchJobsPage from "@/app/(dashboard)/research/jobs/page";
import SettingsPage from "@/app/(dashboard)/settings/page";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("dashboard pages render from real data", () => {
  let pool: Pool;
  let leadId: string;
  let users: Record<string, SessionUser>;

  beforeAll(async () => {
    if (!/test/i.test(new URL(TEST_DATABASE_URL as string).pathname)) throw new Error("Test database name must contain 'test'.");
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    state.sql = createPgSqlTag(pool);
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const client = await pool.connect();
    try {
      await runMigrations({ query: async (text: string, params?: unknown[]) => client.query(text, params) }, path.join(process.cwd(), "db", "migrations"));
    } finally {
      client.release();
    }

    const hash = await hashPassword("integration password 123");
    const ids = {
      admin: await insertUser(state.sql, { email: "admin@pages.example", displayName: "Page Admin", passwordHash: hash, role: "admin" }),
      viewer: await insertUser(state.sql, { email: "viewer@pages.example", displayName: "Page Viewer", passwordHash: hash, role: "viewer" }),
    };
    users = {
      admin: { id: ids.admin, email: "admin@pages.example", displayName: "Page Admin", role: "admin" },
      viewer: { id: ids.viewer, email: "viewer@pages.example", displayName: "Page Viewer", role: "viewer" },
    };

    const job = await runResearchJob({
      sql: state.sql,
      provider: mockResearchProvider,
      actorId: ids.admin,
      input: { category: "packaging", state: "Gujarat", city: "Surat", limit: 2 },
      idempotencyKey: null,
    });
    expect(job.status).toBe("completed");
    const rows = await state.sql<{ id: string }>`SELECT id FROM manufacturer_leads WHERE research_job_id = ${job.jobId}::uuid ORDER BY company_name LIMIT 1`;
    leadId = rows[0].id;
  });

  afterAll(async () => {
    state.user = null;
    await pool?.end();
  });

  it("renders the overview with real counts and the synthetic-record notice", async () => {
    state.user = users.viewer;
    const html = renderToStaticMarkup(await OverviewPage());
    expect(html).toContain("Pipeline at a glance");
    expect(html).toContain("Synthetic test records are present");
  });

  it("renders the lead list, and the research history", async () => {
    state.user = users.viewer;
    const leads = renderToStaticMarkup(await LeadsPage({ searchParams: Promise.resolve({ state: "Gujarat" }) }));
    expect(leads).toContain("[SYNTHETIC] Packaging Materials Demo Unit 01");
    expect(leads).not.toContain("Export CSV");

    const history = renderToStaticMarkup(await ResearchJobsPage({ searchParams: Promise.resolve({}) }));
    expect(history).toContain("Research history");
    expect(history).toContain("Mock data");
  });

  it("shows an invalid filter as a message, not a crash", async () => {
    state.user = users.viewer;
    const html = renderToStaticMarkup(await LeadsPage({ searchParams: Promise.resolve({ state: "Atlantis" }) }));
    expect(html).toContain("Some filters are not valid");
  });

  it("hides write controls from a viewer on the lead detail page, and shows the synthetic notice", async () => {
    state.user = users.viewer;
    const html = renderToStaticMarkup(await LeadDetailPage({ params: Promise.resolve({ id: leadId }) }));
    expect(html).toContain("Synthetic test record");
    expect(html).toContain("History");
    expect(html).not.toContain("Record verification");
    expect(html).not.toContain("Update status");
  });

  it("shows the admin write controls and the approval queue", async () => {
    state.user = users.admin;
    const detail = renderToStaticMarkup(await LeadDetailPage({ params: Promise.resolve({ id: leadId }) }));
    expect(detail).toContain("Update status");
    expect(detail).toContain("Add note");

    const queue = renderToStaticMarkup(await OutreachPage({ searchParams: Promise.resolve({}) }));
    expect(queue).toContain("Outreach drafts");
    expect(queue).toContain("Sending is not available");
  });

  it("shows settings without any secret values, and marks integrations as not implemented where applicable", async () => {
    state.user = users.admin;
    const html = renderToStaticMarkup(await SettingsPage());
    expect(html).toContain("Research mode");
    expect(html).toContain("Not implemented");
    expect(html).not.toMatch(/sk-ant-|AIza[0-9A-Za-z_-]{20,}|postgres:\/\//);
  });
});
