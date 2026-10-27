import { requestBookAnalysis } from "@/features/chapters/services/analysis-request.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(_request: Request, context: RouteContext<{ bookId: string }>): Promise<Response> {
  try {
    const { bookId } = await context.params;
    const { jobs, skipped } = await requestBookAnalysis(bookId);
    return Response.json(
      { jobs: jobs.map((job) => ({ jobId: job.id, status: job.status })), skipped },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
