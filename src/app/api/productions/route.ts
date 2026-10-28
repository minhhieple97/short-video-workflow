import { createProductionSchema } from "@/features/productions/schemas/production.schema";
import { requestProduction } from "@/features/productions/services/production-request.service";
import { errorResponse, readJson } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { production, reused } = await requestProduction(await readJson(request, createProductionSchema));
    return Response.json({ ...production, reused }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
