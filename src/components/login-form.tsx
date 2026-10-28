"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callApi } from "@/lib/http/client";
import { buttonClass, fieldClass, labelClass } from "./ui";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    </form>
  );
}
