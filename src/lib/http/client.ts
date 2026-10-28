export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; message: string };

interface ErrorBody {
  error?: { message?: string; details?: unknown };
}

/** Client-side fetch helper for the JSON API. Returns a safe message for display, never raw server internals. */
export async function callApi<T>(url: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }

  const json = (await response.json().catch(() => null)) as (T & ErrorBody) | null;
  if (!response.ok) {
    const message = json?.error?.message ?? "Something went wrong. Please try again.";
    return { ok: false, status: response.status, message };
  }
  return { ok: true, status: response.status, data: json as T };
}

export function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}
