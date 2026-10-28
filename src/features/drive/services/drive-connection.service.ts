import "server-only";

import { readDriveCredential } from "@/server/archive/google-drive/drive-credential-store";
import {
  buildAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  hashOAuthState,
  loopbackRedirectUri,
} from "@/server/archive/google-drive/google-oauth";
import { getAppConfig, type AppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import {
  createOAuthAuthorization,
  purgeSpentOAuthAuthorizations,
} from "../repositories/oauth-authorization.repository";
import type { DriveAuthorizationDto, DriveConnectionDto } from "../schemas/drive-connection.dto";

const logger = createLogger("drive.connection");
export const DRIVE_PROVIDER = "google-drive";
export const OAUTH_AUTHORIZATION_TTL_MS = 10 * 60_000;

function requireClientId(drive: AppConfig["drive"]): string {
  if (!drive.clientId) {
    throw new AppError(
      "DRIVE_NOT_CONFIGURED",
      "Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID (OAuth client loại Desktop app) nên chưa thể kết nối Google Drive.",
      409,
    );
  }
  return drive.clientId;
}

// Starts a Google sign-in: the browser is sent to Google with a one-time state and a PKCE challenge, and comes back to
// this app on the loopback address. Nothing is granted until the callback exchanges the code.
export async function startDriveConnection(
  requestUrl: string,
  drive: AppConfig["drive"] = getAppConfig().drive,
  now: Date = new Date(),
): Promise<DriveAuthorizationDto> {
  const clientId = requireClientId(drive);
  const redirectUri = loopbackRedirectUri(requestUrl);
  const state = createOAuthState();
  const pkce = createPkcePair();

  await purgeSpentOAuthAuthorizations(now);
  await createOAuthAuthorization({
    provider: DRIVE_PROVIDER,
    stateHash: hashOAuthState(state),
    codeVerifier: pkce.verifier,
    redirectUri,
    expiresAt: new Date(now.getTime() + OAUTH_AUTHORIZATION_TTL_MS),
  });
  logger.info("Drive connection started", { redirectUri });
  return {
    authorizationUrl: buildAuthorizationUrl({ clientId, redirectUri, state, codeChallenge: pkce.challenge }),
  };
}

export async function getDriveConnectionStatus(
  drive: AppConfig["drive"] = getAppConfig().drive,
): Promise<DriveConnectionDto> {
  const credential = await readDriveCredential();
  return {
    configured: Boolean(drive.clientId),
    connected: credential !== null,
    accountEmail: credential?.accountEmail ?? null,
    connectedAt: credential?.connectedAt ?? null,
  };
}
