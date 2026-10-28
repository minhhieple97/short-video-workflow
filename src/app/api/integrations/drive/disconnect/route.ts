import { disconnectDrive } from "@/features/drive/services/drive-connection.service";
import { errorResponse } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    return Response.json(await disconnectDrive());
  } catch (error) {
    return errorResponse(error);
  }
}
