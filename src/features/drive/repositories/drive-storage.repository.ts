import { prisma } from "@/server/db/client";

import type { DriveStorageDto } from "../schemas/drive-connection.dto";

export async function readDriveStorage(destinationKey: string): Promise<DriveStorageDto | null> {
  const row = await prisma.driveStorageSnapshot.findUnique({ where: { destinationKey } });
  return row
    ? {
        limitBytes: row.limitBytes === null ? null : Number(row.limitBytes),
        usageBytes: Number(row.usageBytes),
        usageInDriveBytes: row.usageInDriveBytes === null ? null : Number(row.usageInDriveBytes),
        usageInDriveTrashBytes: row.usageInDriveTrashBytes === null ? null : Number(row.usageInDriveTrashBytes),
        fetchedAt: row.fetchedAt.toISOString(),
      }
    : null;
}

export async function saveDriveStorage(destinationKey: string, snapshot: DriveStorageDto): Promise<void> {
  const data = {
    limitBytes: snapshot.limitBytes === null ? null : BigInt(snapshot.limitBytes),
    usageBytes: BigInt(snapshot.usageBytes),
    usageInDriveBytes: snapshot.usageInDriveBytes === null ? null : BigInt(snapshot.usageInDriveBytes),
    usageInDriveTrashBytes: snapshot.usageInDriveTrashBytes === null ? null : BigInt(snapshot.usageInDriveTrashBytes),
    fetchedAt: new Date(snapshot.fetchedAt),
  };
  await prisma.driveStorageSnapshot.upsert({
    where: { destinationKey },
    create: { destinationKey, ...data },
    update: data,
  });
}
