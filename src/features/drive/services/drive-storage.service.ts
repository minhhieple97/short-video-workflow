import "server-only";

import { driveUsageLedger } from "@/features/archive/repositories/drive-usage.repository";
import { DriveAccessToken } from "@/server/archive/google-drive/drive-access-token";
import { readDriveCredential } from "@/server/archive/google-drive/drive-credential-store";
import { DriveRequestMeter } from "@/server/archive/google-drive/drive-request-meter";
import { GoogleDriveClient } from "@/server/archive/google-drive/google-drive-client";
import { googleEndpoints } from "@/server/archive/google-drive/google-http";
import { GoogleOAuthClient } from "@/server/archive/google-drive/google-oauth-client";
import { AppError } from "@/shared/errors";
import { getAppConfig } from "@/shared/config/env";

import { saveDriveStorage } from "../repositories/drive-storage.repository";
import type { DriveStorageDto } from "../schemas/drive-connection.dto";

export async function refreshDriveStorage(): Promise<DriveStorageDto> {
  const drive = getAppConfig().drive;
  const credential = await readDriveCredential();
  if (!drive.clientId || !credential?.accountId || credential.status !== "CONNECTED")
    throw new AppError("DRIVE_NOT_CONNECTED", "Hãy kết nối Google Drive trước khi đọc dung lượng.", 409);
  const endpoints = googleEndpoints(drive.apiBaseUrl);
  const token = new DriveAccessToken({
    oauth: new GoogleOAuthClient({ clientId: drive.clientId, clientSecret: drive.clientSecret, endpoints }),
  });
  const meter = new DriveRequestMeter({
    ledger: driveUsageLedger("google-drive"),
    minIntervalMs: drive.minRequestIntervalMs,
    maxRequestsPerDay: drive.maxRequestsPerDay,
    maxBytesPerDay: drive.maxUploadBytesPerDay,
  });
  const client = new GoogleDriveClient({
    getAccessToken: () => token.get(),
    invalidateAccessToken: () => token.invalidate(),
    beforeRequest: (bytes) => meter.beforeRequest(bytes),
    endpoints,
  });
  const quota = await client.getStorageQuota();
  const current = await readDriveCredential();
  if (current?.connectedAt !== credential.connectedAt || current.accountId !== credential.accountId)
    throw new AppError("DRIVE_CONNECTION_CHANGED", "Kết nối Drive đã thay đổi; hãy đọc lại dung lượng.", 409);
  const snapshot = { ...quota, fetchedAt: new Date().toISOString() };
  await saveDriveStorage(credential.accountId, snapshot);
  return snapshot;
}
