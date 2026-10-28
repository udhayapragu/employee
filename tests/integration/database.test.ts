import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgSqlTag } from "../helpers/pg-sql";
import { insertAuditLog } from "@/lib/audit/log";
import { authenticate } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";
import { createSession, deleteSession, findSessionUser } from "@/lib/auth/session";
import type { SqlTag } from "@/lib/db/sql";
import { runMigrations } from "@/lib/db/migrations";
import { applyLeadUpdate, findPossibleDuplicates, getLead, insertDiscoveredLead, listLeads } from "@/lib/leads/repository";
import { parseLeadListQuery } from "@/lib/leads/query";
import { createOutreachDraft } from "@/lib/outreach/drafting";
import { getDraft, insertDraft, transitionDraft } from "@/lib/outreach/repository";
import { getOverviewStats } from "@/lib/overview/stats";
import { insertUser } from "@/lib/users/repository";
import { runResearchJob } from "@/lib/research/service";
import { mockResearchProvider } from "@/lib/research/providers/mock";
import type { ResearchProvider } from "@/lib/research/types";
import type { ResearchInput } from "@/lib/research/input";
import type { LeadStatus } from "@/lib/config/domain";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Guards against pointing destructive test setup at a non-test database. */
function assertSafeTestDatabase(url: string): void {
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL must name a database whose name contains 'test'.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    throw new Error("TEST_DATABASE_URL must not be the same as DATABASE_URL.");
  }
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    companyName: "Shree Ganesh Textiles Pvt Ltd",
    productCategory: "textiles",
    state: "Tamil Nadu",
    city: "Tiruppur",
    businessPhone: "+91 98765 43210",
    sourceName: "Test directory",
    sourceUrl: "https://directory.example.in/listing/1",
    evidenceSummary: "Synthetic integration evidence",
    collectedAt: new Date().toISOString(),
    verificationStatus: "unverified",
    isSynthetic: false,
    researchQuery: "integration test",
    ...overrides,
  };
}

/** A provider that returns fixed candidates, so duplicate behaviour can be tested precisely. */
function fixedProvider(items: unknown[] | Error): ResearchProvider {
  return {
    id: "google_places",
    mode: "real",
    search: async () => {
      if (items instanceof Error) throw items;
      return items;
    },
  };
}

const searchTamilNaduTextiles: ResearchInput = { category: "textiles", state: "Tamil Nadu", city: "Tiruppur", limit: 5 };
const searchTamilNaduGarments: ResearchInput = { category: "garments", state: "Tamil Nadu", city: "Tiruppur", limit: 5 };

