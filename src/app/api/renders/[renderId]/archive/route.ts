import { archiveRenderNow, getRenderArchives } from "@/features/archive/services/archive-control.service";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<{ renderId: string }>): Promise<Response> {
  try {
    const { renderId } = await context.params;
    return Response.json(await getRenderArchives(renderId));
  } catch (error) {
    return errorResponse(error);
  }
}

// Starts the render's archive, or retries what failed; the upload itself runs in the worker.
export async function POST(_request: Request, context: RouteContext<{ renderId: string }>): Promise<Response> {
  try {
    const { renderId } = await context.params;
    return Response.json(await archiveRenderNow(renderId), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
