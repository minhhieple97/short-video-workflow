import { requestChapterAnalysis } from "@/features/chapters/services/analysis-request.service";
import { analyzeChapterRequestSchema } from "@/features/lessons/schemas/lesson.schema";
import { errorResponse, readOptionalJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<{ chapterId: string }>): Promise<Response> {
  try {
    const { chapterId } = await context.params;
    const { force } = await readOptionalJson(request, analyzeChapterRequestSchema);
    const job = await requestChapterAnalysis(chapterId, force);
    return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
