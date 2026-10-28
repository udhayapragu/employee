import { describe, expect, it } from "vitest";
import { canTransition, checkManualStatusChange, isContactableStatus, MANUAL_STATUS_TARGETS } from "@/lib/leads/lifecycle";
import { canVerifyLead, verificationRequestSchema, VERIFICATION_CHECKLIST } from "@/lib/leads/verification";
import { parseLeadListQuery } from "@/lib/leads/query";
import { planDraftTransition, canEditDraft } from "@/lib/outreach/approval";
import { createOutreachDraft, parseAiDraft } from "@/lib/outreach/drafting";
import { renderTemplate, TEMPLATE_PLACEHOLDERS } from "@/lib/outreach/templates";
import { createAnthropicGenerator, AiProviderError } from "@/lib/ai/provider";
import { toCsv, toCsvCell } from "@/lib/export/csv";
import { OUTREACH_CHANNELS, OUTREACH_LANGUAGES } from "@/lib/config/domain";
import type { SqlTag } from "@/lib/db/sql";
import type { LeadRecord } from "@/lib/leads/repository";

describe("lead lifecycle", () => {
  it("allows the normal forward path", () => {
    expect(canTransition("verified", "contact_ready")).toBe(true);
    expect(canTransition("outreach_approved", "contacted")).toBe(true);
    expect(canTransition("contacted", "replied")).toBe(true);
  });

  it("forbids skipping steps and leaving terminal states", () => {
    expect(canTransition("discovered", "contacted")).toBe(false);
    expect(canTransition("opted_out", "contacted")).toBe(false);
    expect(canTransition("archived", "contacted")).toBe(false);
  });

  it("keeps system-only statuses out of manual changes", () => {
    for (const status of ["verified", "outreach_approved", "registration_started", "registered", "subscription_active"] as const) {
      expect(MANUAL_STATUS_TARGETS).not.toContain(status);
    }
  });

  it("requires verification before contact ready", () => {
    const result = checkManualStatusChange({ from: "discovered", to: "contact_ready", hasEvidenceNote: false, verificationStatus: "unverified" });
    expect(result).toMatchObject({ ok: false, code: "invalid_transition" });

    const verified = checkManualStatusChange({ from: "verified", to: "contact_ready", hasEvidenceNote: false, verificationStatus: "unverified" });
    expect(verified).toMatchObject({ ok: false, code: "requires_verification" });
  });

  it("requires an evidence note before recording contact", () => {
    const withoutNote = checkManualStatusChange({ from: "outreach_approved", to: "contacted", hasEvidenceNote: false, verificationStatus: "verified" });
    expect(withoutNote).toMatchObject({ ok: false, code: "requires_evidence_note" });

    const withNote = checkManualStatusChange({ from: "outreach_approved", to: "contacted", hasEvidenceNote: true, verificationStatus: "verified" });
    expect(withNote).toEqual({ ok: true });
  });

  it("refuses to set registration or subscription status by hand", () => {
    const result = checkManualStatusChange({ from: "interested", to: "registered", hasEvidenceNote: true, verificationStatus: "verified" });
    expect(result).toMatchObject({ ok: false, code: "status_not_manual" });
  });

  it("never allows contacting opted-out, archived or unverified leads", () => {
    expect(isContactableStatus("opted_out")).toBe(false);
    expect(isContactableStatus("archived")).toBe(false);
    expect(isContactableStatus("discovered")).toBe(false);
    expect(isContactableStatus("verified")).toBe(true);
  });
});

describe("verification procedure", () => {
  const complete = {
    sourceReviewed: true,
    businessIdentityConfirmed: true,
    manufacturingActivityConfirmed: true,
    evidenceSummary: "Opened the company website and the GST listing; product catalogue matches.",
  };

  it("requires every checklist item to be confirmed", () => {
    for (const key of VERIFICATION_CHECKLIST.map((item) => item.key)) {
      expect(verificationRequestSchema.safeParse({ ...complete, [key]: false }).success).toBe(false);
    }
    expect(verificationRequestSchema.safeParse(complete).success).toBe(true);
  });

  it("requires a meaningful evidence summary and rejects extra fields", () => {
    expect(verificationRequestSchema.safeParse({ ...complete, evidenceSummary: "ok" }).success).toBe(false);
    expect(verificationRequestSchema.safeParse({ ...complete, status: "verified" }).success).toBe(false);
  });

  it("never verifies a synthetic record", () => {
    expect(canVerifyLead({ isSynthetic: true, leadStatus: "discovered" })).toMatchObject({ ok: false, code: "synthetic_record" });
    expect(canVerifyLead({ isSynthetic: false, leadStatus: "discovered" })).toEqual({ ok: true });
  });

  it("does not verify a lead that is opted out or archived", () => {
    expect(canVerifyLead({ isSynthetic: false, leadStatus: "opted_out" })).toMatchObject({ ok: false });
  });
});

