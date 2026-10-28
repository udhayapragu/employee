"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callApi } from "@/lib/http/client";
import { buttonClass, fieldClass, labelClass } from "./ui";

interface DraftActionsProps {
  draftId: string;
  status: string;
  subject: string | null;
  messageBody: string;
  isAuthor: boolean;
  canCreate: boolean;
  canReview: boolean;
}

/** Shows only the actions the current user may take. The server re-checks every one. */
export function DraftActions({ draftId, status, subject, messageBody, isAuthor, canCreate, canReview }: DraftActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const isOpen = status === "draft" || status === "pending_review";
  const canEdit = isAuthor && canCreate && status === "draft";
  const canSubmit = isAuthor && canCreate && status === "draft";
  const canDecide = canReview && !isAuthor && status === "pending_review";
  const canCancel = isOpen && (isAuthor || canReview);

  async function act(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    const result = await callApi(`/api/outreach/drafts/${draftId}`, { method: "PATCH", body });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    router.refresh();
    return true;
  }

  async function onEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await act({
      action: "edit",
      subject: String(form.get("subject") ?? "").trim() || null,
      messageBody: String(form.get("messageBody") ?? "").trim(),
    });
    if (ok) setEditing(false);
  }

  async function onReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("decisionNote") ?? "").trim();
    const ok = await act({ action: "reject", decisionNote: note });
    if (ok) setRejecting(false);
  }

  if (!canEdit && !canSubmit && !canDecide && !canCancel) {
    return <p className="text-xs text-muted">No actions available for your role.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <button type="button" className={buttonClass("ghost")} onClick={() => setEditing((value) => !value)} disabled={pending}>
            {editing ? "Close editor" : "Edit text"}
          </button>
        ) : null}
        {canSubmit ? (
          <button type="button" className={buttonClass("secondary")} disabled={pending} onClick={() => act({ action: "submit" })}>
            Submit for review
          </button>
        ) : null}
        {canDecide ? (
          <>
            <button type="button" className={buttonClass("primary")} disabled={pending} onClick={() => act({ action: "approve" })}>
              Approve
            </button>
            <button type="button" className={buttonClass("danger")} disabled={pending} onClick={() => setRejecting((value) => !value)}>
              {rejecting ? "Close" : "Reject"}
            </button>
          </>
        ) : null}
        {canCancel ? (
          <button type="button" className={buttonClass("ghost")} disabled={pending} onClick={() => act({ action: "cancel" })}>
            Cancel draft
          </button>
        ) : null}
      </div>

      {rejecting ? (
        <form onSubmit={onReject} className="space-y-2">
          <label htmlFor={`reject-${draftId}`} className={labelClass}>
            Reason for rejecting
          </label>
          <input id={`reject-${draftId}`} name="decisionNote" required minLength={3} maxLength={500} className={fieldClass} />
          <button type="submit" disabled={pending} className={buttonClass("danger")}>
            Confirm rejection
          </button>
        </form>
      ) : null}

      {editing ? (
        <form onSubmit={onEdit} className="space-y-3">
          <div>
            <label htmlFor={`subject-${draftId}`} className={labelClass}>
              Subject <span className="font-normal text-muted">(email only)</span>
            </label>
            <input id={`subject-${draftId}`} name="subject" defaultValue={subject ?? ""} maxLength={200} className={fieldClass} />
          </div>
          <div>
            <label htmlFor={`body-${draftId}`} className={labelClass}>
              Message
            </label>
            <textarea id={`body-${draftId}`} name="messageBody" required rows={8} maxLength={3000} defaultValue={messageBody} className={fieldClass} />
          </div>
          <button type="submit" disabled={pending} className={buttonClass("secondary")}>
            Save text
          </button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
