import { bookImportActionSchema } from "@/features/book-imports/schemas/book-import.schema";
import { beginBookImport, getBookImport } from "@/features/book-imports/services/book-import.service";
import { controlBookImport } from "@/features/book-imports/services/book-import-control.service";
import { errorResponse, readJson } from "@/server/http/route-helpers";

export const runtime = "nodejs";
type Context = { params: Promise<{ batchId: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    return Response.json(await getBookImport((await context.params).batchId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { action } = await readJson(request, bookImportActionSchema);
    const { batchId } = await context.params;
    return Response.json(
      action === "start" ? await beginBookImport(batchId) : await controlBookImport(batchId, action),
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
