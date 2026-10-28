import { startDriveConnection } from "@/features/drive/services/drive-connection.service";
import { errorResponse } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return Response.json(await startDriveConnection(request.url));
  } catch (error) {
    return errorResponse(error);
  }
}