describe("outreach draft approval", () => {
  const author = { id: "author" };
  const reviewer = { id: "reviewer", canReview: true };
  const marketing = { id: "author", canReview: false };

  it("moves a draft to review only when the author submits it", () => {
    expect(planDraftTransition({ status: "draft", createdById: "author" }, "submit", marketing, null)).toMatchObject({ ok: true, to: "pending_review" });
    expect(planDraftTransition({ status: "draft", createdById: "author" }, "submit", { id: "other", canReview: false }, null)).toMatchObject({ ok: false, code: "not_author" });
  });

  it("prevents the author from approving their own draft", () => {
    const result = planDraftTransition({ status: "pending_review", createdById: author.id }, "approve", { id: author.id, canReview: true }, null);
    expect(result).toMatchObject({ ok: false, code: "self_approval_forbidden", httpStatus: 403 });
  });

  it("lets a different reviewer approve, and advances the lead", () => {
    expect(planDraftTransition({ status: "pending_review", createdById: "author" }, "approve", reviewer, null)).toEqual({
      ok: true,
      to: "approved",
      advancesLead: true,
    });
  });

  it("requires a reviewer role for approval and rejection", () => {
    expect(planDraftTransition({ status: "pending_review", createdById: "author" }, "approve", { id: "x", canReview: false }, null)).toMatchObject({ ok: false, httpStatus: 403 });
  });

  it("requires a reason to reject a draft", () => {
    expect(planDraftTransition({ status: "pending_review", createdById: "author" }, "reject", reviewer, "")).toMatchObject({ ok: false, code: "note_required" });
    expect(planDraftTransition({ status: "pending_review", createdById: "author" }, "reject", reviewer, "Uses an unverified claim")).toMatchObject({ ok: true, to: "rejected" });
  });

  it("does not allow approving a draft that is not pending review", () => {
    expect(planDraftTransition({ status: "draft", createdById: "author" }, "approve", reviewer, null)).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
    expect(planDraftTransition({ status: "approved", createdById: "author" }, "approve", reviewer, null)).toMatchObject({ ok: false });
  });

  it("allows cancellation only while the draft is open", () => {
    expect(planDraftTransition({ status: "approved", createdById: "author" }, "cancel", marketing, null)).toMatchObject({ ok: false });
    expect(planDraftTransition({ status: "pending_review", createdById: "author" }, "cancel", marketing, null)).toMatchObject({ ok: true, to: "cancelled" });
  });

  it("lets only the author edit an unsubmitted draft", () => {
    expect(canEditDraft({ status: "draft", createdById: "author" }, "author")).toBe(true);
    expect(canEditDraft({ status: "draft", createdById: "author" }, "reviewer")).toBe(false);
    expect(canEditDraft({ status: "pending_review", createdById: "author" }, "author")).toBe(false);
  });
});

