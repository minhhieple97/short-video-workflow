import { requestSceneTts } from "@/features/videos/services/audio-request.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(_request: Request, context: RouteContext<{ sceneId: string }>): Promise<Response> {
  try {
    const { sceneId } = await context.params;
    const job = await requestSceneTts(sceneId);
    return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
