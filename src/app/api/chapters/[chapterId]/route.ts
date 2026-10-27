import { renameChapterSchema } from "@/features/chapters/schemas/chapter.schema";
import { getChapter, renameChapter } from "@/features/chapters/services/chapter.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = RouteContext<{ chapterId: string }>;

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { chapterId } = await context.params;
    return Response.json(await getChapter(chapterId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { chapterId } = await context.params;
    return Response.json(await renameChapter(chapterId, await readJson(request, renameChapterSchema)));
  } catch (error) {
    return errorResponse(error);
  }
}
