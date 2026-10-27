import { pastedImportSchema } from "@/features/books/schemas/book.schema";
import { previewImport } from "@/features/books/services/book-import.service";
import { assertContentLengthWithin, errorResponse, parseInput } from "@/server/http/route-helpers";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertContentLengthWithin(request, getAppConfig().import.maxSizeBytes);
    const form = await request.formData().catch(() => {
      throw new AppError("INVALID_FORM", "Dữ liệu tải lên không hợp lệ.", 400);
    });

    const file = form.get("file");
    if (file instanceof File) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return Response.json(await previewImport({ kind: "file", fileName: file.name, mimeType: file.type, bytes }));
    }

    const pasted = parseInput(pastedImportSchema, { text: form.get("text"), format: form.get("format") });
    return Response.json(await previewImport({ kind: "text", ...pasted }));
  } catch (error) {
    return errorResponse(error);
  }
}
