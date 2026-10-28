import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { Card, EmptyState, JobStatusBadge, ModeBadge, Pagination, PageHeader, TableShell, Td, Th, formatDate } from "@/components/ui";
import { categoryLabel } from "@/lib/config/domain";
import { getSql } from "@/lib/db/client";
import { listResearchJobs } from "@/lib/research/jobs-repository";

export const metadata: Metadata = { title: "Research history" };

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export default async function ResearchHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const { page } = pagingSchema.parse({ page: typeof raw.page === "string" ? raw.page : undefined });
  const pageSize = 20;
  const result = await listResearchJobs(getSql(), page, pageSize);

  return (
    <>
      <PageHeader eyebrow="SCOUT" title="Research history" description="Every research job, its provider and its outcome. Failed jobs record the reason." />
      <Card>
        {result.items.length === 0 ? (
          <EmptyState title="No research jobs yet." />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Category</Th>
                <Th>State / city</Th>
                <Th>Provider</Th>
                <Th>Status</Th>
                <Th className="text-right">Discovered</Th>
                <Th className="text-right">Inserted</Th>
                <Th className="text-right">Skipped</Th>
                <Th className="text-right">Needs review</Th>
                <Th>Started</Th>
                <Th>Completed</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((job) => (
                <tr key={job.id} className="hover:bg-panel-raised/40">
                  <Td>
                    <Link className="font-mono text-xs text-brand hover:underline" href={`/research/jobs/${job.id}`}>
                      {job.id.slice(0, 8)}
                    </Link>
                  </Td>
                  <Td>{categoryLabel(job.category)}</Td>
                  <Td>
                    {job.state}
                    {job.city ? <span className="text-muted">, {job.city}</span> : null}
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <ModeBadge mode={job.providerMode} />
                      <span className="text-xs text-muted">{job.provider}</span>
                    </div>
                  </Td>
                  <Td>
                    <JobStatusBadge status={job.status} />
                    {job.errorSummary ? <p className="mt-1 max-w-xs text-xs text-danger">{job.errorSummary}</p> : null}
                  </Td>
                  <Td className="text-right tabular-nums">{job.discoveredCount}</Td>
                  <Td className="text-right tabular-nums">{job.insertedCount}</Td>
                  <Td className="text-right tabular-nums">{job.skippedCount}</Td>
                  <Td className="text-right tabular-nums">{job.needsReviewCount}</Td>
                  <Td className="whitespace-nowrap text-muted">{formatDate(job.startedAt)}</Td>
                  <Td className="whitespace-nowrap text-muted">{formatDate(job.completedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <Pagination basePath="/research/jobs" params={{}} page={page} pageSize={pageSize} total={result.total} />
      </Card>
    </>
  );
}
