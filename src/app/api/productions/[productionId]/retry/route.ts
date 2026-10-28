import { productionItemTargetSchema } from "@/features/productions/schemas/production.schema";
import { retryProduction } from "@/features/productions/services/production-control.service";
import { errorResponse, readOptionalJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<{ productionId: string }>): Promise<Response> {
  try {
    const { productionId } = await context.params;
    const { itemId } = await readOptionalJson(request, productionItemTargetSchema);
    return Response.json(await retryProduction(productionId, itemId), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
