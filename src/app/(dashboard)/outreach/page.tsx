import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { DraftActions } from "@/components/draft-actions";
import { Badge, buttonClass, Card, DraftStatusBadge, EmptyState, formatDate, Notice, PageHeader, Pagination, withParams } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { OUTREACH_LANGUAGES } from "@/lib/config/domain";
import { getSql } from "@/lib/db/client";
import { DRAFT_STATUSES, type DraftStatus } from "@/lib/outreach/approval";
import { listDrafts } from "@/lib/outreach/repository";

export const metadata: Metadata = { title: "Outreach drafts" };

const FILTERS: { value: DraftStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending_review", label: "Pending review" },
  { value: "draft", label: "Drafts" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const querySchema = z.object({
  status: z.enum(DRAFT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export default async function OutreachPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const parsed = querySchema.safeParse({
    status: typeof raw.status === "string" && raw.status !== "all" ? raw.status : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const query = parsed.success ? parsed.data : { status: undefined, page: 1 };
  const pageSize = 20;

  const user = await getCurrentUser();
  const canDraft = user ? hasPermission(user.role, "draft:create") : false;
  const canReview = user ? hasPermission(user.role, "draft:review") : false;
  const result = await listDrafts(getSql(), { status: query.status ?? null, leadId: null, page: query.page, pageSize });
  const activeStatus = query.status ?? "all";

  return (
    <>
      <PageHeader
        eyebrow="PEN"
        title="Outreach drafts"
        description="Message drafts go through a two-person approval. The author cannot approve their own draft. Approval only marks text as ready. Nothing is sent by this application."
      />

      <div className="mb-6">
        <Notice tone="gold" title="Sending is not available">
          Approved text is for a person to use through an approved channel. Template text is in five languages and should be checked by a native speaker before use.
        </Notice>
      </div>

      <nav aria-label="Filter by status" className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const active = filter.value === activeStatus;
          return (
            <Link
              key={filter.value}
              href={withParams("/outreach", { status: filter.value === "all" ? undefined : filter.value })}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-muted hover:text-text"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {result.items.length === 0 ? (
        <Card>
          <EmptyState title="No drafts in this view.">
            {canDraft ? "Create drafts from a verified lead's page." : "Drafts appear here once a team member creates them."}
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-5">
          {result.items.map((draft) => (
            <li key={draft.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link className="text-lg font-semibold text-text hover:text-brand" href={`/leads/${draft.leadId}`}>
                      {draft.leadCompanyName}
                    </Link>
                    <p className="mt-1 text-xs text-muted">
                      {draft.channel.replace("_", " ")} · {OUTREACH_LANGUAGES.find((language) => language.code === draft.language)?.label ?? draft.language} · created by{" "}
                      {draft.createdByName ?? "a team member"} on {formatDate(draft.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={draft.generationMode === "ai" ? "brand" : "neutral"}>
                      {draft.generationMode === "ai" ? "AI draft, review required" : "Template"}
                    </Badge>
                    <DraftStatusBadge status={draft.approvalStatus} />
                  </div>
                </div>

                {draft.subject ? <p className="mt-4 text-sm font-medium text-text">Subject: {draft.subject}</p> : null}
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-ink p-4 font-sans text-sm text-text">
                  {draft.messageBody}
                </pre>
                {draft.approvedByName ? (
                  <p className="mt-3 text-xs text-muted">
                    Approved by {draft.approvedByName} on {formatDate(draft.approvedAt)}
                  </p>
                ) : null}
                {draft.decisionNote ? <p className="mt-2 text-xs text-muted">Decision note: {draft.decisionNote}</p> : null}

                <div className="mt-5">
                  <DraftActions
                    draftId={draft.id}
                    status={draft.approvalStatus}
                    subject={draft.subject}
                    messageBody={draft.messageBody}
                    isAuthor={user?.id === draft.createdById}
                    canCreate={canDraft}
                    canReview={canReview}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <Card>
          <Pagination
            basePath="/outreach"
            params={{ status: query.status }}
            page={query.page}
            pageSize={pageSize}
            total={result.total}
          />
          {result.total <= pageSize ? <p className="text-sm text-muted">{result.total} draft(s) in this view.</p> : null}
        </Card>
      </div>
      <p className="mt-6 text-center">
        <Link className={buttonClass("ghost")} href="/leads">
          Go to leads to create a draft
        </Link>
      </p>
    </>
  );
}
