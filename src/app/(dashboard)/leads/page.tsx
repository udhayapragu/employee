import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { INDIAN_STATES, LEAD_STATUSES, PRODUCT_CATEGORIES, VERIFICATION_STATUSES } from "@/lib/config/domain";
import { getSql } from "@/lib/db/client";
import { labelFor } from "@/lib/leads/lifecycle";
import { parseLeadListQuery } from "@/lib/leads/query";
import { listLeads } from "@/lib/leads/repository";
import {
  buttonClass,
  Card,
  EmptyState,
  fieldClass,
  formatDate,
  LeadStatusBadge,
  labelClass,
  Notice,
  Pagination,
  PageHeader,
  SafeLink,
  SyntheticBadge,
  TableShell,
  Td,
  Th,
  VerificationBadge,
} from "@/components/ui";
import { categoryLabel } from "@/lib/config/domain";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim() !== "") params.set(key, value);
  }

  const user = await getCurrentUser();
  const canExport = user ? hasPermission(user.role, "lead:export") : false;
  const parsed = parseLeadListQuery(params);

  if (!parsed.success) {
    return (
      <>
        <PageHeader eyebrow="CLERK" title="Leads" />
        <Notice tone="danger" title="Some filters are not valid">
          {parsed.error.issues.map((issue) => issue.message).join(" ")}
        </Notice>
        <p className="mt-4">
          <Link className="text-brand hover:underline" href="/leads">
            Clear filters
          </Link>
        </p>
      </>
    );
  }

  const query = parsed.data;
  const result = await listLeads(getSql(), query);
  const basePath = "/leads";
  const pageParams = Object.fromEntries(params.entries());
  const exportHref = `/api/leads/export${params.toString() ? `?${params.toString()}` : ""}`;

  return (
    <>
      <PageHeader
        eyebrow="CLERK"
        title="Leads"
        description="Manufacturer records with verification status, lead status and duplicate flags. Verification and contact depend on recorded evidence."
        actions={
          canExport ? (
            <a className={buttonClass("secondary")} href={exportHref} download>
              Export CSV
            </a>
          ) : null
        }
      />

      <Card className="mb-6">
        <form method="get" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="md:col-span-2 xl:col-span-2">
            <label htmlFor="q" className={labelClass}>
              Search company name
            </label>
            <input id="q" name="q" type="search" maxLength={100} defaultValue={params.get("q") ?? ""} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="category" className={labelClass}>
              Product category
            </label>
            <select id="category" name="category" defaultValue={params.get("category") ?? ""} className={fieldClass}>
              <option value="">All categories</option>
              {PRODUCT_CATEGORIES.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="state" className={labelClass}>
              State
            </label>
            <select id="state" name="state" defaultValue={params.get("state") ?? ""} className={fieldClass}>
              <option value="">All states</option>
              {INDIAN_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="city" className={labelClass}>
              City
            </label>
            <input id="city" name="city" maxLength={80} defaultValue={params.get("city") ?? ""} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="verification" className={labelClass}>
              Verification
            </label>
            <select id="verification" name="verification" defaultValue={params.get("verification") ?? ""} className={fieldClass}>
              <option value="">Any verification</option>
              {VERIFICATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {labelFor(status)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className={labelClass}>
              Lead status
            </label>
            <select id="status" name="status" defaultValue={params.get("status") ?? ""} className={fieldClass}>
              <option value="">Any status</option>
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {labelFor(status)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sort" className={labelClass}>
              Sort by
            </label>
            <div className="flex gap-2">
              <select id="sort" name="sort" defaultValue={query.sort} className={fieldClass}>
                <option value="created_at">Date added</option>
                <option value="updated_at">Last updated</option>
                <option value="company_name">Company name</option>
                <option value="state">State</option>
              </select>
              <select aria-label="Sort order" name="order" defaultValue={query.order} className={`${fieldClass} w-32`}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 md:col-span-2 xl:col-span-4">
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="duplicates" value="true" defaultChecked={query.filters.duplicatesOnly} className="h-4 w-4 accent-[var(--color-brand)]" />
              Only possible duplicates
            </label>
            <button type="submit" className={buttonClass("primary")}>
              Apply filters
            </button>
            <Link className={buttonClass("ghost")} href={basePath}>
              Clear
            </Link>
          </div>
        </form>
      </Card>

      <Card>
        {result.items.length === 0 ? (
          <EmptyState title="No leads match these filters.">Try clearing a filter, or run research to find new candidates.</EmptyState>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th>Category</Th>
                <Th>State / city</Th>
                <Th>Business phone</Th>
                <Th>Verification</Th>
                <Th>Lead status</Th>
                <Th>Source</Th>
                <Th>Added</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((lead) => (
                <tr key={lead.id} className="hover:bg-panel-raised/40">
                  <Td>
                    <Link className="font-medium text-brand hover:underline" href={`/leads/${lead.id}`}>
                      {lead.companyName}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {lead.isSynthetic ? <SyntheticBadge /> : null}
                      {lead.possibleDuplicateOf ? <span className="text-xs text-warning">Possible duplicate</span> : null}
                    </div>
                  </Td>
                  <Td>{categoryLabel(lead.productCategory)}</Td>
                  <Td>
                    {lead.state}
                    {lead.city ? <span className="text-muted">, {lead.city}</span> : null}
                  </Td>
                  <Td className="whitespace-nowrap">{lead.normalizedPhone ?? <span className="text-muted">-</span>}</Td>
                  <Td>
                    <VerificationBadge status={lead.verificationStatus} />
                  </Td>
                  <Td>
                    <LeadStatusBadge status={lead.leadStatus} />
                  </Td>
                  <Td className="max-w-[12rem] text-sm">
                    <SafeLink href={lead.sourceUrl}>{lead.sourceName}</SafeLink>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{formatDate(lead.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <Pagination basePath={basePath} params={pageParams} page={query.page} pageSize={query.pageSize} total={result.total} />
      </Card>
    </>
  );
}
