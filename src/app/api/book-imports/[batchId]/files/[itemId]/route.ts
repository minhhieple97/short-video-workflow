import { uploadBookImportFile } from "@/features/book-imports/services/book-import.service";
import { errorResponse } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string; itemId: string }> },
): Promise<Response> {
  try {
    const { batchId, itemId } = await context.params;
    return Response.json(await uploadBookImportFile(batchId, itemId, request), { status: 202 });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return errorResponse(error);
  }
}
