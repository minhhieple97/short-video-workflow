import { renderRequestSchema } from "@/features/videos/schemas/video.schema";
import { requestRender } from "@/features/videos/services/render-request.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<{ videoId: string }>): Promise<Response> {
  try {
    const { videoId } = await context.params;
    const { quality } = await readJson(request, renderRequestSchema);
    return Response.json(await requestRender(videoId, quality), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
