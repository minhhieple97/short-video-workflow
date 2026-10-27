import { getBook } from "@/features/books/services/book.service";
import { createManualLessonSchema, lessonFilterSchema } from "@/features/lessons/schemas/lesson.schema";
import { createManualLesson, listLessons } from "@/features/lessons/services/lesson.service";
import { errorResponse, parseInput, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = RouteContext<{ bookId: string }>;

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { bookId } = await context.params;
    await getBook(bookId);
    const filter = parseInput(lessonFilterSchema, Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ lessons: await listLessons(bookId, filter) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { bookId } = await context.params;
    await getBook(bookId);
    const lesson = await createManualLesson(bookId, await readJson(request, createManualLessonSchema));
    return Response.json(lesson, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