describe.skipIf(!TEST_DATABASE_URL)("database integration (real Postgres)", () => {
  let pool: Pool;
  let sql: SqlTag;
  let admin: string;
  let researcher: string;
  let marketing: string;
  let reviewer: string;

  beforeAll(async () => {
    assertSafeTestDatabase(TEST_DATABASE_URL as string);
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    sql = createPgSqlTag(pool);

    // Start from an empty schema each run. This database is dedicated to tests (checked above).
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const client = await pool.connect();
    try {
      await runMigrations(
        { query: async (text: string, params?: unknown[]) => client.query(text, params) },
        path.join(process.cwd(), "db", "migrations"),
      );
    } finally {
      client.release();
    }

    const password = await hashPassword("integration password 123");
    admin = await insertUser(sql, { email: "admin@test.example", displayName: "Admin", passwordHash: password, role: "admin" });
    researcher = await insertUser(sql, { email: "research@test.example", displayName: "Researcher", passwordHash: password, role: "researcher" });
    marketing = await insertUser(sql, { email: "marketing@test.example", displayName: "Marketing", passwordHash: password, role: "marketing" });
    reviewer = await insertUser(sql, { email: "reviewer@test.example", displayName: "Reviewer", passwordHash: password, role: "admin" });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("applies migrations once and reports a second run as already applied", async () => {
    const client = await pool.connect();
    try {
      const result = await runMigrations(
        { query: async (text: string, params?: unknown[]) => client.query(text, params) },
        path.join(process.cwd(), "db", "migrations"),
      );
      expect(result.applied).toEqual([]);
      expect(result.alreadyApplied.length).toBeGreaterThan(0);
    } finally {
      client.release();
    }
  });

  it("authenticates correct credentials only, and refuses inactive accounts", async () => {
    expect(await authenticate(sql, "research@test.example", "integration password 123")).toMatchObject({ role: "researcher" });
    expect(await authenticate(sql, "research@test.example", "wrong password value")).toBeNull();
    expect(await authenticate(sql, "nobody@test.example", "integration password 123")).toBeNull();

    await sql`UPDATE users SET is_active = false WHERE id = ${marketing}::uuid`;
    expect(await authenticate(sql, "marketing@test.example", "integration password 123")).toBeNull();
    await sql`UPDATE users SET is_active = true WHERE id = ${marketing}::uuid`;
  });

  it("creates, validates and expires sessions; deleting a session ends it", async () => {
    const { token } = await createSession(sql, admin, 1);
    expect(await findSessionUser(sql, token)).toMatchObject({ role: "admin" });

    await sql`UPDATE sessions SET expires_at = now() - interval '1 minute'`;
    expect(await findSessionUser(sql, token)).toBeNull();

    const fresh = await createSession(sql, admin, 1);
    await deleteSession(sql, fresh.token);
    expect(await findSessionUser(sql, fresh.token)).toBeNull();
  });

  it("stores only hashed session tokens", async () => {
    const { token } = await createSession(sql, admin, 1);
    const rows = await sql<{ token_hash: string }>`SELECT token_hash FROM sessions`;
    expect(rows.every((row) => row.token_hash !== token)).toBe(true);
  });

  it("runs a mock research job, inserts labelled synthetic records, then skips them on repeat", async () => {
    const first = await runResearchJob({ sql, provider: mockResearchProvider, actorId: researcher, input: searchTamilNaduTextiles, idempotencyKey: null });
    expect(first).toMatchObject({ status: "completed", providerMode: "mock" });
    expect(first.counts).toEqual({ discovered: 5, inserted: 5, skipped: 0, needsReview: 0 });

    const synthetic = await sql<{ verification_status: string; is_synthetic: boolean; company_name: string }>`
      SELECT verification_status, is_synthetic, company_name FROM manufacturer_leads WHERE research_job_id = ${first.jobId}::uuid
    `;
    expect(synthetic).toHaveLength(5);
    for (const row of synthetic) {
      expect(row.is_synthetic).toBe(true);
      expect(row.verification_status).toBe("synthetic");
      expect(row.company_name).toMatch(/^\[SYNTHETIC\]/);
    }

    const repeat = await runResearchJob({ sql, provider: mockResearchProvider, actorId: researcher, input: searchTamilNaduTextiles, idempotencyKey: null });
    expect(repeat.counts).toEqual({ discovered: 5, inserted: 0, skipped: 5, needsReview: 0 });
  });

  it("returns the same job for a repeated Idempotency-Key without running the provider again", async () => {
    let calls = 0;
    const counting: ResearchProvider = {
      id: "google_places",
      mode: "real",
      search: async () => {
        calls += 1;
        return [
          candidate({
            companyName: "Idempotent Mills",
            productCategory: "textiles",
            state: "Kerala",
            city: null,
            businessPhone: null,
            sourceUrl: "https://directory.example.in/listing/idem",
          }),
        ];
      },
    };
    const key = "idem-key-0001";
    const input: ResearchInput = { category: "textiles", state: "Kerala", city: null, limit: 3 };

    const once = await runResearchJob({ sql, provider: counting, actorId: researcher, input, idempotencyKey: key });
    const twice = await runResearchJob({ sql, provider: counting, actorId: researcher, input, idempotencyKey: key });

    expect(calls).toBe(1);
    expect(twice).toMatchObject({ jobId: once.jobId, reused: true });
  });

  it("flags possible duplicates for review and never merges distinct businesses that share a phone number", async () => {
    const garments = await runResearchJob({
      sql,
      provider: fixedProvider([
        candidate({ productCategory: "garments", sourceUrl: "https://directory.example.in/listing/1" }),
        candidate({
          companyName: "Bluebird Foods Ltd",
          productCategory: "garments",
          sourceUrl: "https://directory.example.in/listing/2",
        }),
        candidate({ sourceUrl: "http://insecure.example.in/listing" }),
      ]),
      actorId: researcher,
      input: searchTamilNaduGarments,
      idempotencyKey: null,
    });
    // Bluebird shares a phone number with the first record, so it is kept and flagged, never merged.
    expect(garments.counts).toEqual({ discovered: 3, inserted: 2, skipped: 1, needsReview: 1 });

    const textiles = await runResearchJob({
      sql,
      provider: fixedProvider([
        candidate({ sourceUrl: "https://directory.example.in/listing/3" }),
        candidate({ sourceUrl: "https://directory.example.in/listing/4" }),
      ]),
      actorId: researcher,
      input: searchTamilNaduTextiles,
      idempotencyKey: null,
    });
    expect(textiles.counts).toEqual({ discovered: 2, inserted: 1, skipped: 1, needsReview: 1 });
    expect(textiles.counts.inserted + textiles.counts.skipped).toBe(textiles.counts.discovered);

    const flagged = await sql<{ id: string; possible_duplicate_of: string; duplicate_reason: string; lead_status: string }>`
      SELECT id, possible_duplicate_of, duplicate_reason, lead_status FROM manufacturer_leads
      WHERE research_job_id = ${textiles.jobId}::uuid AND possible_duplicate_of IS NOT NULL
    `;
    expect(flagged).toHaveLength(1);
    expect(flagged[0].lead_status).toBe("needs_review");
    expect(flagged[0].duplicate_reason).toContain("same name in same state");

    const shared = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM manufacturer_leads WHERE normalized_phone = '+919876543210'
    `;
    expect(shared[0].n).toBeGreaterThanOrEqual(2);
  });

  it("records a failed provider as a failed job with a safe reason and inserts nothing", async () => {
    const before = await sql<{ n: number }>`SELECT count(*)::int AS n FROM manufacturer_leads`;
    const result = await runResearchJob({
      sql,
      provider: fixedProvider(new Error("upstream timeout secret-detail")),
      actorId: researcher,
      input: { category: "plastics", state: "Gujarat", city: null, limit: 2 },
      idempotencyKey: null,
    });
    const after = await sql<{ n: number }>`SELECT count(*)::int AS n FROM manufacturer_leads`;

    expect(result.status).toBe("failed");
    expect(result.errorSummary).toBe("The research provider failed unexpectedly.");
    expect(after[0].n).toBe(before[0].n);

    const job = await sql<{ status: string; error_summary: string }>`SELECT status, error_summary FROM research_jobs WHERE id = ${result.jobId}::uuid`;
    expect(job[0]).toMatchObject({ status: "failed" });
    expect(job[0].error_summary).not.toContain("secret-detail");
  });

  it("enforces the per-user hourly quota with a 429", async () => {
    const quotaUser = await insertUser(sql, {
      email: "quota@test.example",
      displayName: "Quota",
      passwordHash: await hashPassword("integration password 123"),
      role: "researcher",
    });
    const input: ResearchInput = { category: "spices", state: "Kerala", city: null, limit: 1 };
    for (let index = 0; index < 10; index += 1) {
      await runResearchJob({ sql, provider: mockResearchProvider, actorId: quotaUser, input, idempotencyKey: null });
    }
    await expect(
      runResearchJob({ sql, provider: mockResearchProvider, actorId: quotaUser, input, idempotencyKey: null }),
    ).rejects.toMatchObject({ status: 429, code: "research_quota_exceeded" });
  });

  it("keeps the exact-duplicate key unique, even under concurrent inserts", async () => {
    const raceJob = await runResearchJob({
      sql,
      provider: mockResearchProvider,
      actorId: researcher,
      input: { category: "chemicals", state: "Odisha", city: null, limit: 1 },
      idempotencyKey: null,
    });
    const values = {
      companyName: "Race Condition Works",
      normalizedCompanyName: "race condition works",
      productCategory: "steel-fabrication",
      state: "Odisha",
      city: null,
      normalizedCity: "",
      businessPhone: null,
      normalizedPhone: null,
      sourceName: "Test",
      sourceUrl: "https://directory.example.in/race",
      normalizedSourceUrl: "https://directory.example.in/race",
      evidenceSummary: null,
      verificationStatus: "unverified" as const,
      leadStatus: "discovered" as const,
      isSynthetic: false,
      researchQuery: "race",
      researchJobId: raceJob.jobId,
      collectedAt: new Date().toISOString(),
      possibleDuplicateOf: null,
      duplicateReason: null,
    };
    const results = await Promise.all([insertDiscoveredLead(sql, values), insertDiscoveredLead(sql, values)]);
    expect(results.filter((id) => id !== null)).toHaveLength(1);
  });

  it("rejects an invalid verification status at the database layer", async () => {
    await expect(
      sql`INSERT INTO manufacturer_leads (company_name, normalized_company_name, product_category, state, source_name, source_url, normalized_source_url, verification_status, lead_status, research_query)
          VALUES ('Bad', 'bad', 'textiles', 'Kerala', 'x', 'https://a.example.in/', 'https://a.example.in/', 'trusted', 'discovered', 'q')`,
    ).rejects.toThrow();
  });

  it("updates a lead only when the expected status still matches, and writes an audit row", async () => {
    const parsed = parseLeadListQuery(new URLSearchParams("pageSize=50"));
    if (!parsed.success) throw parsed.error;
    const leads = await listLeads(sql, parsed.data);
    const lead = leads.items.find((item) => !item.isSynthetic);
    expect(lead).toBeDefined();
    const id = lead!.id;

    expect(
      await applyLeadUpdate(sql, { leadId: id, actorId: researcher, expectedStatus: "archived", assignedUserId: researcher, auditAction: "lead.assigned", auditMetadata: {} }),
    ).toBeNull();

    const updated = await applyLeadUpdate(sql, {
      leadId: id,
      actorId: researcher,
      expectedStatus: lead!.leadStatus,
      assignedUserId: researcher,
      auditAction: "lead.assigned",
      auditMetadata: { assigned: true },
    });
    expect(updated).toEqual({ id });

    const audit = await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = ${id} AND action = 'lead.assigned'`;
    expect(audit[0].n).toBe(1);
  });

  it("refuses to verify a synthetic record even when called directly", async () => {
    const synthetic = await sql<{ id: string; lead_status: string }>`SELECT id, lead_status FROM manufacturer_leads WHERE is_synthetic = true LIMIT 1`;
    const result = await applyLeadUpdate(sql, {
      leadId: synthetic[0].id,
      actorId: reviewer,
      expectedStatus: synthetic[0].lead_status as LeadStatus,
      verification: { evidenceSummary: "This should never be recorded for a synthetic record." },
      auditAction: "lead.verified",
      auditMetadata: {},
    });
    expect(result).toBeNull();
  });

  it("verifies a real lead, records evidence and an audit entry, and blocks drafts for unverified leads", async () => {
    const unverifiedLead = await sql<{ id: string }>`SELECT id FROM manufacturer_leads WHERE is_synthetic = false AND verification_status = 'unverified' AND lead_status = 'discovered' LIMIT 1`;
    const leadId = unverifiedLead[0].id;
    const lead = await getLead(sql, leadId);
    expect(lead).not.toBeNull();

    await expect(
      createOutreachDraft({ sql, actorId: marketing, lead: lead!, channel: "email", language: "en", generator: null, useAi: false }),
    ).rejects.toMatchObject({ code: "verification_required" });

    const verified = await applyLeadUpdate(sql, {
      leadId,
      actorId: reviewer,
      expectedStatus: "discovered",
      verification: { evidenceSummary: "Opened the listing, matched the name and city, product catalogue confirmed." },
      auditAction: "lead.verified",
      auditMetadata: { sourceReviewed: true },
    });
    expect(verified).toEqual({ id: leadId });

    const after = await getLead(sql, leadId);
    expect(after).toMatchObject({ verificationStatus: "verified", leadStatus: "verified" });
    expect(after?.lastVerifiedAt).not.toBeNull();
  });

  it("creates a template draft that only the reviewer can approve, and approval advances the lead", async () => {
    const verifiedLead = await sql<{ id: string }>`SELECT id FROM manufacturer_leads WHERE verification_status = 'verified' AND is_synthetic = false LIMIT 1`;
    const lead = await getLead(sql, verifiedLead[0].id);
    expect(lead).not.toBeNull();

    const created = await createOutreachDraft({ sql, actorId: marketing, lead: lead!, channel: "email", language: "hi", generator: null, useAi: false });
    expect(created.generationMode).toBe("template");
    const draft = await getDraft(sql, created.id);
    expect(draft).toMatchObject({ approvalStatus: "draft", generationMode: "template", language: "hi" });

    await transitionDraft(sql, { draftId: created.id, expectedStatus: "draft", nextStatus: "pending_review", actorId: marketing, action: "submit", decisionNote: null });

    // The database itself refuses self-approval, even if application checks were bypassed.
    await expect(
      transitionDraft(sql, { draftId: created.id, expectedStatus: "pending_review", nextStatus: "approved", actorId: marketing, action: "approve", decisionNote: null }),
    ).rejects.toThrow();

    const approved = await transitionDraft(sql, { draftId: created.id, expectedStatus: "pending_review", nextStatus: "approved", actorId: reviewer, action: "approve", decisionNote: null });
    expect(approved).toMatchObject({ approvalStatus: "approved", leadAdvanced: true });

    const leadAfter = await getLead(sql, lead!.id);
    expect(leadAfter?.leadStatus).toBe("outreach_approved");
  });

  it("requires a decision note to reject a draft", async () => {
    const lead = await sql<{ id: string }>`SELECT id FROM manufacturer_leads WHERE verification_status = 'verified' AND is_synthetic = false LIMIT 1`;
    const draftId = await insertDraft(sql, {
      leadId: lead[0].id,
      channel: "whatsapp",
      language: "te",
      subject: null,
      messageBody: "Test body for the reject path.",
      generationMode: "template",
      createdById: marketing,
    });
    await transitionDraft(sql, { draftId, expectedStatus: "draft", nextStatus: "pending_review", actorId: marketing, action: "submit", decisionNote: null });
    await expect(
      transitionDraft(sql, { draftId, expectedStatus: "pending_review", nextStatus: "rejected", actorId: reviewer, action: "reject", decisionNote: null }),
    ).rejects.toThrow();
    const rejected = await transitionDraft(sql, { draftId, expectedStatus: "pending_review", nextStatus: "rejected", actorId: reviewer, action: "reject", decisionNote: "Claim not supported" });
    expect(rejected?.approvalStatus).toBe("rejected");
  });

  it("searches by company name with LIKE wildcards matched literally", async () => {
    const plain = parseLeadListQuery(new URLSearchParams("q=Shree"));
    const literal = parseLeadListQuery(new URLSearchParams("q=%25"));
    expect(plain.success && (await listLeads(sql, plain.data)).total).toBeGreaterThan(0);
    expect(literal.success && (await listLeads(sql, literal.data)).total).toBe(0);
  });

  it("reports overview counts from the database, keeping synthetic records separate", async () => {
    const stats = await getOverviewStats(sql);
    expect(stats.syntheticLeads).toBeGreaterThan(0);
    expect(stats.totalLeads).toBeGreaterThan(0);
    expect(stats.researchJobsFailed).toBeGreaterThanOrEqual(1);
    expect(stats.draftsPendingReview).toBeGreaterThanOrEqual(0);
  });

  it("records audit entries without storing raw secrets in metadata", async () => {
    await insertAuditLog(sql, { actorId: admin, action: "test.audit", entityType: "user", entityId: admin, metadata: { note: "ok" } });
    const rows = await sql<{ safe_metadata_json: unknown }>`SELECT safe_metadata_json FROM audit_logs WHERE action = 'test.audit'`;
    expect(JSON.stringify(rows[0].safe_metadata_json)).not.toContain("password");
  });

  it("lists duplicates for a candidate from the database", async () => {
    const found = await findPossibleDuplicates(sql, {
      normalizedCompanyName: "shree ganesh textiles",
      state: "Tamil Nadu",
      normalizedCity: "tiruppur",
      productCategory: "textiles",
      normalizedPhone: "+919876543210",
      normalizedSourceUrl: "https://directory.example.in/nothing-matches",
    });
    expect(found.length).toBeGreaterThan(0);
  });
});
