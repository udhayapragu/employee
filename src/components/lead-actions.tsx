"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callApi } from "@/lib/http/client";
import { VERIFICATION_CHECKLIST } from "@/lib/leads/verification";
import { buttonClass, fieldClass, labelClass, Notice } from "./ui";

type PatchBody = Record<string, unknown>;

/** Shared state for a lead-action form: pending flag, error and success messages, and a refresh after success. */
function useLeadPatch(leadId: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function run(body: PatchBody, successMessage: string): Promise<boolean> {
    setPending(true);
    setError(null);
    setSuccess(null);
    const result = await callApi(`/api/leads/${leadId}`, { method: "PATCH", body });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setSuccess(successMessage);
    router.refresh();
    return true;
  }

  return { pending, error, success, run };
}

function Feedback({ error, success }: { error: string | null; success: string | null }) {
  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (success) return <Notice tone="success">{success}</Notice>;
  return null;
}

export function StatusForm({
  leadId,
  currentStatus,
  options,
}: {
  leadId: string;
  currentStatus: string;
  options: { value: string; label: string }[];
}) {
  const { pending, error, success, run } = useLeadPatch(leadId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const note = String(form.get("note") ?? "").trim();
    const ok = await run(
      { action: "change_status", status: String(form.get("status")), ...(note ? { note } : {}) },
      "Status updated.",
    );
    if (ok) event.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="status" className={labelClass}>
          New status
        </label>
        <select id="status" name="status" required defaultValue="" className={fieldClass} disabled={pending || options.length === 0}>
          <option value="" disabled>
            {options.length === 0 ? "No manual changes available" : "Choose a status"}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-muted">Currently {currentStatus.replaceAll("_", " ")}.</p>
      </div>
      <div>
        <label htmlFor="status-note" className={labelClass}>
          Note <span className="font-normal text-muted">(required for contacted, replied and interested)</span>
        </label>
        <textarea id="status-note" name="note" rows={2} maxLength={2000} className={fieldClass} disabled={pending} />
      </div>
      <Feedback error={error} success={success} />
      <button type="submit" disabled={pending || options.length === 0} className={buttonClass("secondary")}>
        {pending ? "Saving..." : "Update status"}
      </button>
    </form>
  );
}

export function VerifyForm({ leadId }: { leadId: string }) {
  const { pending, error, success, run } = useLeadPatch(leadId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await run(
      {
        action: "verify",
        sourceReviewed: form.get("sourceReviewed") === "on" ? true : false,
        businessIdentityConfirmed: form.get("businessIdentityConfirmed") === "on" ? true : false,
        manufacturingActivityConfirmed: form.get("manufacturingActivityConfirmed") === "on" ? true : false,
        evidenceSummary: String(form.get("evidenceSummary") ?? ""),
      },
      "Lead verified. The checklist and evidence were recorded in the history.",
    );
    if (ok) event.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm text-muted">Confirm each item after reviewing the source yourself:</legend>
        {VERIFICATION_CHECKLIST.map((item) => (
          <label key={item.key} className="flex items-start gap-3 text-sm text-text">
            <input
              type="checkbox"
              name={item.key}
              required
              className="mt-1 h-4 w-4 accent-[var(--color-brand)]"
              disabled={pending}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="evidence" className={labelClass}>
          Evidence reviewed
        </label>
        <textarea
          id="evidence"
          name="evidenceSummary"
          required
          minLength={20}
          maxLength={2000}
          rows={3}
          placeholder="For example: opened the company website and the GST listing, product catalogue matches."
          className={fieldClass}
          disabled={pending}
        />
      </div>
      <Feedback error={error} success={success} />
      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        {pending ? "Recording..." : "Record verification"}
      </button>
    </form>
  );
}

export function AssignForm({
  leadId,
  currentUserId,
  members,
}: {
  leadId: string;
  currentUserId: string | null;
  members: { id: string; displayName: string }[];
}) {
  const { pending, error, success, run } = useLeadPatch(leadId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("assignee") ?? "");
    await run({ action: "assign", assignedUserId: value === "" ? null : value }, "Assignment saved.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="assignee" className={labelClass}>
          Owner
        </label>
        <select id="assignee" name="assignee" defaultValue={currentUserId ?? ""} className={fieldClass} disabled={pending}>
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
      </div>
      <Feedback error={error} success={success} />
      <button type="submit" disabled={pending} className={buttonClass("secondary")}>
        Save owner
      </button>
    </form>
  );
}

export function FollowUpForm({ leadId, currentValue }: { leadId: string; currentValue: string }) {
  const { pending, error, success, run } = useLeadPatch(leadId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("followUp") ?? "");
    // Follow-up times are entered in Indian Standard Time, whatever the browser's time zone.
    const date = value ? new Date(`${value}:00+05:30`) : null;
    if (date && Number.isNaN(date.getTime())) return;
    await run({ action: "follow_up", followUpAt: date ? date.toISOString() : null }, "Follow-up date saved.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="followUp" className={labelClass}>
          Follow-up date and time
        </label>
        <input id="followUp" name="followUp" type="datetime-local" defaultValue={currentValue} className={fieldClass} disabled={pending} />
      </div>
      <Feedback error={error} success={success} />
      <button type="submit" disabled={pending} className={buttonClass("secondary")}>
        Save follow-up
      </button>
    </form>
  );
}

export function NoteForm({ leadId }: { leadId: string }) {
  const { pending, error, success, run } = useLeadPatch(leadId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = String(new FormData(event.currentTarget).get("body") ?? "").trim();
    if (body.length === 0) return;
    const ok = await run({ action: "add_note", body }, "Note added.");
    if (ok) event.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label htmlFor="note-body" className="sr-only">
        Add a note
      </label>
      <textarea
        id="note-body"
        name="body"
        required
        maxLength={2000}
        rows={3}
        placeholder="Add a note for the team"
        className={fieldClass}
        disabled={pending}
      />
      <Feedback error={error} success={success} />
      <button type="submit" disabled={pending} className={buttonClass("secondary")}>
        Add note
      </button>
    </form>
  );
}

export function DuplicateDecision({ leadId }: { leadId: string }) {
  const { pending, error, success, run } = useLeadPatch(leadId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run({ action: "resolve_duplicate", decision: "not_duplicate" }, "Marked as not a duplicate.")}
          className={buttonClass("secondary")}
        >
          Not a duplicate
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run({ action: "resolve_duplicate", decision: "duplicate" }, "Archived as a duplicate.")}
          className={buttonClass("danger")}
        >
          Confirm duplicate and archive
        </button>
      </div>
      <Feedback error={error} success={success} />
    </div>
  );
}
