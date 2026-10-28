import { replaceScriptWithin, type ReplacementScript } from "@/features/videos/repositories/video.repository";
import { prisma } from "@/server/db/client";

import { hasReachedCheckpoint, toItemCheckpoint, type ItemCheckpoint } from "../domain/production-status";

export type ApplyScenePlanResult =
  | { status: "APPLIED" }
  | { status: "ALREADY_APPLIED" }
  | { status: "LOST_CLAIM" }
  | { status: "NOT_READY"; checkpoint: ItemCheckpoint }
  | { status: "NO_VIDEO" }
  | { status: "MISSING_ITEM" };

// Puts the compiled scenes on the item's video exactly once. The conditional UPDATE comes first, so the transaction takes
// the write lock before reading anything and of many callers one wins; it only matches an item that the caller holds, that
// has a video and that stands at COMPILED. Everything else is classified afterwards without writing a scene, which is
// what keeps a replay from rebuilding the scenes and throwing away the audio already attached to them.
export function applyScenePlanOnce(input: {
  itemId: string;
  claimToken: string;
  planFingerprint: string;
  script: ReplacementScript;
}): Promise<ApplyScenePlanResult> {
  const { itemId, claimToken, planFingerprint, script } = input;
  return prisma.$transaction(async (tx): Promise<ApplyScenePlanResult> => {
    const { count } = await tx.productionItem.updateMany({
      where: { id: itemId, claimToken, checkpoint: "COMPILED", videoId: { not: null } },
      data: { checkpoint: "APPLIED", appliedPlanFingerprint: planFingerprint },
    });
    const item = await tx.productionItem.findUnique({
      where: { id: itemId },
      select: { videoId: true, checkpoint: true, claimToken: true, appliedPlanFingerprint: true },
    });
    if (!item) return { status: "MISSING_ITEM" };

    if (count === 1 && item.videoId) {
      await replaceScriptWithin(tx, item.videoId, script);
      return { status: "APPLIED" };
    }
    if (item.claimToken !== claimToken) return { status: "LOST_CLAIM" };
    if (!item.videoId) return { status: "NO_VIDEO" };

    const checkpoint = toItemCheckpoint(item.checkpoint);
    if (hasReachedCheckpoint(checkpoint, "APPLIED") && item.appliedPlanFingerprint === planFingerprint) {
      return { status: "ALREADY_APPLIED" };
    }
    return { status: "NOT_READY", checkpoint };
  });
}
