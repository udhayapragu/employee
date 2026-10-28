"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callApi } from "@/lib/http/client";
import { buttonClass, fieldClass, labelClass } from "./ui";

/** `previewLogin` is true only on a Vercel Preview deployment with the temporary sign-in gate open. */
export function LoginForm({ previewLogin = false }: { previewLogin?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onPreviewSignIn() {
    setPending(true);
    setError(null);
    const result = await callApi<{ user: { id: string } }>("/api/auth/preview-login", { method: "POST" });
    if (!result.ok) {
      setError(result.status === 404 ? "Preview sign-in is not available on this deployment." : result.message);
      setPending(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const result = await callApi<{ user: { id: string } }>("/api/auth/login", {
      method: "POST",
      body: { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") },
    });

    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="email" className={labelClass}>
          Work email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className={fieldClass} />
      </div>
      <div>
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          className={fieldClass}
        />
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} w-full`}>
        {pending ? "Signing in..." : "Sign in"}
      </button>
      {previewLogin ? (
        <div className="space-y-2 border-t border-line pt-5">
          <p className="text-xs text-muted">Preview deployment only. Temporary test access, no password.</p>
          <button type="button" disabled={pending} onClick={onPreviewSignIn} className={`${buttonClass("secondary")} w-full`}>
            Continue as the preview test account
          </button>
        </div>
      ) : null}
    </form>
  );
}
