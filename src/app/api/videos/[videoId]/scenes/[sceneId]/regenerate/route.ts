import { requestSceneRegeneration } from "@/features/videos/services/script-request.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: RouteContext<{ videoId: string; sceneId: string }>,
): Promise<Response> {
  try {
    const { videoId, sceneId } = await context.params;
    const job = await requestSceneRegeneration(videoId, sceneId);
    return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
