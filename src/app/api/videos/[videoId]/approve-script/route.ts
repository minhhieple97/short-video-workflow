import { approveScript } from "@/features/videos/services/video.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(_request: Request, context: RouteContext<{ videoId: string }>): Promise<Response> {
  try {
    const { videoId } = await context.params;
    return Response.json(await approveScript(videoId));
  } catch (error) {
    return errorResponse(error);
  }
}
