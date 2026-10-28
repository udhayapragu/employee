import { describe, expect, it } from "vitest";
import { hasPermission, permissionsFor, type Role } from "@/lib/auth/permissions";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { readCookieFromHeader } from "@/lib/auth/access";
import { hashSessionToken, generateSessionToken } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { getEnv, ConfigError } from "@/lib/config/env";
import { redactText, logEvent } from "@/lib/log/logger";

describe("role permissions", () => {
  it("lets only researchers and admins start research", () => {
    const runners: Role[] = ["super_admin", "admin", "researcher"];
    for (const role of ["super_admin", "admin", "researcher", "marketing", "viewer"] as Role[]) {
      expect(hasPermission(role, "research:run")).toBe(runners.includes(role));
    }
  });

  it("prevents viewers from changing anything", () => {
    const viewer = permissionsFor("viewer");
    expect(viewer).toEqual(expect.arrayContaining(["lead:read", "research:view", "overview:view"]));
    for (const forbidden of ["lead:update", "lead:verify", "lead:export", "draft:create", "draft:review", "research:run"] as const) {
      expect(viewer).not.toContain(forbidden);
    }
  });

  it("lets only admins review outreach drafts", () => {
    const reviewers: Role[] = ["super_admin", "admin"];
    for (const role of ["super_admin", "admin", "researcher", "marketing", "viewer"] as Role[]) {
      expect(hasPermission(role, "draft:review")).toBe(reviewers.includes(role));
    }
  });

  it("reserves user management for the super administrator", () => {
    expect(hasPermission("super_admin", "users:manage")).toBe(true);
    expect(hasPermission("admin", "users:manage")).toBe(false);
  });

  it("lets marketing create drafts but not verify leads", () => {
    expect(hasPermission("marketing", "draft:create")).toBe(true);
    expect(hasPermission("marketing", "lead:verify")).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong horse battery", hash)).toBe(false);
  });

  it("uses a fresh salt, so equal passwords hash differently", async () => {
    expect(await hashPassword("same password here")).not.toBe(await hashPassword("same password here"));
  });

  it("never verifies a malformed stored hash", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "md5$abc")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$x$8$1$aaaa$bbbb")).toBe(false);
  });

  it("enforces the minimum and maximum password length", () => {
    expect(validatePasswordStrength("short")).toMatch(/at least 12/);
    expect(validatePasswordStrength("a".repeat(257))).toMatch(/at most 256/);
    expect(validatePasswordStrength("a valid passphrase")).toBeNull();
  });
});

describe("sessions", () => {
  it("stores only a SHA-256 hash of the session token", () => {
    const token = generateSessionToken();
    const digest = hashSessionToken(token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
  });

  it("reads the session cookie from a Cookie header", () => {
    expect(readCookieFromHeader("a=1; bs_session=abc.def; theme=dark", "bs_session")).toBe("abc.def");
    expect(readCookieFromHeader("bs_session_other=1", "bs_session")).toBeNull();
    expect(readCookieFromHeader(null, "bs_session")).toBeNull();
  });
});

describe("same-origin (CSRF) check", () => {
  const env = {};
  it("accepts a request whose Origin matches the application", () => {
    const request = new Request("https://employee.example.com/api/leads/x", { method: "PATCH", headers: { origin: "https://employee.example.com" } });
    expect(isSameOriginRequest(request, env)).toBe(true);
  });

  it("rejects a cross-site origin", () => {
    const request = new Request("https://employee.example.com/api/leads/x", { method: "PATCH", headers: { origin: "https://evil.example" } });
    expect(isSameOriginRequest(request, env)).toBe(false);
  });

  it("rejects a request with no Origin header", () => {
    const request = new Request("https://employee.example.com/api/leads/x", { method: "PATCH" });
    expect(isSameOriginRequest(request, env)).toBe(false);
  });

  it("matches the Host header the browser addressed, even when request.url differs", () => {
    const request = new Request("http://localhost:3100/api/research", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" },
    });
    expect(isSameOriginRequest(request, env)).toBe(true);
  });

  it("honours x-forwarded-proto behind a TLS-terminating proxy", () => {
    const request = new Request("http://internal/api/research", {
      method: "POST",
      headers: { origin: "https://employee.example.com", host: "employee.example.com", "x-forwarded-proto": "https" },
    });
    expect(isSameOriginRequest(request, env)).toBe(true);
  });

  it("rejects an Origin that does not match the Host header", () => {
    const request = new Request("https://employee.example.com/api/research", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "employee.example.com" },
    });
    expect(isSameOriginRequest(request, env)).toBe(false);
  });

  it("accepts the configured APP_ORIGIN", () => {
    const request = new Request("http://internal/api/x", { method: "POST", headers: { origin: "https://app.bulkskart.example" } });
    expect(isSameOriginRequest(request, { APP_ORIGIN: "https://app.bulkskart.example" })).toBe(true);
  });
});

describe("rate limiter", () => {
  it("allows up to the maximum within the window, then blocks", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
    expect(limiter.check("k", 0).allowed).toBe(true);
    expect(limiter.check("k", 10).allowed).toBe(true);
    const blocked = limiter.check("k", 20);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("recovers after the window passes and isolates keys", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 500).allowed).toBe(false);
    expect(limiter.check("b", 500).allowed).toBe(true);
    expect(limiter.check("a", 1500).allowed).toBe(true);
  });
});

describe("configuration and logging safety", () => {
  it("names the invalid variable without echoing its value", () => {
    try {
      getEnv({ SESSION_TTL_HOURS: "not-a-number-secret-value", RESEARCH_PROVIDER: "x" });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("SESSION_TTL_HOURS");
      expect((error as Error).message).not.toContain("secret-value");
    }
  });

  it("redacts connection strings and API keys from log text", () => {
    expect(redactText("failed at postgres://user:pw@host/db")).not.toContain("pw@host");
    expect(redactText("key sk-ant-abcdef1234567890")).toBe("key [redacted]");
  });

  it("writes structured log lines without sensitive field values", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => lines.push(String(line));
    try {
      logEvent("info", "test.event", { apiKey: "should-not-appear", note: "postgres://a:b@c/d", count: 2 });
    } finally {
      console.log = original;
    }
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(entry.apiKey).toBe("[redacted]");
    expect(String(entry.note)).not.toContain("a:b@c");
    expect(entry.count).toBe(2);
  });
});
