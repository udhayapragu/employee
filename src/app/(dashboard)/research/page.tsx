import type { Metadata } from "next";
import Link from "next/link";
import { JobStatusBadge, ModeBadge, Card, CardTitle, EmptyState, Notice, PageHeader, TableShell, Td, Th, buttonClass, formatDate } from "@/components/ui";
import { ResearchForm } from "@/components/research-form";
import { getCurrentUser } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { categoryLabel } from "@/lib/config/domain";
import { getEnv } from "@/lib/config/env";
import { getSql } from "@/lib/db/client";
import { listResearchJobs } from "@/lib/research/jobs-repository";
import { resolveResearchAvailability } from "@/lib/research/registry";

export const metadata: Metadata = { title: "Manufacturer research" };

export default async function ResearchPage() {
  const user = await getCurrentUser();
  const availability = resolveResearchAvailability(getEnv());
  const canRun = user ? hasPermission(user.role, "research:run") : false;
  const recent = await listResearchJobs(getSql(), 1, 5);

  return (
    <>
      <PageHeader
        eyebrow="SCOUT"
        title="Manufacturer research"
        description="Search permitted public sources for manufacturers by category and state. Results are candidates for review, not verified manufacturers."
        actions={<Link className={buttonClass("ghost")} href="/research/jobs">Research history</Link>}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <ModeBadge mode={availability.available ? availability.mode : availability.mode === "disabled" ? "disabled" : "unavailable"} />
        <p className="text-sm text-muted">{availability.message}</p>
      </div>

      {!availability.available && availability.mode === "real" ? (
        <div className="mb-6">
          <Notice tone="warning" title="Real research is not configured">
            Real research needs a documented, permitted provider. Set GOOGLE_PLACES_API_KEY and RESEARCH_PROVIDER=google_places on the server, then restart. Mock records are never used as a fallback.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle>Start a research job</CardTitle>
          {canRun ? (
            <ResearchForm available={availability.available} />
          ) : (
            <EmptyState title="Your role can view research but cannot start jobs." />
          )}
        </Card>

        <Card>
          <CardTitle aside={<Link className="text-sm text-brand hover:underline" href="/research/jobs">View all</Link>}>
            Recent jobs
          </CardTitle>
          {recent.items.length === 0 ? (
            <EmptyState title="No research jobs yet.">Start a job to see results here.</EmptyState>
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th>Location</Th>
                  <Th>Status</Th>
                  <Th>Added</Th>
                </tr>
              </thead>
              <tbody>
                {recent.items.map((job) => (
                  <tr key={job.id}>
                    <Td>
                      <Link className="text-brand hover:underline" href={`/research/jobs/${job.id}`}>
                        {categoryLabel(job.category)}
                      </Link>
                    </Td>
                    <Td>
                      {job.state}
                      {job.city ? <span className="text-muted">, {job.city}</span> : null}
                    </Td>
                    <Td>
                      <JobStatusBadge status={job.status} />
                    </Td>
                    <Td className="text-muted">{formatDate(job.createdAt)}</Td>
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
