import { getDriveConnectionStatus } from "@/features/drive/services/drive-connection.service";
import { errorResponse } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await getDriveConnectionStatus());
  } catch (error) {
    return errorResponse(error);
  }
}
