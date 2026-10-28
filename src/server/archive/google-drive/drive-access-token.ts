import { IntegrationError } from "@/server/integrations/integration-error";
import { createLogger } from "@/shared/logger";

import { readDriveCredential, updateDriveCredential, type DriveCredential } from "./drive-credential-store";
import type { GoogleOAuthClient } from "./google-oauth-client";

const logger = createLogger("drive.token");
// A token this close to expiry is refreshed first, so it cannot run out in the middle of a request.
const EXPIRY_MARGIN_MS = 60_000;

const notConnected = () =>
  new IntegrationError("DRIVE_NOT_CONNECTED", "Chưa kết nối Google Drive. Hãy kết nối trong Cài đặt.", "AUTH");
const reconnectRequired = () =>
  new IntegrationError(
    "DRIVE_RECONNECT_REQUIRED",
    "Google không còn chấp nhận quyền truy cập Drive (đã thu hồi hoặc hết hạn). Hãy kết nối lại trong Cài đặt.",
    "AUTH",
  );

// Hands out a valid access token for the stored connection, refreshing it when needed. Refreshes are shared, so callers
// that ask at the same time cause one request to Google. When Google refuses the refresh token, the connection is marked
// as needing a new sign-in and every later call fails fast with DRIVE_RECONNECT_REQUIRED instead of asking Google again.
export class DriveAccessToken {
  private readonly oauth: GoogleOAuthClient;
  private readonly now: () => Date;
  private pending: Promise<string> | null = null;
  private stale = false;

  constructor(options: { oauth: GoogleOAuthClient; now?: () => Date }) {
    this.oauth = options.oauth;
    this.now = options.now ?? (() => new Date());
  }

  get(signal?: AbortSignal): Promise<string> {
    this.pending ??= this.load(signal).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  // Drive answered 401 with this token: the next call refreshes even if the token has not reached its expiry.
  invalidate(): void {
    this.stale = true;
  }

  private async load(signal: AbortSignal | undefined): Promise<string> {
    const credential = await readDriveCredential();
    if (!credential) throw notConnected();
    if (credential.status === "NEEDS_RECONNECT") throw reconnectRequired();
    if (!this.stale && this.isFresh(credential) && credential.accessToken) return credential.accessToken;
    return this.refresh(credential, signal);
  }

  private isFresh(credential: DriveCredential): boolean {
    if (!credential.accessTokenExpiresAt) return false;
    return new Date(credential.accessTokenExpiresAt).getTime() - this.now().getTime() > EXPIRY_MARGIN_MS;
  }

  private async refresh(credential: DriveCredential, signal: AbortSignal | undefined): Promise<string> {
    const now = this.now();
    let tokens;
    try {
      tokens = await this.oauth.refresh(credential.refreshToken, signal, now);
    } catch (error) {
      if (error instanceof IntegrationError && error.code === "GOOGLE_INVALID_GRANT") {
        await updateDriveCredential(credential.connectedAt, (current) => ({
          ...current,
          status: "NEEDS_RECONNECT",
          accessToken: null,
          accessTokenExpiresAt: null,
        }));
        logger.warn("Drive refresh token refused; reconnect required");
        throw reconnectRequired();
      }
      throw error;
    }

    const updated = await updateDriveCredential(credential.connectedAt, (current) => ({
      ...current,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt.toISOString(),
      refreshToken: tokens.refreshToken ?? current.refreshToken,
    }));
    // The user disconnected or signed in again while this refresh ran: its token belongs to a connection that is gone.
    if (!updated) throw notConnected();
    this.stale = false;
    return tokens.accessToken;
  }
}
