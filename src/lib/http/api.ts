import { randomUUID } from "node:crypto";
import { z, ZodError, type ZodType } from "zod";
import { ConfigError } from "@/lib/config/env";
import { DatabaseNotConfiguredError } from "@/lib/db/client";
import { logEvent, redactText } from "@/lib/log/logger";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiContext<P> {
  params: P;
  requestId: string;
}

const MAX_BODY_BYTES = 16 * 1024;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

function errorResponse(status: number, code: string, message: string, requestId: string, details?: unknown): Response {
  return jsonResponse({ error: { code, message, requestId, ...(details === undefined ? {} : { details }) } }, status, requestId);
}

/** Converts any thrown value into a safe HTTP response. Internal details are logged, never returned. */
function toErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ApiError) {
    return errorResponse(error.status, error.code, error.message, requestId, error.details);
  }
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    return errorResponse(400, "validation_error", "The request is invalid.", requestId, details);
  }
  if (error instanceof DatabaseNotConfiguredError || error instanceof ConfigError) {
    logEvent("error", "config.unavailable", { requestId, errorName: error.name });
    return errorResponse(503, "service_unavailable", "This service is not available on this server right now.", requestId);
  }

  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? redactText(error.message).slice(0, 200) : "";
  logEvent("error", "http.unhandled_error", { requestId, errorName: name, errorMessage: message });
  return errorResponse(500, "internal_error", "Something went wrong. Please try again.", requestId);
}

/**
 * Wraps a route handler with request IDs, structured logging and safe error mapping.
 * Route handlers throw ApiError for expected failures; anything else becomes a generic 500.
 */
export function withApi<P extends Record<string, string> = Record<string, string>>(
  handler: (request: Request, context: ApiContext<P>) => Promise<Response>,
) {
  return async (request: Request, routeContext?: { params?: Promise<P> }): Promise<Response> => {
    const incomingId = request.headers.get("x-request-id") ?? "";
    const requestId = REQUEST_ID_PATTERN.test(incomingId) ? incomingId : randomUUID();
    const started = Date.now();
    const path = new URL(request.url).pathname;

    let response: Response;
    try {
      const params = (routeContext?.params ? await routeContext.params : {}) as P;
      response = await handler(request, { params, requestId });
    } catch (error) {
      response = toErrorResponse(error, requestId);
    }

    logEvent("info", "http.request", {
      requestId,
      method: request.method,
      path,
      status: response.status,
      durationMs: Date.now() - started,
    });
    return response;
  };
}

export function jsonOk<T>(body: T, requestId: string, status = 200): Response {
  return jsonResponse(body, status, requestId);
}

/** Reads and validates a JSON body. Rejects non-JSON content types, oversized bodies and malformed JSON. */
export async function parseJsonBody<S extends ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send the request body as application/json.");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "The request body is too large.");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "The request body is too large.");
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
  return schema.parse(json);
}