describe("outreach drafting eligibility", () => {
  function leadFixture(overrides: Partial<LeadRecord> = {}): LeadRecord {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      companyName: "Sample Unit",
      normalizedCompanyName: "sample unit",
      productCategory: "textiles",
      state: "Tamil Nadu",
      city: "Tiruppur",
      businessPhone: null,
      normalizedPhone: null,
      sourceName: "Test directory",
      sourceUrl: "https://directory.example.in/listing/1",
      evidenceSummary: null,
      verificationStatus: "verified",
      leadStatus: "verified",
      isSynthetic: false,
      researchQuery: "test",
      researchJobId: null,
      collectedAt: null,
      possibleDuplicateOf: null,
      possibleDuplicateCompany: null,
      duplicateReason: null,
      assignedUserId: null,
      assignedUserName: null,
      followUpAt: null,
      lastVerifiedAt: null,
      createdAt: null,
      updatedAt: null,
      ...overrides,
    };
  }

  // Eligibility is decided before any database call, so the SQL client is never used in these cases.
  const unusedSql = {} as unknown as SqlTag;

  it("refuses drafts for synthetic, unverified and blocked leads", async () => {
    const base = { sql: unusedSql, actorId: "a", generator: null, useAi: false, channel: "email", language: "en" } as const;

    await expect(createOutreachDraft({ ...base, lead: leadFixture({ isSynthetic: true }) })).rejects.toMatchObject({ code: "synthetic_record" });
    await expect(createOutreachDraft({ ...base, lead: leadFixture({ verificationStatus: "unverified" }) })).rejects.toMatchObject({ code: "verification_required" });
    await expect(createOutreachDraft({ ...base, lead: leadFixture({ leadStatus: "opted_out" }) })).rejects.toMatchObject({ code: "lead_not_contactable" });
  });

  it("refuses AI drafting when no generator is configured instead of silently using templates", async () => {
    await expect(
      createOutreachDraft({ sql: unusedSql, actorId: "a", lead: leadFixture(), generator: null, useAi: true, channel: "email", language: "en" }),
    ).rejects.toMatchObject({ code: "ai_not_configured", status: 503 });
  });
});

describe("message templates", () => {
  it("provides text for every language and channel", () => {
    for (const language of OUTREACH_LANGUAGES) {
      for (const channel of OUTREACH_CHANNELS) {
        const rendered = renderTemplate(language.code, channel, { company: "Sample Unit", category: "Textiles", state: "Kerala" });
        expect(rendered.body.length).toBeGreaterThan(40);
        expect(rendered.body).not.toMatch(/\{\{|\}\}/);
        expect(rendered.body).toContain("Sample Unit");
      }
    }
  });

  it("gives email a subject line and other channels none", () => {
    expect(renderTemplate("en", "email", { company: "A Co", category: "Spices", state: "Kerala" }).subject).toMatch(/Spices/);
    expect(renderTemplate("en", "whatsapp", { company: "A Co", category: "Spices", state: "Kerala" }).subject).toBeNull();
  });

  it("includes an opt-out in every email and WhatsApp message", () => {
    for (const language of OUTREACH_LANGUAGES) {
      expect(renderTemplate(language.code, "email", { company: "A", category: "B", state: "C" }).body.toLowerCase()).toContain("unsubscribe");
      expect(renderTemplate(language.code, "whatsapp", { company: "A", category: "B", state: "C" }).body).toContain("STOP");
    }
  });

  it("makes no guarantee or sales promise in English", () => {
    for (const channel of OUTREACH_CHANNELS) {
      const text = renderTemplate("en", channel, { company: "A", category: "B", state: "C" }).body.toLowerCase();
      expect(text).not.toMatch(/guarantee|guaranteed|we will get you/);
    }
  });

  it("links only to bulkskart.com", () => {
    const links = renderTemplate("en", "email", { company: "A", category: "B", state: "C" }).body.match(/https?:\/\/\S+/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(new URL(link).hostname).toBe("bulkskart.com");
  });

  it("documents its placeholders", () => {
    expect(TEMPLATE_PLACEHOLDERS).toEqual(["{{company}}", "{{category}}", "{{state}}"]);
  });
});

describe("AI draft validation", () => {
  it("accepts well-formed JSON with an allowed link", () => {
    const text = 'Here you go: {"subject": "Hello", "body": "A short truthful message about Bulkskart at https://bulkskart.com for your team."}';
    expect(parseAiDraft(text, "email")).toEqual({
      subject: "Hello",
      body: "A short truthful message about Bulkskart at https://bulkskart.com for your team.",
    });
  });

  it("drops the subject for non-email channels", () => {
    const text = '{"subject": "Ignored", "body": "A short truthful message about Bulkskart for your team today."}';
    expect(parseAiDraft(text, "whatsapp").subject).toBeNull();
  });

  it("rejects output that is not JSON or does not match the schema", () => {
    expect(() => parseAiDraft("no json here", "email")).toThrow();
    expect(() => parseAiDraft('{"body": 5}', "email")).toThrow();
    expect(() => parseAiDraft('{"subject": null, "body": "short", "extra": 1}', "email")).toThrow();
  });

  it("rejects guarantees, and links to any site other than bulkskart.com", () => {
    expect(() => parseAiDraft('{"subject": null, "body": "We guarantee sales for your unit this year."}', "email")).toThrow(/claim/);
    expect(() => parseAiDraft('{"subject": null, "body": "Register at https://phish.example.net/login now please."}', "email")).toThrow(/unapproved site/);
  });
});

describe("Anthropic adapter", () => {
  it("returns the text blocks and sends the key only in a header", async () => {
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test-key-1234567890");
      expect(String(init?.body)).not.toContain("test-key");
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"subject":null,"body":"Hello there."}' }] }), { status: 200 });
    };
    const generator = createAnthropicGenerator("test-key-1234567890", "claude-haiku-5-5", fetchImpl as unknown as typeof fetch);
    await expect(generator.generate({ system: "s", user: "u", maxTokens: 100 }, AbortSignal.timeout(5000))).resolves.toContain("Hello there.");
  });

  it("fails without leaking the upstream body on HTTP errors", async () => {
    const fetchImpl = async () => new Response("upstream secret", { status: 401 });
    const generator = createAnthropicGenerator("test-key-1234567890", "claude-haiku-5-5", fetchImpl as unknown as typeof fetch);
    const error = await generator.generate({ system: "s", user: "u", maxTokens: 10 }, AbortSignal.timeout(5000)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as Error).message).toBe("The AI provider returned HTTP 401.");
  });

  it("rejects an unexpected response shape", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ content: "nope" }), { status: 200 });
    const generator = createAnthropicGenerator("test-key-1234567890", "claude-haiku-5-5", fetchImpl as unknown as typeof fetch);
    await expect(generator.generate({ system: "s", user: "u", maxTokens: 10 }, AbortSignal.timeout(5000))).rejects.toThrow("unexpected response shape");
  });
});

