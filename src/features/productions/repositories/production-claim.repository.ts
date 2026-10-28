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

// Gives the item up and records where it stands. Only the current holder can do this. A failure carries its reason. A
// cancel recorded while the item was held wins over whatever the holder reports, so a cancelled item never comes back.
export async function releaseProductionClaim(
  itemId: string,
  claimToken: string,
  nextStatus: "PENDING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED",
  failure?: { code: string; message: string },
): Promise<boolean> {
  const finished = nextStatus === "COMPLETED" || nextStatus === "FAILED" || nextStatus === "CANCELLED";
  return prisma.$transaction(async (tx) => {
    const cancelled = await tx.productionItem.updateMany({
      where: { id: itemId, claimToken, status: "CANCELLED" },
      data: { claimToken: null, claimExpiresAt: null, completedAt: new Date() },
    });
    if (cancelled.count > 0) return true;

    const { count } = await tx.productionItem.updateMany({
      where: { id: itemId, claimToken },
      data: {
        claimToken: null,
        claimExpiresAt: null,
        status: nextStatus,
        completedAt: finished ? new Date() : null,
        ...(failure ? { errorCode: failure.code, errorMessage: failure.message } : {}),
        ...(nextStatus === "COMPLETED" ? { errorCode: null, errorMessage: null } : {}),
      },
    });
    return count > 0;
  });
}
