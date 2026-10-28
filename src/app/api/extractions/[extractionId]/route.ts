import { getExtraction } from "@/features/extraction/services/extraction-view.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<{ extractionId: string }>): Promise<Response> {
  try {
    const { extractionId } = await context.params;
    return Response.json(await getExtraction(extractionId));
  } catch (error) {
    return errorResponse(error);
  }
}
