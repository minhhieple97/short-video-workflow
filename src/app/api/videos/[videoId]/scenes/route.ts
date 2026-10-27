import { addSceneSchema, reorderScenesSchema } from "@/features/videos/schemas/video.schema";
import { addScene, reorderScenes } from "@/features/videos/services/script-editing.service";
import { getVideo } from "@/features/videos/services/video.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = RouteContext<{ videoId: string }>;

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { videoId } = await context.params;
    return Response.json({ scenes: (await getVideo(videoId)).scenes });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { videoId } = await context.params;
    return Response.json(await addScene(videoId, await readJson(request, addSceneSchema)), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { videoId } = await context.params;
    const { sceneIds } = await readJson(request, reorderScenesSchema);
    return Response.json(await reorderScenes(videoId, sceneIds));
  } catch (error) {
    return errorResponse(error);
  }
}
