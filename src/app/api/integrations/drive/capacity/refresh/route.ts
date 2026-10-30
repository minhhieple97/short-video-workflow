import { refreshDriveStorage } from "@/features/drive/services/drive-storage.service";
import { errorResponse } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  try {
    return Response.json(await refreshDriveStorage());
  } catch (error) {
    return errorResponse(error);
  }
}
