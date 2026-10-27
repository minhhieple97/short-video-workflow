import { listJobsForDashboard } from "@/features/jobs/services/job-dashboard.service";
import { errorResponse } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ jobs: await listJobsForDashboard() });
  } catch (error) {
    return errorResponse(error);
  }
}
