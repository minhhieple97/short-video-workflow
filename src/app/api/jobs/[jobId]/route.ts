import { getJob } from "@/features/jobs/services/job-service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<{ jobId: string }>): Promise<Response> {
  try {
    const { jobId } = await context.params;
    return Response.json(await getJob(jobId));
  } catch (error) {
    return errorResponse(error);
  }
}
