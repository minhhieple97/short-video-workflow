import { requestMissingTts } from "@/features/videos/services/audio-request.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(_request: Request, context: RouteContext<{ videoId: string }>): Promise<Response> {
  try {
    const { videoId } = await context.params;
    const jobs = await requestMissingTts(videoId);
    return Response.json({ jobs: jobs.map((job) => ({ jobId: job.id, status: job.status })) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
