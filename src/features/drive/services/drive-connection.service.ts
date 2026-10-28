import "server-only";

import {
  deleteDriveCredential,
  readDriveCredential,
  writeDriveCredential,
} from "@/server/archive/google-drive/drive-credential-store";
import { GoogleDriveClient } from "@/server/archive/google-drive/google-drive-client";
import { googleEndpoints, type GoogleEndpoints } from "@/server/archive/google-drive/google-http";
import { GoogleOAuthClient } from "@/server/archive/google-drive/google-oauth-client";
import {
  buildAuthorizationUrl,
  DRIVE_FILE_SCOPE,
  createOAuthState,
  createPkcePair,
  hashOAuthState,
  loopbackRedirectUri,
} from "@/server/archive/google-drive/google-oauth";
import { getAppConfig, type AppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import {
  consumeOAuthAuthorization,
  createOAuthAuthorization,
  purgeSpentOAuthAuthorizations,
} from "../repositories/oauth-authorization.repository";
import type { DriveAuthorizationDto, DriveConnectionDto, DriveDisconnectDto } from "../schemas/drive-connection.dto";

const logger = createLogger("drive.connection");

type DriveOAuthConfig = Pick<AppConfig["drive"], "clientId" | "clientSecret"> &
  Partial<Pick<AppConfig["drive"], "apiBaseUrl">>;
export const DRIVE_PROVIDER = "google-drive";
export const OAUTH_AUTHORIZATION_TTL_MS = 10 * 60_000;

function requireClientId(drive: DriveOAuthConfig): string {
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
  drive: DriveOAuthConfig = getAppConfig().drive,
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
  drive: DriveOAuthConfig = getAppConfig().drive,
): Promise<DriveConnectionDto> {
  const credential = await readDriveCredential();
  return {
    configured: Boolean(drive.clientId),
    connected: credential?.status === "CONNECTED",
    needsReconnect: credential?.status === "NEEDS_RECONNECT",
    accountEmail: credential?.accountEmail ?? null,
    connectedAt: credential?.connectedAt ?? null,
  };
}

export interface DriveCallbackParams {
  state?: string;
  code?: string;
  error?: string;
}

const STATE_PROBLEMS = {
  unknown: () =>
    new AppError("DRIVE_OAUTH_STATE_INVALID", "Phiên kết nối Google Drive không hợp lệ. Hãy bấm kết nối lại.", 400),
  expired: () => new AppError("DRIVE_OAUTH_STATE_EXPIRED", "Phiên kết nối đã quá 10 phút. Hãy bấm kết nối lại.", 400),
  used: () =>
    new AppError("DRIVE_OAUTH_STATE_USED", "Phiên kết nối này đã được dùng. Hãy bấm kết nối lại nếu cần.", 409),
};

// Google's answer comes back here. The state is checked and spent before anything else, so a wrong, expired or replayed
// answer never reaches the token endpoint, and nothing is stored unless the whole exchange succeeds.
export async function completeDriveConnection(
  params: DriveCallbackParams,
  options: { drive?: DriveOAuthConfig; endpoints?: GoogleEndpoints; now?: Date } = {},
): Promise<DriveConnectionDto> {
  const drive = options.drive ?? getAppConfig().drive;
  const endpoints = options.endpoints ?? googleEndpoints(drive.apiBaseUrl);
  const now = options.now ?? new Date();

  if (!params.state) throw STATE_PROBLEMS.unknown();
  const authorization = await consumeOAuthAuthorization(DRIVE_PROVIDER, hashOAuthState(params.state), now);
  if (authorization.status !== "consumed") throw STATE_PROBLEMS[authorization.status]();
  if (params.error) {
    throw params.error === "access_denied"
      ? new AppError("DRIVE_ACCESS_DENIED", "Bạn đã không cấp quyền Google Drive cho ứng dụng.", 403)
      : new AppError("DRIVE_OAUTH_FAILED", "Google không hoàn tất việc cấp quyền. Hãy thử kết nối lại.", 502);
  }
  if (!params.code) throw STATE_PROBLEMS.unknown();

  const oauth = new GoogleOAuthClient({
    clientId: requireClientId(drive),
    clientSecret: drive.clientSecret,
    endpoints,
  });
  const tokens = await oauth.exchangeCode(
    { code: params.code, codeVerifier: authorization.codeVerifier, redirectUri: authorization.redirectUri },
    undefined,
    now,
  );
  // With granular consent the user can untick the one permission the app needs.
  if (!tokens.scopes.includes(DRIVE_FILE_SCOPE)) {
    throw new AppError(
      "DRIVE_SCOPE_NOT_GRANTED",
      "Google chưa cấp quyền lưu tệp lên Drive (drive.file). Hãy kết nối lại và đánh dấu quyền này.",
      403,
    );
  }
  if (!tokens.refreshToken) {
    throw new AppError(
      "DRIVE_NO_REFRESH_TOKEN",
      "Google không trả refresh token nên không thể lưu video khi bạn vắng mặt. Hãy kết nối lại.",
      502,
    );
  }

  const account = await new GoogleDriveClient({
    getAccessToken: async () => tokens.accessToken,
    endpoints,
  }).getAccount();
  await writeDriveCredential({
    status: "CONNECTED",
    refreshToken: tokens.refreshToken,
    scope: tokens.scopes.join(" "),
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt.toISOString(),
    accountId: account.permissionId,
    accountEmail: account.emailAddress,
    connectedAt: now.toISOString(),
  });
  logger.info("Drive connected");
  return getDriveConnectionStatus(drive);
}

// Forgets the connection and asks Google to revoke it. Files already archived stay in the user's Drive: disconnecting
// never deletes anything remote, and archive records keep their remote IDs for a later reconnect.
export async function disconnectDrive(
  options: { drive?: DriveOAuthConfig; endpoints?: GoogleEndpoints } = {},
): Promise<DriveDisconnectDto> {
  const drive = options.drive ?? getAppConfig().drive;
  const credential = await readDriveCredential();
  let revokedAtGoogle = credential === null;
  if (credential && drive.clientId) {
    const oauth = new GoogleOAuthClient({
      clientId: drive.clientId,
      clientSecret: drive.clientSecret,
      endpoints: options.endpoints ?? googleEndpoints(drive.apiBaseUrl),
    });
    try {
      await oauth.revoke(credential.refreshToken);
      revokedAtGoogle = true;
    } catch (error) {
      logger.warn("Drive permission could not be revoked at Google", { error: toSafeErrorMessage(error) });
    }
  }
  await deleteDriveCredential();
  logger.info("Drive disconnected", { revokedAtGoogle });
  return { ...(await getDriveConnectionStatus(drive)), revokedAtGoogle };
}
