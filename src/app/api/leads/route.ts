import { requireApiUser } from "@/lib/auth/access";
import { getSql } from "@/lib/db/client";
import { jsonOk, withApi } from "@/lib/http/api";
import { parseLeadListQuery } from "@/lib/leads/query";
import { listLeads } from "@/lib/leads/repository";

export const GET = withApi(async (request, { requestId }) => {
  await requireApiUser(request, "lead:read");

  const parsed = parseLeadListQuery(new URL(request.url).searchParams);
  if (!parsed.success) throw parsed.error;

  const result = await listLeads(getSql(), parsed.data);
  return jsonOk(
    { items: result.items, total: result.total, page: parsed.data.page, pageSize: parsed.data.pageSize },
    requestId,
  );
});
