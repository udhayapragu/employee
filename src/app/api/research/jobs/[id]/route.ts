import { z } from "zod";
import { requireApiUser } from "@/lib/auth/access";
import { getSql } from "@/lib/db/client";
import { ApiError, jsonOk, withApi } from "@/lib/http/api";
import { listLeads } from "@/lib/leads/repository";
import { getResearchJob } from "@/lib/research/jobs-repository";

export const GET = withApi<{ id: string }>(async (request, { params, requestId }) => {
  await requireApiUser(request, "research:view");
  const jobId = z.uuid().parse(params.id);
  const sql = getSql();

  const job = await getResearchJob(sql, jobId);
  if (!job) throw new ApiError(404, "not_found", "Research job not found.");

  const leads = await listLeads(sql, {
    filters: {
      category: null,
      state: null,
      normalizedCity: null,
      verification: null,
      status: null,
      namePattern: null,
      researchJobId: jobId,
      duplicatesOnly: false,
    },
    sort: "company_name",
    order: "asc",
    page: 1,
    pageSize: 50,
  });

  return jsonOk({ job, leads: leads.items, leadsTotal: leads.total }, requestId);
});
