import { z } from "zod";

/**
 * Temporary, preview-only sign-in without a password, for testing a Vercel Preview deployment.
 *
 * It is enabled only when all of these hold:
 * - VERCEL_ENV is exactly "preview". Production never enables it, whatever else is set.
 * - PREVIEW_PASSWORDLESS_LOGIN is "1".
 * - PREVIEW_LOGIN_EMAIL is a valid address. The account it names must already exist and be active.
 * - PREVIEW_PASSWORDLESS_UNTIL is a future ISO date, so the access expires on its own.
 *
 * Passwords are never read or changed. Reasons name variables only, never their values.
 */
export type PreviewLoginConfig = { enabled: true; email: string; until: Date } | { enabled: false; reason: string };

export function previewLoginConfig(
  source: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): PreviewLoginConfig {
  if (source.VERCEL_ENV !== "preview") {
    return { enabled: false, reason: "this is not a Vercel Preview deployment" };
  }
  if (source.PREVIEW_PASSWORDLESS_LOGIN !== "1") {
    return { enabled: false, reason: "PREVIEW_PASSWORDLESS_LOGIN is not 1" };
  }

  const email = z.email().max(254).safeParse(source.PREVIEW_LOGIN_EMAIL?.trim().toLowerCase());
  if (!email.success) {
    return { enabled: false, reason: "PREVIEW_LOGIN_EMAIL is missing or invalid" };
  }

  const expiry = source.PREVIEW_PASSWORDLESS_UNTIL;
  const until = expiry ? new Date(expiry) : null;
  if (!until || Number.isNaN(until.getTime())) {
    return { enabled: false, reason: "PREVIEW_PASSWORDLESS_UNTIL is missing or not a date" };
  }
  if (until.getTime() <= now.getTime()) {
    return { enabled: false, reason: "PREVIEW_PASSWORDLESS_UNTIL has passed" };
  }

  return { enabled: true, email: email.data, until };
}
