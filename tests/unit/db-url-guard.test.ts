import { describe, expect, it } from "vitest";
import { urlsDisagree } from "@/lib/db/sql";

const POOLED = "postgresql://app_user:secret-value@ep-cool-river-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const DIRECT = "postgresql://app_user:secret-value@ep-cool-river-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("urlsDisagree", () => {
  it("does not compare anything when either URL is unset", () => {
    expect(urlsDisagree(undefined, DIRECT)).toBeNull();
    expect(urlsDisagree(POOLED, undefined)).toBeNull();
    expect(urlsDisagree("", "")).toBeNull();
  });

  it("agrees when the pooled app URL and the direct migration URL reach the same endpoint and database", () => {
    expect(urlsDisagree(POOLED, DIRECT)).toBeNull();
    expect(urlsDisagree(DIRECT, POOLED)).toBeNull();
  });

  it("agrees for identical URLs", () => {
    expect(urlsDisagree(DIRECT, DIRECT)).toBeNull();
  });

  it("refuses when the two URLs point to different endpoints", () => {
    const otherEndpoint = "postgresql://app_user:secret-value@ep-other-branch-999999.us-east-2.aws.neon.tech/neondb?sslmode=require";
    const reason = urlsDisagree(POOLED, otherEndpoint);
    expect(reason).toContain("different Neon endpoints");
  });

  it("refuses when the two URLs name different databases on the same endpoint", () => {
    const otherDatabase = DIRECT.replace("/neondb", "/otherdb");
    const reason = urlsDisagree(POOLED, otherDatabase);
    expect(reason).toContain("different databases");
  });

  it("refuses when one URL cannot be parsed", () => {
    expect(urlsDisagree("not a url", DIRECT)).toContain("could not be parsed");
    expect(urlsDisagree(POOLED, "://broken")).toContain("could not be parsed");
  });

  it("never includes the URLs or their credentials in a refusal", () => {
    const otherEndpoint = "postgresql://app_user:other-secret@ep-other-branch-999999.us-east-2.aws.neon.tech/neondb";
    const reason = urlsDisagree(POOLED, otherEndpoint) ?? "";
    expect(reason).not.toContain("secret");
    expect(reason).not.toContain("ep-");
    expect(reason).not.toContain("neon.tech");
  });
});
