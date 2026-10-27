import { cancelJob } from "@/features/jobs/services/job-control.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(_request: Request, context: RouteContext<{ jobId: string }>): Promise<Response> {
  try {
    const { jobId } = await context.params;
    return Response.json(await cancelJob(jobId));
  } catch (error) {
    return errorResponse(error);
  }
}
