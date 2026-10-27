import { listRenders, preflightFor } from "@/features/videos/services/render.service";
import { getVideo } from "@/features/videos/services/video.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<{ videoId: string }>): Promise<Response> {
  try {
    const { videoId } = await context.params;
    const video = await getVideo(videoId);
    return Response.json({
      renders: await listRenders(videoId),
      preflight: { draft: preflightFor(video, "DRAFT"), final: preflightFor(video, "FINAL") },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
