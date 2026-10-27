import { lessonTextSchema } from "@/features/lessons/schemas/lesson.schema";
import { getLesson, updateLesson } from "@/features/lessons/services/lesson.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = RouteContext<{ lessonId: string }>;

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { lessonId } = await context.params;
    return Response.json(await getLesson(lessonId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { lessonId } = await context.params;
    return Response.json(await updateLesson(lessonId, await readJson(request, lessonTextSchema)));
  } catch (error) {
    return errorResponse(error);
  }
}
