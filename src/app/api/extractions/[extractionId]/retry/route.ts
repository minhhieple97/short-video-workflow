import { retryExtraction } from "@/features/extraction/services/extraction-retry.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: RouteContext<{ extractionId: string }>): Promise<Response> {
  try {
    const { extractionId } = await context.params;
    return Response.json(await retryExtraction(extractionId), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
