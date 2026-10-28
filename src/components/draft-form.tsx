"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { OUTREACH_CHANNELS, OUTREACH_LANGUAGES } from "@/lib/config/domain";
import { callApi } from "@/lib/http/client";
import { buttonClass, fieldClass, labelClass, Notice } from "./ui";

const CHANNEL_LABELS: Record<(typeof OUTREACH_CHANNELS)[number], string> = {
  email: "Email",
  whatsapp: "WhatsApp message (draft only)",
  call_script: "Call script for a sales representative",
};

export function DraftForm({ leadId, aiAvailable }: { leadId: string; aiAvailable: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setCreated(null);

    const result = await callApi<{ draft: { generationMode: "template" | "ai" } }>("/api/outreach/drafts", {
      method: "POST",
      body: {
        leadId,
        channel: String(form.get("channel")),
        language: String(form.get("language")),
        useAi: form.get("useAi") === "on",
      },
    });
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCreated(result.data.draft.generationMode === "ai" ? "AI draft created. Review it before submitting." : "Template draft created. Review it before submitting.");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="draft-channel" className={labelClass}>
          Channel
        </label>
        <select id="draft-channel" name="channel" defaultValue="email" className={fieldClass} disabled={pending}>
          {OUTREACH_CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {CHANNEL_LABELS[channel]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="draft-language" className={labelClass}>
          Language
        </label>
        <select id="draft-language" name="language" defaultValue="en" className={fieldClass} disabled={pending}>
          {OUTREACH_LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" name="useAi" disabled={!aiAvailable || pending} className="h-4 w-4 accent-[var(--color-brand)]" />
          Use AI drafting
        </label>
        {!aiAvailable ? <span className="text-xs text-muted">AI is not configured, so template text is used.</span> : null}
      </div>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Creating..." : "Create draft"}
        </button>
        <p className="text-xs text-muted">Nothing is sent. Drafts need review and approval first.</p>
      </div>
      {error ? (
        <p role="alert" className="sm:col-span-2 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {created ? <Notice tone="success">{created}</Notice> : null}
    </form>
  );
}
