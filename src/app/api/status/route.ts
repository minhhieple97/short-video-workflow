import { getSystemStatus } from "@/features/jobs/services/system-status.service";
import { errorResponse } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await getSystemStatus());
  } catch (error) {
    return errorResponse(error);
  }
}
