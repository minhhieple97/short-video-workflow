import "server-only";

import { driveCapacityCache, sumDriveUsage } from "@/features/archive/repositories/drive-usage.repository";
import { countFailedArchives } from "@/features/archive/repositories/render-archive.repository";
import { GOOGLE_DRIVE_PROVIDER_ID } from "@/server/archive/google-drive/drive-archive-provider";
import { readDriveCredential } from "@/server/archive/google-drive/drive-credential-store";
import { getAppConfig } from "@/shared/config/env";

import type { DriveOverviewDto } from "../schemas/drive-connection.dto";
import { getDriveConnectionStatus } from "./drive-connection.service";

// Everything the settings page shows about Drive, from local state only: the page never calls Google.
export async function getDriveOverview(now: Date = new Date()): Promise<DriveOverviewDto> {
  const drive = getAppConfig().drive;
  const [connection, credential, usage] = await Promise.all([
    getDriveConnectionStatus(drive),
    readDriveCredential(),
    sumDriveUsage(GOOGLE_DRIVE_PROVIDER_ID, now),
  ]);
  const destinationKey = credential?.accountId ?? null;
  const capacity = destinationKey ? await driveCapacityCache(destinationKey).read() : null;
  return {
    connection,
    usage: { ...usage, maxRequests: drive.maxRequestsPerDay, maxBytes: drive.maxUploadBytesPerDay },
    capacity: capacity ? { ...capacity, fetchedAt: capacity.fetchedAt.toISOString() } : null,
    failedArchives: destinationKey
      ? await countFailedArchives({ provider: GOOGLE_DRIVE_PROVIDER_ID, destinationKey })
      : 0,
  };
}
