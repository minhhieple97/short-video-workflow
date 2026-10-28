import { prisma } from "@/server/db/client";

import { nextCheckpoint, toItemCheckpoint, type ItemCheckpoint } from "../domain/production-status";

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
