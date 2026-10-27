import { updateBookSchema } from "@/features/books/schemas/book.schema";
import { deleteBook, getBook, updateBook } from "@/features/books/services/book.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = RouteContext<{ bookId: string }>;

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { bookId } = await context.params;
    return Response.json(await getBook(bookId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { bookId } = await context.params;
    return Response.json(await updateBook(bookId, await readJson(request, updateBookSchema)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  try {
    const { bookId } = await context.params;
    await deleteBook(bookId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
