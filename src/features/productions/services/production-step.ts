import { AppError, NotFoundError } from "@/shared/errors";

import type { ItemCheckpoint } from "../domain/production-status";
import { findProductionItemState } from "../repositories/production-step.repository";

// What every pipeline step checks before touching an item: it exists, the caller still holds it, and it has a video.
export async function requireHeldProductionItem(
  itemId: string,
  claimToken: string,
): Promise<{ videoId: string; checkpoint: ItemCheckpoint }> {
  const item = await findProductionItemState(itemId);
  if (!item) throw new NotFoundError("PRODUCTION_ITEM_NOT_FOUND", "Không tìm thấy mục sản xuất.");
  if (item.claimToken !== claimToken) {
    throw new AppError("PRODUCTION_CLAIM_LOST", "Mục sản xuất này không còn được bạn giữ; dừng bước này.", 409);
  }
  if (!item.videoId) throw new AppError("PRODUCTION_ITEM_HAS_NO_VIDEO", "Mục sản xuất chưa có video.", 409);
  return { videoId: item.videoId, checkpoint: item.checkpoint };
}

export function outOfOrder(checkpoint: ItemCheckpoint, message: string): AppError {
  return new AppError("PRODUCTION_STEP_OUT_OF_ORDER", message, 409, { details: { checkpoint } });
}
