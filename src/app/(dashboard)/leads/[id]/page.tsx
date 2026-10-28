import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AssignForm, DuplicateDecision, FollowUpForm, NoteForm, StatusForm, VerifyForm } from "@/components/lead-actions";
import { DraftActions } from "@/components/draft-actions";
import { DraftForm } from "@/components/draft-form";
import {
  Badge,
  Card,
  CardTitle,
  DraftStatusBadge,
  EmptyState,
  formatDate,
  LeadStatusBadge,
  Notice,
  PageHeader,
  SafeLink,
  SyntheticBadge,
  VerificationBadge,
} from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { categoryLabel } from "@/lib/config/domain";
import { getEnv } from "@/lib/config/env";
import { getSql } from "@/lib/db/client";
import { canTransition, isContactableStatus, labelFor, MANUAL_STATUS_TARGETS } from "@/lib/leads/lifecycle";
import { getLead, listLeadHistory, listLeadNotes } from "@/lib/leads/repository";
import { canVerifyLead, VERIFICATION_CHECKLIST } from "@/lib/leads/verification";
import { listDrafts } from "@/lib/outreach/repository";
import { resolveTextGenerator } from "@/lib/ai/provider";
import { listAssignableUsers } from "@/lib/users/repository";

export const metadata: Metadata = { title: "Lead" };

function dateTimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" })
    .replace(" ", "T")
    .slice(0, 16);
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sql = getSql();
  const lead = await getLead(sql, parsed.data);
  if (!lead) notFound();

  const [notes, history, drafts, members] = await Promise.all([
    listLeadNotes(sql, lead.id),
    listLeadHistory(sql, lead.id),
    listDrafts(sql, { status: null, leadId: lead.id, page: 1, pageSize: 20 }),
    hasPermission(user.role, "lead:update") ? listAssignableUsers(sql) : Promise.resolve([]),
  ]);

  const canUpdate = hasPermission(user.role, "lead:update");
  const canVerify = hasPermission(user.role, "lead:verify");
  const canDraft = hasPermission(user.role, "draft:create");
  const canReview = hasPermission(user.role, "draft:review");
  const verifyCheck = canVerifyLead(lead);
  const draftBlockers = [
    lead.isSynthetic ? "Synthetic test records cannot be contacted." : null,
    lead.verificationStatus !== "verified" ? "Verify the lead first." : null,
    isContactableStatus(lead.leadStatus) ? null : "The lead's current status does not allow outreach.",
  ].filter((message): message is string => message !== null);

  const statusOptions = MANUAL_STATUS_TARGETS.filter((target) => canTransition(lead.leadStatus, target)).map((target) => ({
    value: target,
    label: labelFor(target),
  }));
  const aiAvailable = resolveTextGenerator(getEnv()) !== null;
  const showDuplicateReview = lead.possibleDuplicateOf !== null && lead.leadStatus === "needs_review" && canUpdate;

  return (
    <>
      <PageHeader
        eyebrow={categoryLabel(lead.productCategory)}
        title={lead.companyName}
        description={`${lead.state}${lead.city ? `, ${lead.city}` : ""} · added ${formatDate(lead.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {lead.isSynthetic ? <SyntheticBadge /> : null}
            <VerificationBadge status={lead.verificationStatus} />
            <LeadStatusBadge status={lead.leadStatus} />
          </div>
        }
      />

      {lead.isSynthetic ? (
        <div className="mb-6">
          <Notice tone="gold" title="Synthetic test record">
            This record was produced by mock research. It is not a real business and cannot be verified or contacted.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Details</CardTitle>
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Product category</dt>
                <dd className="mt-1 text-text">{categoryLabel(lead.productCategory)}</dd>
              </div>
              <div>
                <dt className="text-muted">State / city</dt>
                <dd className="mt-1 text-text">
                  {lead.state}
                  {lead.city ? `, ${lead.city}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Business phone (E.164)</dt>
                <dd className="mt-1 text-text">{lead.normalizedPhone ?? "Not available"}</dd>
              </div>
              <div>
                <dt className="text-muted">Assigned to</dt>
                <dd className="mt-1 text-text">{lead.assignedUserName ?? "Unassigned"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">Source</dt>
                <dd className="mt-1 text-text">
                  <SafeLink href={lead.sourceUrl}>{lead.sourceName}</SafeLink>
                  <span className="mt-1 block break-all text-xs text-muted">{lead.sourceUrl}</span>
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">Evidence summary</dt>
                <dd className="mt-1 whitespace-pre-wrap text-text">{lead.evidenceSummary ?? "None recorded."}</dd>
              </div>
              <div>
                <dt className="text-muted">Collected</dt>
                <dd className="mt-1 text-text">{formatDate(lead.collectedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted">Last verified</dt>
                <dd className="mt-1 text-text">{formatDate(lead.lastVerifiedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted">Follow-up (IST)</dt>
                <dd className="mt-1 text-text">{formatDate(lead.followUpAt)}</dd>
              </div>
              <div>
                <dt className="text-muted">Research job</dt>
                <dd className="mt-1">
                  {lead.researchJobId ? (
                    <Link className="text-brand hover:underline" href={`/research/jobs/${lead.researchJobId}`}>
                      View job
                    </Link>
                  ) : (
                    <span className="text-muted">Not recorded</span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          {lead.possibleDuplicateOf ? (
            <Card>
              <CardTitle>Possible duplicate</CardTitle>
              <p className="text-sm text-text">
                This record may match{" "}
                <Link className="font-medium text-brand hover:underline" href={`/leads/${lead.possibleDuplicateOf}`}>
                  {lead.possibleDuplicateCompany ?? "another lead"}
                </Link>
                . The two records were not merged.
              </p>
              <p className="mt-2 text-sm text-muted">Reason: {lead.duplicateReason ?? "Not recorded"}</p>
              {showDuplicateReview ? (
                <div className="mt-4">
                  <DuplicateDecision leadId={lead.id} />
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <CardTitle>Drafts for this lead</CardTitle>
            {drafts.items.length === 0 ? (
              <EmptyState title="No drafts yet." />
            ) : (
              <ul className="space-y-5">
                {drafts.items.map((draft) => (
                  <li key={draft.id} className="rounded-xl border border-line bg-ink/40 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <DraftStatusBadge status={draft.approvalStatus} />
                      <Badge tone={draft.generationMode === "ai" ? "brand" : "neutral"}>
                        {draft.generationMode === "ai" ? "AI draft" : "Template"}
                      </Badge>
                      <span className="text-xs text-muted">
                        {draft.channel.replace("_", " ")} · {draft.language.toUpperCase()} · by {draft.createdByName ?? "a team member"}
                      </span>
                    </div>
                    {draft.subject ? <p className="mt-3 text-sm font-medium text-text">Subject: {draft.subject}</p> : null}
                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-ink p-3 font-sans text-sm text-text">
                      {draft.messageBody}
                    </pre>
                    {draft.decisionNote ? <p className="mt-2 text-xs text-muted">Decision note: {draft.decisionNote}</p> : null}
                    <div className="mt-4">
                      <DraftActions
                        draftId={draft.id}
                        status={draft.approvalStatus}
                        subject={draft.subject}
                        messageBody={draft.messageBody}
                        isAuthor={draft.createdById === user.id}
                        canCreate={canDraft}
                        canReview={canReview}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>History</CardTitle>
            {history.length === 0 ? (
              <EmptyState title="No changes recorded yet." />
            ) : (
              <ol className="space-y-3 text-sm">
                {history.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap gap-x-3 gap-y-1 border-l-2 border-line pl-4">
                    <span className="font-medium text-text">{labelFor(entry.action.replace(/^lead\./, "").replaceAll(".", " "))}</span>
                    <span className="text-muted">
                      {entry.actorName ?? "System"} · {formatDate(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {canUpdate ? (
            <Card>
              <CardTitle>Notes</CardTitle>
              <div className="space-y-5">
                <NoteForm leadId={lead.id} />
                {notes.length === 0 ? (
                  <p className="text-sm text-muted">No notes yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {notes.map((note) => (
                      <li key={note.id} className="rounded-lg border border-line bg-ink/40 p-3">
                        <p className="whitespace-pre-wrap text-sm text-text">{note.body}</p>
                        <p className="mt-2 text-xs text-muted">
                          {note.authorName ?? "Team member"} · {formatDate(note.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          ) : null}

          {canUpdate ? (
            <Card>
              <CardTitle>Lead status</CardTitle>
              <StatusForm leadId={lead.id} currentStatus={lead.leadStatus} options={statusOptions} />
              <p className="mt-4 text-xs text-muted">
                Verified, Outreach approved, Registration and Subscription statuses are set by the process they describe, not by hand.
              </p>
            </Card>
          ) : null}

          {canVerify ? (
            <Card>
              <CardTitle>Verification</CardTitle>
              {verifyCheck.ok ? (
                <VerifyForm leadId={lead.id} />
              ) : (
                <Notice tone="warning">{verifyCheck.message}</Notice>
              )}
              <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted">
                {VERIFICATION_CHECKLIST.map((item) => (
                  <li key={item.key}>{item.label}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {canUpdate ? (
            <Card>
              <CardTitle>Owner and follow-up</CardTitle>
              <div className="space-y-6">
                <AssignForm leadId={lead.id} currentUserId={lead.assignedUserId} members={members} />
                <FollowUpForm leadId={lead.id} currentValue={dateTimeLocalValue(lead.followUpAt)} />
              </div>
            </Card>
          ) : null}

          {canDraft ? (
            <Card>
              <CardTitle>New outreach draft</CardTitle>
              {draftBlockers.length === 0 ? (
                <DraftForm leadId={lead.id} aiAvailable={aiAvailable} />
              ) : (
                <div className="space-y-2">
                  {draftBlockers.map((message) => (
                    <p key={message} className="text-sm text-muted">
                      {message}
                    </p>
                  ))}
                </div>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

