import { getProduction } from "@/features/productions/services/production-request.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<{ productionId: string }>): Promise<Response> {
  try {
    const { productionId } = await context.params;
    return Response.json(await getProduction(productionId));
  } catch (error) {
    return errorResponse(error);
  }
}
