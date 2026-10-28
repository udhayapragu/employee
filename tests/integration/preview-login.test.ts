/* eslint-disable @typescript-eslint/no-explicit-any -- test helper reads loosely typed JSON response bodies */
import path from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPgSqlTag } from "../helpers/pg-sql";
import { hashPassword } from "@/lib/auth/password";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { runMigrations } from "@/lib/db/migrations";
import type { SqlTag } from "@/lib/db/sql";
import { insertUser } from "@/lib/users/repository";

// Route handlers read the database through getSql(). Point it at the test pool; everything else is real.
const holder = vi.hoisted(() => ({ sql: null as unknown as SqlTag }));
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getSql: () => holder.sql };
});

import { POST as previewPost } from "@/app/api/auth/preview-login/route";
import { GET as leadsGet } from "@/app/api/leads/route";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "https://preview.test";
const PASSWORD = "preview account password 123";
const PREVIEW_EMAIL = "preview.tester@api.example";
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

function request(path: string, init: { method?: string; origin?: string | null; cookie?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.cookie) headers.cookie = `${SESSION_COOKIE_NAME}=${init.cookie}`;
  return new Request(`${ORIGIN}${path}`, { method: init.method ?? "POST", headers });
}

function previewEnv(overrides: Record<string, string | undefined> = {}): void {
  const values: Record<string, string | undefined> = {
    VERCEL_ENV: "preview",
    PREVIEW_PASSWORDLESS_LOGIN: "1",
    PREVIEW_LOGIN_EMAIL: PREVIEW_EMAIL,
    PREVIEW_PASSWORDLESS_UNTIL: FUTURE,
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) vi.stubEnv(name, undefined as unknown as string);
    else vi.stubEnv(name, value);
  }
}

async function counts(pool: Pool) {
  const [sessions, audit, users] = await Promise.all([
    pool.query("SELECT count(*)::int AS n FROM sessions"),
    pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'auth.preview_login'"),
    pool.query("SELECT count(*)::int AS n, md5(string_agg(password_hash, '|' ORDER BY email)) AS digest FROM users"),
  ]);
  return {
    sessions: sessions.rows[0].n as number,
    previewAudit: audit.rows[0].n as number,
    users: users.rows[0].n as number,
    passwordDigest: users.rows[0].digest as string,
  };
}

describe.skipIf(!TEST_DATABASE_URL)("preview sign-in against real Postgres", () => {
  let pool: Pool;
  let previewUserId: string;

  beforeAll(async () => {
    if (!/test/i.test(new URL(TEST_DATABASE_URL as string).pathname)) throw new Error("Test database name must contain 'test'.");
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
    holder.sql = createPgSqlTag(pool);
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const client = await pool.connect();
    try {
      await runMigrations({ query: async (text: string, params?: unknown[]) => client.query(text, params) }, path.join(process.cwd(), "db", "migrations"));
    } finally {
      client.release();
    }
    const hash = await hashPassword(PASSWORD);
    previewUserId = await insertUser(holder.sql, { email: PREVIEW_EMAIL, displayName: "Preview Tester", passwordHash: hash, role: "researcher" });
    await insertUser(holder.sql, { email: "inactive.preview@api.example", displayName: "Inactive", passwordHash: hash, role: "viewer" });
    await pool.query("UPDATE users SET is_active = false WHERE email = 'inactive.preview@api.example'");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool?.end();
  });

  it("answers like a missing route, and writes nothing, when the gate is closed", async () => {
    const before = await counts(pool);
    const response = await previewPost(request("/api/auth/preview-login"));
    expect(response.status).toBe(404);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await counts(pool)).toEqual(before);
  });

  it("stays closed in production even when every preview setting is present", async () => {
    previewEnv({ VERCEL_ENV: "production" });
    const before = await counts(pool);
    expect((await previewPost(request("/api/auth/preview-login"))).status).toBe(404);
    expect(await counts(pool)).toEqual(before);
  });

  it("stays closed after its expiry date", async () => {
    previewEnv({ PREVIEW_PASSWORDLESS_UNTIL: PAST });
    expect((await previewPost(request("/api/auth/preview-login"))).status).toBe(404);
  });

  it("stays closed for an inactive account", async () => {
    previewEnv({ PREVIEW_LOGIN_EMAIL: "inactive.preview@api.example" });
    expect((await previewPost(request("/api/auth/preview-login"))).status).toBe(404);
  });

  it("refuses a cross-site request even with the gate open", async () => {
    previewEnv();
    const before = await counts(pool);
    const response = await previewPost(request("/api/auth/preview-login", { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(await counts(pool)).toEqual(before);
  });

  it("signs in without a password, sets a session cookie, and changes no password or user row", async () => {
    previewEnv();
    const before = await counts(pool);

    const response = await previewPost(request("/api/auth/preview-login"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.user).toMatchObject({ id: previewUserId, email: PREVIEW_EMAIL, role: "researcher" });

    const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    const token = cookie.split(";")[0].slice(`${SESSION_COOKIE_NAME}=`.length);

    const after = await counts(pool);
    expect(after.sessions).toBe(before.sessions + 1);
    expect(after.previewAudit).toBe(before.previewAudit + 1);
    expect(after.users).toBe(before.users);
    expect(after.passwordDigest).toBe(before.passwordDigest);

    // The issued cookie is a real session: the protected lead list accepts it for this role.
    const leads = await leadsGet(request("/api/leads", { method: "GET", cookie: token }));
    expect(leads.status).toBe(200);
  });
});
