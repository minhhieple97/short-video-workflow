import { getDiagnosticsSnapshot } from "@/server/diagnostics/get-diagnostics-snapshot";
import { errorResponse } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await getDiagnosticsSnapshot());
  } catch (error) {
    return errorResponse(error);
  }
}
