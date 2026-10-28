import { z } from "zod";
import { requireApiUser } from "@/lib/auth/access";
import { getSql } from "@/lib/db/client";
import { jsonOk, withApi } from "@/lib/http/api";
import { listResearchJobs } from "@/lib/research/jobs-repository";

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = withApi(async (request, { requestId }) => {
  await requireApiUser(request, "research:view");
  const paging = pagingSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const result = await listResearchJobs(getSql(), paging.page, paging.pageSize);
  return jsonOk({ ...result, page: paging.page, pageSize: paging.pageSize }, requestId);
});
