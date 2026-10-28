import Link from "next/link";
import type { ReactNode } from "react";
import { categoryLabel } from "@/lib/config/domain";
import { labelFor } from "@/lib/leads/lifecycle";

export const fieldClass =
  "w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-text placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-60";

export const labelClass = "mb-1.5 block text-sm font-medium text-text";

export function buttonClass(variant: "primary" | "secondary" | "ghost" | "danger" = "primary"): string {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary: "bg-brand-strong text-white hover:bg-brand",
    secondary: "border border-gold/50 bg-transparent text-gold hover:bg-gold/10",
    ghost: "text-muted hover:bg-panel-raised hover:text-text",
    danger: "border border-danger/50 text-danger hover:bg-danger/10",
  } as const;
  return `${base} ${variants[variant]}`;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-panel p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-text">{children}</h2>
      {aside}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-widest text-gold">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-semibold text-text sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel-raised/60 p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-text">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

type Tone = "neutral" | "brand" | "gold" | "success" | "warning" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-line bg-panel-raised text-muted",
  brand: "border-brand/50 bg-brand-soft text-[#e4d9ff]",
  gold: "border-gold/50 bg-gold/10 text-gold",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/50 bg-warning/10 text-warning",
  danger: "border-danger/50 bg-danger/10 text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

const VERIFICATION_TONE: Record<string, Tone> = {
  verified: "success",
  unverified: "neutral",
  needs_review: "warning",
  synthetic: "gold",
};

export function VerificationBadge({ status }: { status: string }) {
  return <Badge tone={VERIFICATION_TONE[status] ?? "neutral"}>{labelFor(status)}</Badge>;
}

const LEAD_TONE: Record<string, Tone> = {
  discovered: "neutral",
  needs_review: "warning",
  verified: "success",
  contact_ready: "brand",
  outreach_approved: "brand",
  contacted: "brand",
  replied: "brand",
  interested: "success",
  registration_started: "gold",
  registered: "gold",
  subscription_active: "gold",
  not_interested: "neutral",
  opted_out: "danger",
  archived: "neutral",
};

export function LeadStatusBadge({ status }: { status: string }) {
  return <Badge tone={LEAD_TONE[status] ?? "neutral"}>{labelFor(status)}</Badge>;
}

const JOB_TONE: Record<string, Tone> = {
  completed: "success",
  failed: "danger",
  running: "brand",
  queued: "neutral",
  cancelled: "neutral",
  awaiting_approval: "warning",
};

export function JobStatusBadge({ status }: { status: string }) {
  return <Badge tone={JOB_TONE[status] ?? "neutral"}>{labelFor(status)}</Badge>;
}

const DRAFT_TONE: Record<string, Tone> = {
  draft: "neutral",
  pending_review: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export function DraftStatusBadge({ status }: { status: string }) {
  return <Badge tone={DRAFT_TONE[status] ?? "neutral"}>{labelFor(status)}</Badge>;
}

export function ModeBadge({ mode }: { mode: "mock" | "real" | "disabled" | "unavailable" }) {
  if (mode === "mock") return <Badge tone="gold">Mock data</Badge>;
  if (mode === "real") return <Badge tone="success">Real research</Badge>;
  if (mode === "disabled") return <Badge tone="neutral">Research disabled</Badge>;
  return <Badge tone="warning">Real research unavailable</Badge>;
}

export function SyntheticBadge() {
  return <Badge tone="gold">Synthetic test record</Badge>;
}

export function Notice({
  tone = "brand",
  title,
  children,
}: {
  tone?: "brand" | "gold" | "warning" | "danger" | "success";
  title?: string;
  children: ReactNode;
}) {
  const toneClass = {
    brand: "border-brand/50 bg-brand-soft/60",
    gold: "border-gold/50 bg-gold/10",
    warning: "border-warning/50 bg-warning/10",
    danger: "border-danger/50 bg-danger/10",
    success: "border-success/40 bg-success/10",
  }[tone];
  return (
    <div role="status" className={`rounded-xl border px-4 py-3 text-sm text-text ${toneClass}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-1 text-muted" : "text-text"}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium text-text">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto sm:-mx-6">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th scope="col" className={`whitespace-nowrap border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`border-b border-line/70 px-4 py-3 align-top text-text ${className}`}>{children}</td>;
}

export function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  let safe = false;
  try {
    safe = new URL(href).protocol === "https:";
  } catch {
    safe = false;
  }
  if (!safe) return <span className="text-muted">{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-brand underline-offset-4 hover:underline">
      {children}
    </a>
  );
}

export function categoryName(slug: string): string {
  return categoryLabel(slug);
}

/** Builds a same-page URL with one query parameter replaced. Keeps the other filters. */
export function withParams(base: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav aria-label="Pagination" className="mt-5 flex items-center justify-between gap-3 text-sm">
      <p className="text-muted">
        Page {page} of {lastPage} · {total} records
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={buttonClass("secondary")} href={withParams(basePath, { ...params, page: String(page - 1) })}>
            Previous
          </Link>
        ) : null}
        {page < lastPage ? (
          <Link className={buttonClass("secondary")} href={withParams(basePath, { ...params, page: String(page + 1) })}>
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(
    new Date(value),
  );
}
