import { updateSceneSchema } from "@/features/videos/schemas/video.schema";
import { deleteScene, updateScene } from "@/features/videos/services/script-editing.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

type Context = RouteContext<{ videoId: string; sceneId: string }>;

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { videoId, sceneId } = await context.params;
    return Response.json(await updateScene(videoId, sceneId, await readJson(request, updateSceneSchema)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  try {
    const { videoId, sceneId } = await context.params;
    return Response.json(await deleteScene(videoId, sceneId));
  } catch (error) {
    return errorResponse(error);
  }
}
