import { createBookImportSchema } from "@/features/book-imports/schemas/book-import.schema";
import { requestBookImport, getBookImports } from "@/features/book-imports/services/book-import.service";
import { errorResponse, readJson } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    return Response.json(await requestBookImport(await readJson(request, createBookImportSchema)), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(): Promise<Response> {
  try {
    return Response.json(await getBookImports());
  } catch (error) {
    return errorResponse(error);
  }
}
