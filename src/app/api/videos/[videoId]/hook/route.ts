import { selectHookSchema } from "@/features/videos/schemas/video.schema";
import { selectHookOption } from "@/features/videos/services/script-editing.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<{ videoId: string }>): Promise<Response> {
  try {
    const { videoId } = await context.params;
    const { optionIndex } = await readJson(request, selectHookSchema);
    return Response.json(await selectHookOption(videoId, optionIndex));
  } catch (error) {
    return errorResponse(error);
  }
}
