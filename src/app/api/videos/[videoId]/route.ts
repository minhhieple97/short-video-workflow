import { updateVideoSchema } from "@/features/videos/schemas/video.schema";
import { deleteVideo, getVideo, updateVideo } from "@/features/videos/services/video.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = RouteContext<{ videoId: string }>;

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { videoId } = await context.params;
    return Response.json(await getVideo(videoId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { videoId } = await context.params;
    return Response.json(await updateVideo(videoId, await readJson(request, updateVideoSchema)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  try {
    const { videoId } = await context.params;
    await deleteVideo(videoId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
