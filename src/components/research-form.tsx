"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { INDIAN_STATES, PRODUCT_CATEGORIES } from "@/lib/config/domain";
import { callApi, newIdempotencyKey } from "@/lib/http/client";
import { buttonClass, fieldClass, labelClass, Notice } from "./ui";

interface JobSummary {
  job: {
    jobId: string;
    status: "completed" | "failed";
    counts: { discovered: number; inserted: number; skipped: number; needsReview: number };
    errorSummary: string | null;
    reused: boolean;
  };
  mode: "mock" | "real";
}

export function ResearchForm({ available }: { available: boolean }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<JobSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const city = String(form.get("city") ?? "").trim();
    setPending(true);
    setError(null);
    setResult(null);

    const response = await callApi<JobSummary>("/api/research", {
      method: "POST",
      headers: { "idempotency-key": newIdempotencyKey() },
      body: {
        category: String(form.get("category") ?? ""),
        state: String(form.get("state") ?? ""),
        city: city.length > 0 ? city : null,
        limit: Number(form.get("limit") ?? 10),
      },
    });

    setPending(false);
    if (response.ok) {
      setResult(response.data);
    } else if (response.status === 502) {
      setError("The research job failed. Its record is in the research history with the reason.");
    } else {
      setError(response.message);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="grid gap-5 sm:grid-cols-2" noValidate>
        <div>
          <label htmlFor="category" className={labelClass}>
            Product category
          </label>
          <select id="category" name="category" required className={fieldClass} disabled={!available || pending} defaultValue="">
            <option value="" disabled>
              Choose a category
            </option>
            {PRODUCT_CATEGORIES.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="state" className={labelClass}>
            State or union territory
          </label>
          <select id="state" name="state" required className={fieldClass} disabled={!available || pending} defaultValue="">
            <option value="" disabled>
              Choose a state
            </option>
            {INDIAN_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="city" className={labelClass}>
            City <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="city" name="city" maxLength={80} placeholder="e.g. Tiruppur" className={fieldClass} disabled={!available || pending} />
        </div>
        <div>
          <label htmlFor="limit" className={labelClass}>
            Maximum results
          </label>
          <input
            id="limit"
            name="limit"
            type="number"
            min={1}
            max={20}
            defaultValue={10}
            required
            className={fieldClass}
            disabled={!available || pending}
          />
          <p className="mt-1.5 text-xs text-muted">Between 1 and 20 per job.</p>
        </div>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!available || pending} className={buttonClass("primary")}>
            {pending ? "Running research..." : "Start research"}
          </button>
          {!available ? <p className="text-sm text-muted">Research is unavailable on this server. See Settings.</p> : null}
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {result ? (
        <Notice
          tone={result.job.status === "completed" ? "success" : "danger"}
          title={
            result.job.status === "completed"
              ? result.job.reused
                ? "Existing result returned for this request"
                : "Research job completed"
              : "Research job failed"
          }
        >
          <p>
            Discovered {result.job.counts.discovered} · Inserted {result.job.counts.inserted} · Skipped{" "}
            {result.job.counts.skipped} · Needs review {result.job.counts.needsReview}
          </p>
          {result.mode === "mock" ? <p className="mt-1">These are synthetic mock records, not real manufacturers.</p> : null}
          <p className="mt-2">
            <Link className="text-brand underline-offset-4 hover:underline" href={`/research/jobs/${result.job.jobId}`}>
              View job and results
            </Link>
          </p>
        </Notice>
      ) : null}
    </div>
  );
}
