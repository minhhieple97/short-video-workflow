import { findRenderRecord } from "@/features/videos/repositories/render.repository";
import { fileResponse } from "@/server/http/file-response";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";
import { dataPath } from "@/server/storage/paths";
import { NotFoundError } from "@/shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<{ renderId: string }>): Promise<Response> {
  try {
    const { renderId } = await context.params;
    const render = await findRenderRecord(renderId);
    if (render?.status !== "COMPLETED") throw new NotFoundError("RENDER_NOT_FOUND", "Không có bản render hoàn tất.");

    const download = new URL(request.url).searchParams.get("download") === "1";
    return await fileResponse(request, dataPath(render.outputPath), {
      contentType: "video/mp4",
      downloadName: download ? `video-${render.qualityPreset.toLowerCase()}-${render.id.slice(0, 8)}.mp4` : undefined,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
