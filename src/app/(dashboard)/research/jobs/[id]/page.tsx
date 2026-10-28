import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Card, CardTitle, EmptyState, JobStatusBadge, LeadStatusBadge, ModeBadge, PageHeader, TableShell, Td, Th, VerificationBadge, formatDate } from "@/components/ui";
import { categoryLabel } from "@/lib/config/domain";
import { getSql } from "@/lib/db/client";
import { listLeads } from "@/lib/leads/repository";
import { getResearchJob } from "@/lib/research/jobs-repository";

export const metadata: Metadata = { title: "Research job" };

export default async function ResearchJobPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) notFound();

  const sql = getSql();
  const job = await getResearchJob(sql, parsed.data);
  if (!job) notFound();

  const leads = await listLeads(sql, {
    filters: {
      category: null,
      state: null,
      normalizedCity: null,
      verification: null,
      status: null,
      namePattern: null,
      researchJobId: job.id,
      duplicatesOnly: false,
    },
    sort: "company_name",
    order: "asc",
    page: 1,
    pageSize: 100,
  });

  return (
    <>
      <PageHeader
        eyebrow="Research job"
        title={`${categoryLabel(job.category)} in ${job.state}${job.city ? `, ${job.city}` : ""}`}
        description={`Requested by ${job.requestedByName ?? "a team member"} on ${formatDate(job.createdAt)}.`}
        actions={<Link className="self-center text-sm text-brand hover:underline" href="/research/jobs">Back to history</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">Status</p>
          <div className="mt-2">
            <JobStatusBadge status={job.status} />
          </div>
          {job.errorSummary ? <p className="mt-3 text-sm text-danger">{job.errorSummary}</p> : null}
        </Card>
        <Card>
          <p className="text-sm text-muted">Provider</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ModeBadge mode={job.providerMode} />
            <span className="text-xs text-muted">{job.provider}</span>
          </div>
        </Card>
        <Card>
          <p className="text-sm text-muted">Counts</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Discovered</dt>
            <dd className="text-right tabular-nums">{job.discoveredCount}</dd>
            <dt className="text-muted">Inserted</dt>
            <dd className="text-right tabular-nums">{job.insertedCount}</dd>
            <dt className="text-muted">Skipped</dt>
            <dd className="text-right tabular-nums">{job.skippedCount}</dd>
            <dt className="text-muted">Needs review</dt>
            <dd className="text-right tabular-nums">{job.needsReviewCount}</dd>
          </dl>
        </Card>
        <Card>
          <p className="text-sm text-muted">Timing</p>
          <p className="mt-2 text-sm">Started {formatDate(job.startedAt)}</p>
          <p className="mt-1 text-sm">Completed {formatDate(job.completedAt)}</p>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardTitle>Records from this job ({leads.total})</CardTitle>
          {leads.items.length === 0 ? (
            <EmptyState title="No records were inserted by this job.">
              Repeated searches skip records that already exist, so a job can insert nothing.
            </EmptyState>
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Company</Th>
                  <Th>State / city</Th>
                  <Th>Verification</Th>
                  <Th>Lead status</Th>
                  <Th>Duplicate flag</Th>
                </tr>
              </thead>
              <tbody>
                {leads.items.map((lead) => (
                  <tr key={lead.id} className="hover:bg-panel-raised/40">
                    <Td>
                      <Link className="font-medium text-brand hover:underline" href={`/leads/${lead.id}`}>
                        {lead.companyName}
                      </Link>
                      {lead.isSynthetic ? <p className="mt-1 text-xs text-gold">Synthetic test record</p> : null}
                    </Td>
                    <Td>
                      {lead.state}
                      {lead.city ? <span className="text-muted">, {lead.city}</span> : null}
                    </Td>
                    <Td>
                      <VerificationBadge status={lead.verificationStatus} />
                    </Td>
                    <Td>
                      <LeadStatusBadge status={lead.leadStatus} />
                    </Td>
                    <Td className="max-w-xs text-xs text-muted">{lead.duplicateReason ?? "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>
      </div>
    </>
  );
}
