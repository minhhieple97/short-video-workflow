import { DriveAccessToken } from "@/server/archive/google-drive/drive-access-token";
import {
  GOOGLE_DRIVE_PROVIDER_ID,
  GoogleDriveArchiveProvider,
} from "@/server/archive/google-drive/drive-archive-provider";
import { DriveCapacityGuard } from "@/server/archive/google-drive/drive-capacity";
import { DriveRequestMeter } from "@/server/archive/google-drive/drive-request-meter";
import { GoogleDriveClient } from "@/server/archive/google-drive/google-drive-client";
import { googleEndpoints, type GoogleEndpoints } from "@/server/archive/google-drive/google-http";
import { GoogleOAuthClient } from "@/server/archive/google-drive/google-oauth-client";
import { IntegrationError } from "@/server/integrations/integration-error";
import { getAppConfig, type AppConfig } from "@/shared/config/env";

import { archiveFolderStore } from "../repositories/archive-folder.repository";
import { driveCapacityCache, driveUsageLedger } from "../repositories/drive-usage.repository";

// One meter for the whole worker, so the pause between requests holds across jobs, not only within one.
let sharedMeter: DriveRequestMeter | null = null;

function meterFor(drive: AppConfig["drive"]): DriveRequestMeter {
  sharedMeter ??= new DriveRequestMeter({
    ledger: driveUsageLedger(GOOGLE_DRIVE_PROVIDER_ID),
    minIntervalMs: drive.minRequestIntervalMs,
    maxRequestsPerDay: drive.maxRequestsPerDay,
    maxBytesPerDay: drive.maxUploadBytesPerDay,
  });
  return sharedMeter;
}

// One token holder per client and token endpoint, shared by every job of the worker: a refresh is then one request to Google
// and one write of the credential file however many uploads need a token together.
const sharedTokens = new Map<string, DriveAccessToken>();

function tokenFor(drive: AppConfig["drive"] & { clientId: string }, endpoints: GoogleEndpoints): DriveAccessToken {
  const key = `${drive.clientId}|${endpoints.tokenUrl}`;
  let token = sharedTokens.get(key);
  if (!token) {
    token = new DriveAccessToken({
      oauth: new GoogleOAuthClient({ clientId: drive.clientId, clientSecret: drive.clientSecret, endpoints }),
    });
    sharedTokens.set(key, token);
  }
  return token;
}

// The Drive archive for the connected account: tokens from the credential store, every request paced and counted, folders
// and storage readings kept per account.
export function createDriveArchiveProvider(
  destinationKey: string,
  options: { drive?: AppConfig["drive"]; endpoints?: GoogleEndpoints; meter?: DriveRequestMeter } = {},
): GoogleDriveArchiveProvider {
  const drive = options.drive ?? getAppConfig().drive;
  if (!drive.clientId) {
    throw new IntegrationError(
      "DRIVE_NOT_CONFIGURED",
      "Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID nên không thể lưu lên Drive.",
      "AUTH",
    );
  }
  const endpoints = options.endpoints ?? googleEndpoints(drive.apiBaseUrl);
  const token = tokenFor({ ...drive, clientId: drive.clientId }, endpoints);
  const meter = options.meter ?? meterFor(drive);
  const client = new GoogleDriveClient({
    getAccessToken: () => token.get(),
    invalidateAccessToken: () => token.invalidate(),
    beforeRequest: (bytes) => meter.beforeRequest(bytes),
    endpoints,
  });
  return new GoogleDriveArchiveProvider({
    drive: client,
    folders: archiveFolderStore(GOOGLE_DRIVE_PROVIDER_ID, destinationKey),
    capacity: new DriveCapacityGuard(client, driveCapacityCache(destinationKey)),
  });
}
