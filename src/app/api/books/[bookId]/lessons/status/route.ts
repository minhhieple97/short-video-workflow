import { getBook } from "@/features/books/services/book.service";
import { bulkLessonStatusSchema } from "@/features/lessons/schemas/lesson.schema";
import { changeLessonStatuses } from "@/features/lessons/services/lesson.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<{ bookId: string }>): Promise<Response> {
  try {
    const { bookId } = await context.params;
    await getBook(bookId);
    const { lessonIds, status } = await readJson(request, bulkLessonStatusSchema);
    return Response.json(await changeLessonStatuses(bookId, lessonIds, status));
  } catch (error) {
    return errorResponse(error);
  }
}
