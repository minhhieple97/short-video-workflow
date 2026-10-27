import { getBook } from "@/features/books/services/book.service";
import { listChapters } from "@/features/chapters/services/chapter.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<{ bookId: string }>): Promise<Response> {
  try {
    const { bookId } = await context.params;
    await getBook(bookId);
    return Response.json({ chapters: await listChapters(bookId) });
  } catch (error) {
    return errorResponse(error);
  }
}
