import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

const RUN_INCLUDE = {
  batch: { select: { bookId: true, book: { select: { title: true, author: true } } } },
  video: {
    select: {
      id: true,
      minDurationSec: true,
      maxDurationSec: true,
      videoLessons: { orderBy: { position: "asc" }, take: 1, select: { lessonSnapshotJson: true } },
    },
  },
} as const satisfies Prisma.ProductionItemInclude;

export type ProductionItemForRun = Prisma.ProductionItemGetPayload<{ include: typeof RUN_INCLUDE }>;

export function findProductionItemForRun(itemId: string): Promise<ProductionItemForRun | null> {
  return prisma.productionItem.findUnique({ where: { id: itemId }, include: RUN_INCLUDE });
}

// Each artifact is stored by a conditional update that also moves the checkpoint: only the holder, only from the step
// that produces it. False means the item is no longer where the caller thought it was. The draft's proposed length lands
// on the video in the same transaction, so it changes only if this caller still holds the item.
export async function saveDraftArtifact(
  itemId: string,
  claimToken: string,
  artifact: Prisma.InputJsonObject,
  proposal: { videoId: string; targetDurationSec: number; durationReason: string },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.productionItem.updateMany({
      where: { id: itemId, claimToken, checkpoint: "NONE" },
      data: { draftArtifactJson: artifact, checkpoint: "DRAFTED" },
    });
    if (count === 0) return false;
    await tx.video.update({
      where: { id: proposal.videoId },
      data: { targetDurationSec: proposal.targetDurationSec, durationReason: proposal.durationReason },
    });
    return true;
  });
}

export async function saveScenePlanArtifact(
  itemId: string,
  claimToken: string,
  artifact: Prisma.InputJsonObject,
): Promise<boolean> {
  const { count } = await prisma.productionItem.updateMany({
    where: { id: itemId, claimToken, checkpoint: "DRAFTED" },
    data: { scenePlanArtifactJson: artifact, checkpoint: "COMPILED" },
  });
  return count > 0;
}

// Counts a temporary failure and keeps its reason, so the progress page can say why the item is waiting.
export async function recordTransientFailure(
  itemId: string,
  claimToken: string,
  failure: { code: string; message: string },
): Promise<number> {
  await prisma.productionItem.updateMany({
    where: { id: itemId, claimToken },
    data: { transientRetries: { increment: 1 }, errorCode: failure.code, errorMessage: failure.message },
  });
  const item = await prisma.productionItem.findUnique({ where: { id: itemId }, select: { transientRetries: true } });
  return item?.transientRetries ?? 0;
}

// The item moved on, so the last temporary failure no longer explains anything.
export async function clearTransientRetries(itemId: string, claimToken: string): Promise<void> {
  await prisma.productionItem.updateMany({
    where: { id: itemId, claimToken, transientRetries: { gt: 0 } },
    data: { transientRetries: 0, errorCode: null, errorMessage: null },
  });
}

export async function setItemRender(itemId: string, claimToken: string, renderId: string | null): Promise<boolean> {
  const { count } = await prisma.productionItem.updateMany({ where: { id: itemId, claimToken }, data: { renderId } });
  return count > 0;
}