describe("CSV export", () => {
  it.each([
    ["+91 98765 43210", "'+91 98765 43210"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["  =1+1", "'  =1+1"],
    ["|cmd", "'|cmd"],
  ])("neutralises a formula-like cell %s", (input, expected) => {
    expect(toCsvCell(input)).toBe(expected);
  });

  it("neutralises and quotes a HYPERLINK formula that also contains quotes", () => {
    expect(toCsvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(toCsvCell('Acme, "Best" Co')).toBe('"Acme, ""Best"" Co"');
    expect(toCsvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("leaves ordinary text and nulls alone", () => {
    expect(toCsvCell("Tamil Nadu")).toBe("Tamil Nadu");
    expect(toCsvCell(null)).toBe("");
    expect(toCsvCell(true)).toBe("true");
  });

  it("builds CRLF-terminated CSV with the header first", () => {
    expect(toCsv(["Company", "State"], [["Acme", "Kerala"]])).toBe("Company,State\r\nAcme,Kerala\r\n");
  });
});

describe("lead list query parsing", () => {
  it("applies safe defaults", () => {
    const parsed = parseLeadListQuery(new URLSearchParams());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({ page: 1, pageSize: 25, sort: "created_at", order: "desc" });
      expect(parsed.data.filters.namePattern).toBeNull();
    }
  });

  it("rejects an unsupported sort field, category, state or verification value", () => {
    expect(parseLeadListQuery(new URLSearchParams("sort=password_hash")).success).toBe(false);
    expect(parseLeadListQuery(new URLSearchParams("category=weapons")).success).toBe(false);
    expect(parseLeadListQuery(new URLSearchParams("state=Atlantis")).success).toBe(false);
    expect(parseLeadListQuery(new URLSearchParams("verification=trusted")).success).toBe(false);
  });

  it("bounds pagination", () => {
    expect(parseLeadListQuery(new URLSearchParams("pageSize=500")).success).toBe(false);
    expect(parseLeadListQuery(new URLSearchParams("page=0")).success).toBe(false);
  });

  it("escapes LIKE wildcards in search text and normalises the city filter", () => {
    const parsed = parseLeadListQuery(new URLSearchParams("q=100%_off&city=Tiruppur,%20TN"));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.filters.namePattern).toBe("%100\\%\\_off%");
      expect(parsed.data.filters.normalizedCity).toBe("tiruppur tn");
    }
  });

  it("treats blank values as absent", () => {
    const parsed = parseLeadListQuery(new URLSearchParams("category=&state=&q="));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.filters.category).toBeNull();
  });
});
