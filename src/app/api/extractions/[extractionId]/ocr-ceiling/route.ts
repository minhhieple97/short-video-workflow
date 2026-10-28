import { ocrCeilingInputSchema } from "@/features/extraction/schemas/extraction.schema";
import { updateOcrCeiling } from "@/features/extraction/services/extraction-control.service";
import { errorResponse, readJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: RouteContext<{ extractionId: string }>): Promise<Response> {
  try {
    const { extractionId } = await context.params;
    const { ceilingUsd } = await readJson(request, ocrCeilingInputSchema);
    return Response.json(await updateOcrCeiling(extractionId, ceilingUsd));
  } catch (error) {
    return errorResponse(error);
  }
}
