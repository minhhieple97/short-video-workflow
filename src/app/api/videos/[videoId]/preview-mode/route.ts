import { previewModeSchema } from "@/features/videos/schemas/video.schema";
import { updatePreviewMode } from "@/features/videos/services/video.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function PUT(request: Request, context: RouteContext<{ videoId: string }>): Promise<Response> {
  try {
    const { videoId } = await context.params;
    const { platformPreviewMode } = await readJson(request, previewModeSchema);
    await updatePreviewMode(videoId, platformPreviewMode);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
