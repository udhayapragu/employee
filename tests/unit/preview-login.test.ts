import { describe, expect, it } from "vitest";
import { previewLoginConfig } from "@/lib/auth/preview-login";

const NOW = new Date("2026-10-28T12:00:00Z");
const FUTURE = "2026-11-04T12:00:00Z";

const open = {
  VERCEL_ENV: "preview",
  PREVIEW_PASSWORDLESS_LOGIN: "1",
  PREVIEW_LOGIN_EMAIL: "Tester@Example.com",
  PREVIEW_PASSWORDLESS_UNTIL: FUTURE,
};

describe("preview sign-in gate", () => {
  it("opens only on a Vercel Preview deployment with every setting valid", () => {
    const config = previewLoginConfig(open, NOW);
    expect(config).toEqual({ enabled: true, email: "tester@example.com", until: new Date(FUTURE) });
  });

  it("never opens in production, even with every other setting present", () => {
    expect(previewLoginConfig({ ...open, VERCEL_ENV: "production" }, NOW).enabled).toBe(false);
  });

  it("stays closed outside Vercel, including a self-hosted production server", () => {
    expect(previewLoginConfig({ ...open, VERCEL_ENV: undefined, NODE_ENV: "production" }, NOW).enabled).toBe(false);
    expect(previewLoginConfig({ ...open, VERCEL_ENV: "development" }, NOW).enabled).toBe(false);
  });

  it("requires the explicit flag to be exactly 1", () => {
    expect(previewLoginConfig({ ...open, PREVIEW_PASSWORDLESS_LOGIN: "true" }, NOW).enabled).toBe(false);
    expect(previewLoginConfig({ ...open, PREVIEW_PASSWORDLESS_LOGIN: undefined }, NOW).enabled).toBe(false);
  });

  it("requires a valid account email", () => {
    expect(previewLoginConfig({ ...open, PREVIEW_LOGIN_EMAIL: "not-an-email" }, NOW).enabled).toBe(false);
    expect(previewLoginConfig({ ...open, PREVIEW_LOGIN_EMAIL: undefined }, NOW).enabled).toBe(false);
  });

  it("expires by its own date, and requires one", () => {
    expect(previewLoginConfig({ ...open, PREVIEW_PASSWORDLESS_UNTIL: "2026-10-27T00:00:00Z" }, NOW).enabled).toBe(false);
    expect(previewLoginConfig({ ...open, PREVIEW_PASSWORDLESS_UNTIL: "2026-10-28T12:00:00Z" }, NOW).enabled).toBe(false);
    expect(previewLoginConfig({ ...open, PREVIEW_PASSWORDLESS_UNTIL: "next week" }, NOW).enabled).toBe(false);
    expect(previewLoginConfig({ ...open, PREVIEW_PASSWORDLESS_UNTIL: undefined }, NOW).enabled).toBe(false);
  });

  it("gives reasons that name variables and never echo their values", () => {
    const config = previewLoginConfig({ ...open, PREVIEW_LOGIN_EMAIL: "secret-person@example.com", PREVIEW_PASSWORDLESS_LOGIN: "0" }, NOW);
    expect(config.enabled).toBe(false);
    if (config.enabled) return;
    expect(config.reason).toContain("PREVIEW_PASSWORDLESS_LOGIN");
    expect(config.reason).not.toContain("secret-person");
  });
});
