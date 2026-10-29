import { requestPublishMetadataGeneration } from "@/features/videos/services/publish-request.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(_request: Request, context: RouteContext<{ videoId: string }>): Promise<Response> {
  try {
    const { videoId } = await context.params;
    const job = await requestPublishMetadataGeneration(videoId);
    return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
