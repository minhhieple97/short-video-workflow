import { prisma } from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";

import {
  hasReachedCheckpoint,
  ITEM_CHECKPOINTS,
  nextCheckpoint,
  toItemCheckpoint,
  type ItemCheckpoint,
} from "../domain/production-status";

export interface ProductionItemState {
  videoId: string | null;
  checkpoint: ItemCheckpoint;
  claimToken: string | null;
}

export async function findProductionItemState(itemId: string): Promise<ProductionItemState | null> {
  const item = await prisma.productionItem.findUnique({
    where: { id: itemId },
    select: { videoId: true, checkpoint: true, claimToken: true },
  });
  return item
    ? { videoId: item.videoId, checkpoint: toItemCheckpoint(item.checkpoint), claimToken: item.claimToken }
    : null;
}

// Moves the item exactly one step along the pipeline, and only from the step the caller believes it is at and only while
// the caller still holds it. False means someone else moved it or the claim was lost.
export async function advanceProductionCheckpoint(
  itemId: string,
  claimToken: string,
  from: ItemCheckpoint,
  to: ItemCheckpoint,
): Promise<boolean> {
  if (nextCheckpoint(from) !== to) throw new Error(`${from} is not directly followed by ${to}`);
  const { count } = await prisma.productionItem.updateMany({
    where: { id: itemId, claimToken, checkpoint: from },
    data: { checkpoint: to },
  });
  return count > 0;
}

export type SpendCorrectionResult =
  { status: "SPENT" } | { status: "ALREADY_SPENT" } | { status: "LOST_CLAIM" } | { status: "WOULD_MOVE_FORWARD" };

// Uses the item's one AI correction and sends it back to the step that will redo the work. A single conditional UPDATE
// decides it: only the holder, only while the correction is unused, and only moving the checkpoint backwards or leaving it
// where it is. Of any number of simultaneous callers exactly one gets SPENT.
export async function spendAiCorrection(input: {
  itemId: string;
  claimToken: string;
  target: string;
  note: string;
  rewindTo: ItemCheckpoint;
}): Promise<SpendCorrectionResult> {
  return prisma.$transaction(async (tx): Promise<SpendCorrectionResult> => {
    const reachable = ITEM_CHECKPOINTS.filter((checkpoint) => hasReachedCheckpoint(checkpoint, input.rewindTo));
    const { count } = await tx.productionItem.updateMany({
      where: {
        id: input.itemId,
        claimToken: input.claimToken,
        aiCorrectionTarget: null,
        checkpoint: { in: [...reachable] },
      },
      data: { aiCorrectionTarget: input.target, aiCorrectionNote: input.note, checkpoint: input.rewindTo },
    });
    if (count > 0) {
      const item = await tx.productionItem.findUniqueOrThrow({
        where: { id: input.itemId },
        select: { scriptGenerationRunId: true, video: { select: { scriptVersion: true } } },
      });
      if (item.scriptGenerationRunId) {
        const previous = await tx.scriptGenerationRun.findUniqueOrThrow({ where: { id: item.scriptGenerationRunId } });
        const next = await tx.scriptGenerationRun.create({
          data: {
            ownerKey: `${previous.ownerKey}:correction`,
            videoId: previous.videoId,
            baseScriptVersion: item.video?.scriptVersion ?? previous.baseScriptVersion,
            settingsJson: previous.settingsJson as Prisma.InputJsonValue,
            inputJson: previous.inputJson as Prisma.InputJsonValue,
            sourcePackJson:
              previous.sourcePackJson === null ? Prisma.DbNull : (previous.sourcePackJson as Prisma.InputJsonValue),
            castJson: previous.castJson === null ? Prisma.DbNull : (previous.castJson as Prisma.InputJsonValue),
            ...(input.target === "SCENE_COMPILER" && previous.draftArtifactJson !== null
              ? { draftArtifactJson: previous.draftArtifactJson as Prisma.InputJsonValue }
              : {}),
          },
        });
        await tx.productionItem.update({ where: { id: input.itemId }, data: { scriptGenerationRunId: next.id } });
      }
      return { status: "SPENT" };
    }

    const item = await tx.productionItem.findUnique({
      where: { id: input.itemId },
      select: { claimToken: true, aiCorrectionTarget: true },
    });
    if (!item || item.claimToken !== input.claimToken) return { status: "LOST_CLAIM" };
    return item.aiCorrectionTarget !== null ? { status: "ALREADY_SPENT" } : { status: "WOULD_MOVE_FORWARD" };
  });
}
