import { findMediaAsset } from "@/features/videos/repositories/audio.repository";
import { fileResponse } from "@/server/http/file-response";
import { errorResponse, type RouteContext } from "@/server/http/route-helpers";
import { dataPath } from "@/server/storage/paths";
import { NotFoundError } from "@/shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STREAMABLE_KINDS = new Set(["VOICEOVER", "MUSIC"]);

// Only registered media assets inside DATA_DIR are served — never an arbitrary path from the request.
export async function GET(request: Request, context: RouteContext<{ assetId: string }>): Promise<Response> {
  try {
    const { assetId } = await context.params;
    const asset = await findMediaAsset(assetId);
    if (!asset || !STREAMABLE_KINDS.has(asset.kind))
      throw new NotFoundError("ASSET_NOT_FOUND", "Không tìm thấy tệp âm thanh.");
    return await fileResponse(request, dataPath(asset.path), { contentType: asset.mimeType });
  } catch (error) {
    return errorResponse(error);
  }
}
