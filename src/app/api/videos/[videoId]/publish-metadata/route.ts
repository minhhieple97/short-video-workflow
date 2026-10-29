import { publishMetadataSchema } from "@/features/videos/domain/publish-metadata";
import { savePublishMetadata } from "@/features/videos/services/publish-request.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function PUT(request: Request, context: RouteContext<{ videoId: string }>): Promise<Response> {
  try {
    const { videoId } = await context.params;
    const video = await savePublishMetadata(videoId, await readJson(request, publishMetadataSchema));
    return Response.json(video.publish);
  } catch (error) {
    return errorResponse(error);
  }
}
