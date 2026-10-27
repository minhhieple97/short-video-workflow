import { listBooks } from "@/features/books/services/book.service";
import { errorResponse } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams.get("q") ?? undefined;
    return Response.json({ books: await listBooks(query) });
  } catch (error) {
    return errorResponse(error);
  }
}
