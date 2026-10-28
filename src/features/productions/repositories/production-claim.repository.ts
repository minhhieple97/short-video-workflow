import { prisma } from "@/server/db/client";

// Only an item that is still in progress, and that nobody currently holds, can be claimed. A lease that has run out
// counts as not held, so a worker that died mid-step does not block the item forever.
export async function claimProductionItem(
  itemId: string,
  claimToken: string,
  leaseMs: number,
  now: Date = new Date(),
): Promise<boolean> {
  const { count } = await prisma.productionItem.updateMany({
    where: {
      id: itemId,
      status: { in: ["PENDING", "WAITING", "RUNNING"] },
      OR: [{ claimToken: null }, { claimExpiresAt: { lt: now } }],
    },
    data: { claimToken, claimExpiresAt: new Date(now.getTime() + leaseMs), status: "RUNNING" },
  });
  return count > 0;
}

// Extends a lease the caller still holds; false means it was lost (expired and taken over) and the caller must stop.
export async function renewProductionClaim(
  itemId: string,
  claimToken: string,
  leaseMs: number,
  now: Date = new Date(),
): Promise<boolean> {
  const { count } = await prisma.productionItem.updateMany({
    where: { id: itemId, claimToken, claimExpiresAt: { gte: now } },
    data: { claimExpiresAt: new Date(now.getTime() + leaseMs) },
  });
  return count > 0;
}

// Gives the item up and records where it stands. Only the current holder can do this.
export async function releaseProductionClaim(
  itemId: string,
  claimToken: string,
  nextStatus: "PENDING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED",
): Promise<boolean> {
  const { count } = await prisma.productionItem.updateMany({
    where: { id: itemId, claimToken },
    data: {
      claimToken: null,
      claimExpiresAt: null,
      status: nextStatus,
      completedAt:
        nextStatus === "COMPLETED" || nextStatus === "FAILED" || nextStatus === "CANCELLED" ? new Date() : null,
    },
  });
  return count > 0;
}
