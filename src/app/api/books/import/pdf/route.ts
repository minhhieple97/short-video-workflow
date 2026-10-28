import { pdfImportQuerySchema } from "@/features/extraction/schemas/pdf-import.schema";
import { importPdfBook } from "@/features/extraction/services/pdf-import.service";
import { errorResponse, parseInput } from "@/server/http/route-helpers";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

export const runtime = "nodejs";

// The raw PDF is the request body (not multipart), so the browser can stream a File from disk and the server can
// stream it onward without ever holding the whole book in memory. Name and title travel in the query string.
export async function POST(request: Request): Promise<Response> {
  try {
    const query = parseInput(pdfImportQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > getAppConfig().pdf.maxSizeBytes) {
      throw new AppError("FILE_TOO_LARGE", "Tệp PDF vượt quá giới hạn cho phép.", 413);
    }
    if (!request.body) throw new AppError("EMPTY_FILE", "Tệp PDF không có nội dung.", 400);

    const result = await importPdfBook({
      fileName: query.fileName,
      title: query.title,
      body: request.body,
      signal: request.signal,
    });
    return Response.json(result, { status: 202 });
  } catch (error) {
    // The client cancelled the upload: the service already cleaned up and there is nobody left to answer.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return errorResponse(error);
  }
}
