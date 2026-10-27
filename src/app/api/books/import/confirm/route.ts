import { confirmImportSchema } from "@/features/books/schemas/book.schema";
import { confirmImport } from "@/features/books/services/book-import.service";
import { errorResponse, readJson } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readJson(request, confirmImportSchema);
    return Response.json(await confirmImport(input), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
