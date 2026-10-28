/* eslint-disable @typescript-eslint/no-explicit-any -- test helper reads loosely typed JSON response bodies */
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPgSqlTag } from "../helpers/pg-sql";
import { hashPassword } from "@/lib/auth/password";
import { runMigrations } from "@/lib/db/migrations";
import type { SqlTag } from "@/lib/db/sql";
import { insertUser } from "@/lib/users/repository";
import { getLead } from "@/lib/leads/repository";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

// Route handlers read the database through getSql(). Point it at the test pool; everything else is real.
const holder = vi.hoisted(() => ({ sql: null as unknown as SqlTag }));
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getSql: () => holder.sql };
});

import { GET as healthGet } from "@/app/api/health/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { GET as leadsGet } from "@/app/api/leads/route";
import { GET as exportGet } from "@/app/api/leads/export/route";
import { GET as leadGet, PATCH as leadPatch } from "@/app/api/leads/[id]/route";
import { POST as researchPost } from "@/app/api/research/route";
import { POST as draftsPost, GET as draftsGet } from "@/app/api/outreach/drafts/route";
import { PATCH as draftPatch } from "@/app/api/outreach/drafts/[id]/route";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "https://app.test";
const PASSWORD = "integration password 123";

function request(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { ...init.headers };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = `${SESSION_COOKIE_NAME}=${init.cookie}`;
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function jsonBody(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

async function signIn(email: string, password = PASSWORD): Promise<string> {
  const response = await loginPost(request("/api/auth/login", { body: { email, password } }));
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  expect(cookie).toBeDefined();
  return cookie!.split(";")[0].slice(`${SESSION_COOKIE_NAME}=`.length);
}

describe.skipIf(!TEST_DATABASE_URL)("API routes against real Postgres", () => {
  let pool: Pool;
  let cookies: Record<"admin" | "researcher" | "marketing" | "viewer", string>;
  let ids: Record<"admin" | "researcher" | "marketing" | "viewer", string>;
  let verifiedLeadId: string;
  let discoveredLeadId: string;

  beforeAll(async () => {
    if (!/test/i.test(new URL(TEST_DATABASE_URL as string).pathname)) throw new Error("Test database name must contain 'test'.");
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    holder.sql = createPgSqlTag(pool);
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const client = await pool.connect();
    try {
      await runMigrations({ query: async (text: string, params?: unknown[]) => client.query(text, params) }, path.join(process.cwd(), "db", "migrations"));
    } finally {
      client.release();
    }

    const hash = await hashPassword(PASSWORD);
    ids = {
      admin: await insertUser(holder.sql, { email: "admin@api.example", displayName: "Admin User", passwordHash: hash, role: "admin" }),
      researcher: await insertUser(holder.sql, { email: "research@api.example", displayName: "Research User", passwordHash: hash, role: "researcher" }),
      marketing: await insertUser(holder.sql, { email: "marketing@api.example", displayName: "Marketing User", passwordHash: hash, role: "marketing" }),
      viewer: await insertUser(holder.sql, { email: "viewer@api.example", displayName: "Viewer User", passwordHash: hash, role: "viewer" }),
    };
    cookies = {
      admin: await signIn("admin@api.example"),
      researcher: await signIn("research@api.example"),
      marketing: await signIn("marketing@api.example"),
      viewer: await signIn("viewer@api.example"),
    };

    // Seed one real discovered lead through the research route, using the mock provider.
    const seed = await researchPost(
      request("/api/research", {
        body: { category: "spices", state: "Kerala", city: "Kochi", limit: 2 },
        cookie: cookies.researcher,
        headers: { "idempotency-key": "seed-job-0001" },
      }),
    );
    expect(seed.status).toBe(201);
    const leads = await leadsGet(request("/api/leads?state=Kerala&pageSize=100", { cookie: cookies.viewer }));
    const rows = (await jsonBody(leads)).items as { id: string; isSynthetic: boolean }[];
    discoveredLeadId = rows.find((row) => !row.isSynthetic)?.id ?? rows[0].id;

    // A verified, real lead is needed for drafts. Create one from a fixed directory listing.
    const { runResearchJob } = await import("@/lib/research/service");
    const job = await runResearchJob({
      sql: holder.sql,
      actorId: ids.researcher,
      input: { category: "handicrafts", state: "Kerala", city: "Kochi", limit: 1 },
      idempotencyKey: null,
      provider: {
        id: "google_places",
        mode: "real",
        search: async () => [
          {
            companyName: "Backwater Crafts Co",
            productCategory: "handicrafts",
            state: "Kerala",
            city: "Kochi",
            businessPhone: "+91 9123456780",
            sourceName: "Test directory",
            sourceUrl: "https://directory.example.in/crafts/backwater",
            evidenceSummary: "Integration evidence",
            collectedAt: new Date().toISOString(),
            verificationStatus: "unverified",
            isSynthetic: false,
            researchQuery: "api test",
          },
        ],
      },
    });
    expect(job.counts.inserted).toBe(1);
    const verifiable = await holder.sql<{ id: string }>`
      SELECT id FROM manufacturer_leads WHERE research_job_id = ${job.jobId}::uuid
    `;
    verifiedLeadId = verifiable[0].id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("reports health with a database check and no internal details", async () => {
    const response = await healthGet(request("/api/health", { method: "GET", origin: null }));
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ status: "ok", checks: { database: "ok" } });
  });

  it("refuses a wrong password with a generic message", async () => {
    const response = await loginPost(request("/api/auth/login", { body: { email: "admin@api.example", password: "wrong password 123" } }));
    expect(response.status).toBe(401);
    expect((await jsonBody(response)).error.message).toBe("Email or password is incorrect.");
  });

  it("protects lead data from anonymous access and sets an httpOnly session cookie on sign-in", async () => {
    expect((await leadsGet(request("/api/leads"))).status).toBe(401);
    const response = await loginPost(request("/api/auth/login", { body: { email: "viewer@api.example", password: PASSWORD } }));
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
  });

  it("lets a viewer read leads but not start research", async () => {
    expect((await leadsGet(request("/api/leads", { cookie: cookies.viewer }))).status).toBe(200);
    const denied = await researchPost(request("/api/research", { body: { category: "spices", state: "Kerala" }, cookie: cookies.viewer }));
    expect(denied.status).toBe(403);
  });

  it("refuses cross-site mutations even with a valid session", async () => {
    const response = await leadPatch(
      request(`/api/leads/${discoveredLeadId}`, { method: "PATCH", body: { action: "add_note", body: "hello" }, cookie: cookies.researcher, origin: "https://evil.example" }),
      { params: Promise.resolve({ id: discoveredLeadId }) },
    );
    expect(response.status).toBe(403);
  });

  it("validates research input and idempotency keys before any work is done", async () => {
    const tooMany = await researchPost(request("/api/research", { body: { category: "spices", state: "Kerala", limit: 21 }, cookie: cookies.researcher }));
    expect(tooMany.status).toBe(400);
    expect((await jsonBody(tooMany)).error.details[0].path).toBe("limit");

    const badKey = await researchPost(
      request("/api/research", { body: { category: "spices", state: "Kerala" }, cookie: cookies.researcher, headers: { "idempotency-key": "bad key!" } }),
    );
    expect(badKey.status).toBe(400);
  });

  it("returns the existing job for a repeated research request (idempotency over HTTP)", async () => {
    const first = await researchPost(
      request("/api/research", { body: { category: "footwear", state: "Kerala", limit: 1 }, cookie: cookies.researcher, headers: { "idempotency-key": "http-idem-0001" } }),
    );
    const again = await researchPost(
      request("/api/research", { body: { category: "footwear", state: "Kerala", limit: 1 }, cookie: cookies.researcher, headers: { "idempotency-key": "http-idem-0001" } }),
    );
    const firstBody = await jsonBody(first);
    const againBody = await jsonBody(again);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(againBody.job.reused).toBe(true);
    expect(againBody.job.jobId).toBe(firstBody.job.jobId);
  });

  it("rejects arbitrary field updates on a lead and accepts only allow-listed actions", async () => {
    const smuggled = await leadPatch(
      request(`/api/leads/${discoveredLeadId}`, {
        method: "PATCH",
        body: { action: "add_note", body: "a note", lead_status: "registered", verification_status: "verified" },
        cookie: cookies.researcher,
      }),
      { params: Promise.resolve({ id: discoveredLeadId }) },
    );
    expect(smuggled.status).toBe(400);

    const unknownAction = await leadPatch(
      request(`/api/leads/${discoveredLeadId}`, { method: "PATCH", body: { action: "set_anything" }, cookie: cookies.researcher }),
      { params: Promise.resolve({ id: discoveredLeadId }) },
    );
    expect(unknownAction.status).toBe(400);
  });

  it("refuses a manual 'registered' status and a contact without an evidence note", async () => {
    const registered = await leadPatch(
      request(`/api/leads/${discoveredLeadId}`, { method: "PATCH", body: { action: "change_status", status: "registered" }, cookie: cookies.researcher }),
      { params: Promise.resolve({ id: discoveredLeadId }) },
    );
    expect(registered.status).toBe(422);
    expect((await jsonBody(registered)).error.code).toBe("status_not_manual");

    const contacted = await leadPatch(
      request(`/api/leads/${discoveredLeadId}`, { method: "PATCH", body: { action: "change_status", status: "contacted" }, cookie: cookies.researcher }),
      { params: Promise.resolve({ id: discoveredLeadId }) },
    );
    expect(contacted.status).toBe(422);
  });

  it("lets a researcher record a status change with an evidence note, and writes it to history", async () => {
    const response = await leadPatch(
      request(`/api/leads/${discoveredLeadId}`, {
        method: "PATCH",
        body: { action: "change_status", status: "not_interested", note: "Owner said they are not interested." },
        cookie: cookies.researcher,
      }),
      { params: Promise.resolve({ id: discoveredLeadId }) },
    );
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).lead.leadStatus).toBe("not_interested");

    const detail = await leadGet(request(`/api/leads/${discoveredLeadId}`, { cookie: cookies.viewer }), { params: Promise.resolve({ id: discoveredLeadId }) });
    const body = await jsonBody(detail);
    expect(body.history.some((entry: { action: string }) => entry.action === "lead.status_changed")).toBe(true);
    expect(body.notes.some((note: { body: string }) => note.body.includes("not interested"))).toBe(true);
  });

  it("refuses verification by a role without verify permission, and rejects an incomplete checklist", async () => {
    const forbidden = await leadPatch(
      request(`/api/leads/${verifiedLeadId}`, {
        method: "PATCH",
        body: {
          action: "verify",
          sourceReviewed: true,
          businessIdentityConfirmed: true,
          manufacturingActivityConfirmed: true,
          evidenceSummary: "Opened the listing and matched the company details.",
        },
        cookie: cookies.marketing,
      }),
      { params: Promise.resolve({ id: verifiedLeadId }) },
    );
    expect(forbidden.status).toBe(403);

    const incomplete = await leadPatch(
      request(`/api/leads/${verifiedLeadId}`, {
        method: "PATCH",
        body: { action: "verify", sourceReviewed: true, businessIdentityConfirmed: true, evidenceSummary: "Short but present evidence." },
        cookie: cookies.researcher,
      }),
      { params: Promise.resolve({ id: verifiedLeadId }) },
    );
    expect(incomplete.status).toBe(400);
  });

  it("verifies a real lead with a complete checklist, and refuses to verify synthetic records", async () => {
    const verified = await leadPatch(
      request(`/api/leads/${verifiedLeadId}`, {
        method: "PATCH",
        body: {
          action: "verify",
          sourceReviewed: true,
          businessIdentityConfirmed: true,
          manufacturingActivityConfirmed: true,
          evidenceSummary: "Opened the listing, matched name and city, catalogue shows handicrafts.",
        },
        cookie: cookies.researcher,
      }),
      { params: Promise.resolve({ id: verifiedLeadId }) },
    );
    expect(verified.status).toBe(200);
    expect((await jsonBody(verified)).lead).toMatchObject({ verificationStatus: "verified", leadStatus: "verified" });

    const synthetic = await holder.sql<{ id: string }>`SELECT id FROM manufacturer_leads WHERE is_synthetic = true LIMIT 1`;
    const refused = await leadPatch(
      request(`/api/leads/${synthetic[0].id}`, {
        method: "PATCH",
        body: {
          action: "verify",
          sourceReviewed: true,
          businessIdentityConfirmed: true,
          manufacturingActivityConfirmed: true,
          evidenceSummary: "Trying to verify a synthetic record should fail.",
        },
        cookie: cookies.researcher,
      }),
      { params: Promise.resolve({ id: synthetic[0].id }) },
    );
    expect(refused.status).toBe(422);
    expect((await jsonBody(refused)).error.code).toBe("synthetic_record");
  });

  it("returns 404 for an unknown lead and 400 for a malformed lead id", async () => {
    const missing = await leadGet(request("/api/leads/00000000-0000-4000-8000-00000000ffff", { cookie: cookies.viewer }), {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-00000000ffff" }),
    });
    expect(missing.status).toBe(404);

    const malformed = await leadGet(request("/api/leads/not-a-uuid", { cookie: cookies.viewer }), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(malformed.status).toBe(400);
  });

  it("runs the draft approval flow: author submits, a different reviewer approves, and the lead advances", async () => {
    const created = await draftsPost(
      request("/api/outreach/drafts", { body: { leadId: verifiedLeadId, channel: "email", language: "ta", useAi: false }, cookie: cookies.marketing }),
    );
    expect(created.status).toBe(201);
    const createdBody = await jsonBody(created);
    const draftId = createdBody.draft.id as string;
    expect(createdBody.draft).toMatchObject({ approvalStatus: "draft", generationMode: "template", language: "ta" });

    const submitted = await draftPatch(request(`/api/outreach/drafts/${draftId}`, { method: "PATCH", body: { action: "submit" }, cookie: cookies.marketing }), {
      params: Promise.resolve({ id: draftId }),
    });
    expect(submitted.status).toBe(200);

    const selfApprove = await draftPatch(request(`/api/outreach/drafts/${draftId}`, { method: "PATCH", body: { action: "approve" }, cookie: cookies.marketing }), {
      params: Promise.resolve({ id: draftId }),
    });
    expect(selfApprove.status).toBe(403);

    const approved = await draftPatch(request(`/api/outreach/drafts/${draftId}`, { method: "PATCH", body: { action: "approve" }, cookie: cookies.admin }), {
      params: Promise.resolve({ id: draftId }),
    });
    expect(approved.status).toBe(200);
    expect((await jsonBody(approved)).draft.approvalStatus).toBe("approved");

    const lead = await getLead(holder.sql, verifiedLeadId);
    expect(lead?.leadStatus).toBe("outreach_approved");
  });

  it("forbids drafting for marketing reviewers, and drafts only appear to users with lead read access", async () => {
    const existing = await holder.sql<{ id: string }>`SELECT id FROM outreach_drafts WHERE approval_status = 'approved' LIMIT 1`;
    const draftId = existing[0].id;
    const reviewDenied = await draftPatch(request(`/api/outreach/drafts/${draftId}`, { method: "PATCH", body: { action: "approve" }, cookie: cookies.marketing }), {
      params: Promise.resolve({ id: draftId }),
    });
    expect(reviewDenied.status).toBe(403);

    const list = await draftsGet(request("/api/outreach/drafts?status=approved", { cookie: cookies.viewer }));
    expect(list.status).toBe(200);
    expect((await jsonBody(list)).items.length).toBeGreaterThan(0);
  });

  it("exports leads as CSV for export roles only, with formula-safe cells", async () => {
    const denied = await exportGet(request("/api/leads/export", { cookie: cookies.viewer }));
    expect(denied.status).toBe(403);

    const allowed = await exportGet(request("/api/leads/export?state=Kerala", { cookie: cookies.researcher }));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-type")).toContain("text/csv");
    expect(allowed.headers.get("content-disposition")).toContain("attachment");
    const csv = await allowed.text();
    expect(csv.split("\r\n")[0]).toContain("Company");
    expect(csv).toContain("Backwater Crafts Co");
    expect(csv).toContain("'+919123456780");
  });

  it("signs out and invalidates the session server-side", async () => {
    const before = await leadsGet(request("/api/leads", { cookie: cookies.marketing }));
    expect(before.status).toBe(200);

    const out = await logoutPost(request("/api/auth/logout", { body: {}, cookie: cookies.marketing }));
    expect(out.status).toBe(200);

    const after = await leadsGet(request("/api/leads", { cookie: cookies.marketing }));
    expect(after.status).toBe(401);
  });

  it("uses the same error envelope for every failure, with a request ID", async () => {
    const response = await leadsGet(request("/api/leads?sort=password_hash", { cookie: cookies.viewer }));
    expect(response.status).toBe(400);
    const body = await jsonBody(response);
    expect(body.error).toMatchObject({ code: "validation_error" });
    expect(typeof body.error.requestId).toBe("string");
    expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
  });
});
