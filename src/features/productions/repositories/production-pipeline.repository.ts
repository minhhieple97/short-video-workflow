import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

const RUN_INCLUDE = {
  batch: { select: { bookId: true, targetDurationSec: true } },
  video: {
    select: {
      id: true,
      videoLessons: { orderBy: { position: "asc" }, take: 1, select: { lessonSnapshotJson: true } },
    },
  },
} as const satisfies Prisma.ProductionItemInclude;

export type ProductionItemForRun = Prisma.ProductionItemGetPayload<{ include: typeof RUN_INCLUDE }>;

export function findProductionItemForRun(itemId: string): Promise<ProductionItemForRun | null> {
  return prisma.productionItem.findUnique({ where: { id: itemId }, include: RUN_INCLUDE });
}

// Stores an artifact and moves the checkpoint in one conditional update: only the holder, only from the step that
// produces it. False means the item is no longer where the caller thought it was.
async function saveArtifact(
  itemId: string,
  claimToken: string,
  from: "NONE" | "DRAFTED",
  to: "DRAFTED" | "COMPILED",
  data: Prisma.ProductionItemUpdateManyMutationInput,
): Promise<boolean> {
  const { count } = await prisma.productionItem.updateMany({
    where: { id: itemId, claimToken, checkpoint: from },
    data: { ...data, checkpoint: to },
  });
  return count > 0;
}

export const saveDraftArtifact = (itemId: string, claimToken: string, artifact: Prisma.InputJsonObject) =>
  saveArtifact(itemId, claimToken, "NONE", "DRAFTED", { draftArtifactJson: artifact });

export const saveScenePlanArtifact = (itemId: string, claimToken: string, artifact: Prisma.InputJsonObject) =>
  saveArtifact(itemId, claimToken, "DRAFTED", "COMPILED", { scenePlanArtifactJson: artifact });

export async function recordTransientFailure(itemId: string, claimToken: string): Promise<number> {
  await prisma.productionItem.updateMany({
    where: { id: itemId, claimToken },
    data: { transientRetries: { increment: 1 } },
  });
  const item = await prisma.productionItem.findUnique({ where: { id: itemId }, select: { transientRetries: true } });
  return item?.transientRetries ?? 0;
}

export async function clearTransientRetries(itemId: string, claimToken: string): Promise<void> {
  await prisma.productionItem.updateMany({ where: { id: itemId, claimToken }, data: { transientRetries: 0 } });
}

export async function setItemRender(itemId: string, claimToken: string, renderId: string | null): Promise<boolean> {
  const { count } = await prisma.productionItem.updateMany({ where: { id: itemId, claimToken }, data: { renderId } });
  return count > 0;
}
