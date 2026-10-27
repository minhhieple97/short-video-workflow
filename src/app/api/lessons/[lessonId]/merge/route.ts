import { mergeLessonSchema } from "@/features/lessons/schemas/lesson.schema";
import { mergeLesson } from "@/features/lessons/services/lesson.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<{ lessonId: string }>): Promise<Response> {
  try {
    const { lessonId } = await context.params;
    const { targetLessonId } = await readJson(request, mergeLessonSchema);
    return Response.json(await mergeLesson(lessonId, targetLessonId));
  } catch (error) {
    return errorResponse(error);
  }
}
