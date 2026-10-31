import { getBookDriveLinks } from "@/features/archive/services/book-drive-links.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<{ bookId: string }>): Promise<Response> {
  try {
    const { bookId } = await context.params;
    return Response.json(await getBookDriveLinks(bookId));
  } catch (error) {
    return errorResponse(error);
  }
}
