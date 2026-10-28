import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardTitle, Notice, PageHeader, StatTile, buttonClass } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { getSql } from "@/lib/db/client";
import { getOverviewStats } from "@/lib/overview/stats";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const user = await getCurrentUser();
  const stats = await getOverviewStats(getSql());
  const canResearch = user ? hasPermission(user.role, "research:run") : false;

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Pipeline at a glance"
        description="Every figure below is read from the database. Synthetic test records are counted separately and are never presented as real manufacturers."
        actions={
          canResearch ? (
            <Link className={buttonClass("primary")} href="/research">
              Start research
            </Link>
          ) : null
        }
      />

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile label="Real leads" value={stats.totalLeads} hint="Excludes synthetic test records" />
        <StatTile label="Leads requiring review" value={stats.needsReview} hint="Flagged as possible duplicates or awaiting review" />
        <StatTile label="Verified leads" value={stats.verifiedLeads} hint="Verified through the checklist, with evidence recorded" />
        <StatTile label="Research jobs completed" value={stats.researchJobsCompleted} />
        <StatTile label="Research jobs failed" value={stats.researchJobsFailed} />
        <StatTile label="Drafts awaiting approval" value={stats.draftsPendingReview} hint="Nothing is sent automatically" />
      </section>

      {stats.syntheticLeads > 0 ? (
        <div className="mt-6">
          <Notice tone="gold" title="Synthetic test records are present">
            {stats.syntheticLeads} synthetic record(s) from mock research exist. They are labelled everywhere and cannot be verified or contacted.
          </Notice>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Next steps</CardTitle>
          <ol className="list-decimal space-y-3 pl-5 text-sm text-muted">
            <li>Run research for a category and state. Review the results and duplicate flags.</li>
            <li>Verify leads with the checklist. Only verified leads can receive outreach drafts.</li>
            <li>Create drafts in the right language, then have a second reviewer approve them.</li>
          </ol>
        </Card>
        <Card>
          <CardTitle>Quick links</CardTitle>
          <div className="flex flex-wrap gap-3">
            <Link className={buttonClass("secondary")} href="/leads">
              Review leads
            </Link>
            <Link className={buttonClass("secondary")} href="/outreach">
              Approval queue
            </Link>
            <Link className={buttonClass("ghost")} href="/research/jobs">
              Research history
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}
