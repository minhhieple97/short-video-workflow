import { bookAnalysisRequestSchema } from "@/features/chapters/schemas/chapter.schema";
import { requestBookAnalysis } from "@/features/chapters/services/analysis-request.service";
import { errorResponse, readOptionalJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<{ bookId: string }>): Promise<Response> {
  try {
    const { bookId } = await context.params;
    const { chapterIds } = await readOptionalJson(request, bookAnalysisRequestSchema);
    const { jobs, skipped } = await requestBookAnalysis(bookId, chapterIds);
    return Response.json(
      { jobs: jobs.map((job) => ({ jobId: job.id, status: job.status })), skipped },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
