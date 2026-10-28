import { getSql } from "@/lib/db/client";
import { jsonOk, withApi } from "@/lib/http/api";

/** Minimal liveness and database reachability. Returns no configuration, versions or error text. */
export const GET = withApi(async (_request, { requestId }) => {
  let database: "ok" | "unavailable" = "unavailable";
  try {
    await getSql()`SELECT 1 AS ok`;
    database = "ok";
  } catch {
    database = "unavailable";
  }

  return jsonOk(
    { status: database === "ok" ? "ok" : "degraded", checks: { database } },
    requestId,
    database === "ok" ? 200 : 503,
  );
});
