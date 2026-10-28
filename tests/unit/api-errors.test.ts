import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, parseJsonBody, withApi } from "@/lib/http/api";
import { DatabaseNotConfiguredError } from "@/lib/db/client";
import { GET as leadsGet } from "@/app/api/leads/route";
import { POST as researchPost } from "@/app/api/research/route";
import { GET as healthGet } from "@/app/api/health/route";
import { POST as loginPost } from "@/app/api/auth/login/route";

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("withApi error mapping", () => {
  it("maps ApiError to its status and a stable error code", async () => {
    const handler = withApi(async () => {
      throw new ApiError(409, "conflict_code", "Safe message.");
    });
    const response = await handler(new Request("https://app.test/api/x"));
    expect(response.status).toBe(409);
    expect((await json(response)).error).toMatchObject({ code: "conflict_code", message: "Safe message." });
  });

  it("returns validation details without echoing the submitted values", async () => {
    const handler = withApi(async () => {
      z.object({ limit: z.number().max(20) }).parse({ limit: 987654321 });
      return new Response("unreachable");
    });
    const response = await handler(new Request("https://app.test/api/x"));
    const body = JSON.stringify(await json(response));
    expect(response.status).toBe(400);
    expect(body).toContain("validation_error");
    expect(body).toContain("limit");
    // The request ID is random, so the probe value must be one a random ID cannot contain.
    expect(body).not.toContain("987654321");
  });

  it("hides unexpected errors behind a generic 500 with a request ID", async () => {
    const handler = withApi(async () => {
      throw new Error("relation users does not exist at postgres://user:secret@db/host");
    });
    const response = await handler(new Request("https://app.test/api/x", { headers: { "x-request-id": "abc-123-def-456" } }));
    const text = JSON.stringify(await json(response));
    expect(response.status).toBe(500);
    expect(text).not.toContain("relation");
    expect(text).not.toContain("secret");
    expect(response.headers.get("x-request-id")).toBe("abc-123-def-456");
  });

  it("reports a missing database as unavailable without naming the variable", async () => {
    const handler = withApi(async () => {
      throw new DatabaseNotConfiguredError();
    });
    const response = await handler(new Request("https://app.test/api/x"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await json(response))).not.toContain("DATABASE_URL");
  });

  it("ignores a client-supplied request ID that is not well formed", async () => {
    const handler = withApi(async () => new Response("ok"));
    const response = await handler(new Request("https://app.test/api/x", { headers: { "x-request-id": "bad id!!" } }));
    expect(response.headers.get("x-request-id")).not.toBe("bad id!!");
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ name: z.string() }).strict();

  it("rejects non-JSON content types", async () => {
    const request = new Request("https://app.test/", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    await expect(parseJsonBody(request, schema)).rejects.toMatchObject({ status: 415 });
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    const malformed = new Request("https://app.test/", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    await expect(parseJsonBody(malformed, schema)).rejects.toMatchObject({ status: 400 });

    const big = new Request("https://app.test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x".repeat(20_000) }) });
    await expect(parseJsonBody(big, schema)).rejects.toMatchObject({ status: 413 });
  });

  it("returns the validated value", async () => {
    const request = new Request("https://app.test/", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"ok"}' });
    await expect(parseJsonBody(request, schema)).resolves.toEqual({ name: "ok" });
  });
});

describe("protected routes without a session (no database touched)", () => {
  it("returns 401 for an unauthenticated lead list request", async () => {
    const response = await leadsGet(new Request("https://app.test/api/leads"));
    expect(response.status).toBe(401);
    expect((await json(response)).error).toMatchObject({ code: "unauthenticated" });
  });

  it("refuses a research start from a cross-site origin before anything else", async () => {
    const response = await researchPost(
      new Request("https://app.test/api/research", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: JSON.stringify({ category: "textiles", state: "Kerala" }),
      }),
    );
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: "csrf_rejected" });
  });

  it("refuses sign-in from a cross-site origin", async () => {
    const response = await loginPost(
      new Request("https://app.test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", password: "x" }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("returns 401 for research start without a session when the origin matches", async () => {
    const response = await researchPost(
      new Request("https://app.test/api/research", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.test" },
        body: JSON.stringify({ category: "textiles", state: "Kerala" }),
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe("health endpoint", () => {
  it("reports degraded without database details when the database is not configured", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const response = await healthGet(new Request("https://app.test/api/health"));
      const body = await json(response);
      expect(response.status).toBe(503);
      expect(body).toEqual({ status: "degraded", checks: { database: "unavailable" } });
    } finally {
      if (previous !== undefined) process.env.DATABASE_URL = previous;
    }
  });
});
