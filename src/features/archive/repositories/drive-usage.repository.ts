import type { DriveCapacity, DriveCapacityCache } from "@/server/archive/google-drive/drive-capacity";
import type { DriveUsageLedger } from "@/server/archive/google-drive/drive-request-meter";
import { prisma } from "@/server/db/client";

const HOUR_MS = 60 * 60_000;
const WINDOW_HOURS = 24;
const MIN_RETRY_MS = 60_000;

const hourOf = (at: Date): Date => new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
// The current hour and the 23 before it: a request counts for 24 hours, give or take the hour it was made in.
const windowStartOf = (at: Date): Date => new Date(hourOf(at).getTime() - (WINDOW_HOURS - 1) * HOUR_MS);

// Time until the oldest hour that holds use of this kind leaves the window, when room appears again.
function retryAfter(at: Date, oldest: Date | undefined): number {
  if (!oldest) return MIN_RETRY_MS;
  return Math.max(MIN_RETRY_MS, oldest.getTime() + WINDOW_HOURS * HOUR_MS - at.getTime());
}

export function driveUsageLedger(provider: string): DriveUsageLedger {
  return {
    reserve: ({ at, bytes, maxRequests, maxBytes }) =>
      prisma.$transaction(async (tx) => {
        const windowStart = windowStartOf(at);
        // Deleting first takes the write lock, so two reservations cannot both read the same totals.
        await tx.driveUsageHour.deleteMany({ where: { provider, hourStart: { lt: windowStart } } });
        const hours = await tx.driveUsageHour.findMany({ where: { provider }, orderBy: { hourStart: "asc" } });
        const requests = hours.reduce((sum, hour) => sum + hour.requests, 0);
        const sent = hours.reduce((sum, hour) => sum + hour.bytesSent, 0n);

        if (requests + 1 > maxRequests) {
          return {
            ok: false,
            limit: "requests",
            retryAfterMs: retryAfter(at, hours.find((h) => h.requests > 0)?.hourStart),
          };
        }
        if (sent + BigInt(bytes) > BigInt(maxBytes)) {
          return {
            ok: false,
            limit: "bytes",
            retryAfterMs: retryAfter(at, hours.find((h) => h.bytesSent > 0n)?.hourStart),
          };
        }
        await tx.driveUsageHour.upsert({
          where: { provider_hourStart: { provider, hourStart: hourOf(at) } },
          create: { provider, hourStart: hourOf(at), requests: 1, bytesSent: BigInt(bytes) },
          update: { requests: { increment: 1 }, bytesSent: { increment: BigInt(bytes) } },
        });
        return { ok: true };
      }),
  };
}

// The app's own Drive use over the last 24 hours (what the limits are judged on), for display.
export async function sumDriveUsage(
  provider: string,
  at: Date = new Date(),
): Promise<{ requests: number; bytesSent: number }> {
  const hours = await prisma.driveUsageHour.findMany({ where: { provider, hourStart: { gte: windowStartOf(at) } } });
  return {
    requests: hours.reduce((sum, hour) => sum + hour.requests, 0),
    bytesSent: Number(hours.reduce((sum, hour) => sum + hour.bytesSent, 0n)),
  };
}

export function driveCapacityCache(destinationKey: string): DriveCapacityCache {
  return {
    async read(): Promise<DriveCapacity | null> {
      const row = await prisma.driveCapacity.findUnique({ where: { destinationKey } });
      if (!row) return null;
      return {
        limitBytes: row.limitBytes === null ? null : Number(row.limitBytes),
        usageBytes: Number(row.usageBytes),
        fetchedAt: row.fetchedAt,
      };
    },
    async write(capacity) {
      const data = {
        limitBytes: capacity.limitBytes === null ? null : BigInt(capacity.limitBytes),
        usageBytes: BigInt(capacity.usageBytes),
        fetchedAt: capacity.fetchedAt,
      };
      await prisma.driveCapacity.upsert({
        where: { destinationKey },
        create: { destinationKey, ...data },
        update: data,
      });
    },
    async addUsage(bytes) {
      await prisma.driveCapacity.updateMany({
        where: { destinationKey },
        data: { usageBytes: { increment: BigInt(bytes) } },
      });
    },
  };
}
