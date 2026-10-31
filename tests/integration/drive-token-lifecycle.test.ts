import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Connection from "@/features/drive/services/drive-connection.service";
import type * as AccessToken from "@/server/archive/google-drive/drive-access-token";
import type * as CredentialStore from "@/server/archive/google-drive/drive-credential-store";
import type * as OAuthClient from "@/server/archive/google-drive/google-oauth-client";
import type * as DbClient from "@/server/db/client";

import { FakeGoogleServer } from "../helpers/fake-google-server";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let connection: typeof Connection;
let store: typeof CredentialStore;
let tokenModule: typeof AccessToken;
let oauthModule: typeof OAuthClient;
let google: FakeGoogleServer;

const DRIVE = { clientId: "client-1.apps.googleusercontent.com", clientSecret: "desktop-secret" };
const NOW = new Date("2026-10-28T10:00:00.000Z");
const CREDENTIAL: CredentialStore.DriveCredential = {
  status: "CONNECTED",
  refreshToken: "1//live-refresh",
  scope: "https://www.googleapis.com/auth/drive.file",
  accessToken: "ya29.stored",
  accessTokenExpiresAt: "2026-10-28T11:00:00.000Z",
  accountId: "permission-1",
  accountEmail: "ban@example.com",
  connectedAt: "2026-10-28T09:00:00.000Z",
};

const oauth = () => new oauthModule.GoogleOAuthClient({ ...DRIVE, endpoints: google.endpoints });
const accessToken = (now = NOW) => new tokenModule.DriveAccessToken({ oauth: oauth(), now: () => now });
const tokenRequests = () => google.requestsTo("/token");

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  connection = await import("@/features/drive/services/drive-connection.service");
  store = await import("@/server/archive/google-drive/drive-credential-store");
  tokenModule = await import("@/server/archive/google-drive/drive-access-token");
  oauthModule = await import("@/server/archive/google-drive/google-oauth-client");
}, 60_000);

beforeEach(async () => {
  google = new FakeGoogleServer();
  await google.start();
  google.liveRefreshTokens.add(CREDENTIAL.refreshToken);
  await store.writeDriveCredential(CREDENTIAL);
});

afterEach(async () => {
  await google.stop();
  await store.deleteDriveCredential();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("DriveAccessToken", () => {
  it("uses the stored token while it has more than a minute left", async () => {
    expect(await accessToken(new Date("2026-10-28T10:58:30.000Z")).get()).toBe("ya29.stored");
    expect(tokenRequests()).toHaveLength(0);
  });

  it("refreshes a token about to expire, keeps the new one and the refresh token", async () => {
    const tokens = accessToken(new Date("2026-10-28T10:59:30.000Z"));

    expect(await tokens.get()).toBe("ya29.access-1");
    expect(await tokens.get()).toBe("ya29.access-1");

    expect(tokenRequests()).toHaveLength(1);
    expect(Object.fromEntries(new URLSearchParams(tokenRequests()[0]?.body))).toEqual({
      client_id: DRIVE.clientId,
      client_secret: DRIVE.clientSecret,
      grant_type: "refresh_token",
      refresh_token: CREDENTIAL.refreshToken,
    });
    expect(await store.readDriveCredential()).toEqual({
      ...CREDENTIAL,
      accessToken: "ya29.access-1",
      accessTokenExpiresAt: "2026-10-28T11:59:29.000Z",
    });
  });

  it("keeps a new refresh token when Google hands one out", async () => {
    await store.writeDriveCredential({ ...CREDENTIAL, accessTokenExpiresAt: null });
    google.failNext("token", {
      kind: "json",
      body: { access_token: "ya29.x", expires_in: 3599, refresh_token: "1//rotated", token_type: "Bearer" },
    });

    await accessToken().get();

    expect((await store.readDriveCredential())?.refreshToken).toBe("1//rotated");
  });

  it("asks Google once when several callers need a token at the same time", async () => {
    await store.writeDriveCredential({ ...CREDENTIAL, accessToken: null, accessTokenExpiresAt: null });
    const tokens = accessToken();

    const results = await Promise.all([tokens.get(), tokens.get(), tokens.get()]);

    expect(new Set(results)).toEqual(new Set(["ya29.access-1"]));
    expect(tokenRequests()).toHaveLength(1);
  });

  it("asks Google once when several uploads of the worker need a token together", async () => {
    await store.writeDriveCredential({ ...CREDENTIAL, accessToken: null, accessTokenExpiresAt: null });
    const { createDriveArchiveProvider } = await import("@/features/archive/services/drive-archive-provider.factory");
    const options = {
      endpoints: google.endpoints,
      drive: {
        ...DRIVE,
        apiBaseUrl: undefined,
        minRequestIntervalMs: 0,
        maxRequestsPerDay: 5000,
        maxUploadBytesPerDay: 1024 ** 3,
      },
    };
    const request = { bookId: "book-1", videoId: "video-1", renderId: "render-1" };

    await Promise.all(
      ["a", "b", "c"].map((id) =>
        createDriveArchiveProvider(`destination-${id}`, options).prepareDestination({
          ...request,
          renderId: `render-${id}`,
        }),
      ),
    );

    expect(tokenRequests()).toHaveLength(1);
  });

  it("refreshes a token Drive refused even before it expires", async () => {
    const tokens = accessToken();
    expect(await tokens.get()).toBe("ya29.stored");

    tokens.invalidate();

    expect(await tokens.get()).toBe("ya29.access-1");
    expect(await tokens.get()).toBe("ya29.access-1");
    expect(tokenRequests()).toHaveLength(1);
  });

  it("asks for a new sign-in when Google refuses the refresh token, and stops asking Google", async () => {
    google.liveRefreshTokens.clear();
    const tokens = accessToken(new Date("2026-10-28T12:00:00.000Z"));

    await expect(tokens.get()).rejects.toMatchObject({ code: "DRIVE_RECONNECT_REQUIRED", kind: "AUTH" });
    await expect(tokens.get()).rejects.toMatchObject({ code: "DRIVE_RECONNECT_REQUIRED" });

    expect(tokenRequests()).toHaveLength(1);
    expect(await store.readDriveCredential()).toMatchObject({
      status: "NEEDS_RECONNECT",
      accessToken: null,
      accessTokenExpiresAt: null,
    });
    expect(await connection.getDriveConnectionStatus(DRIVE)).toMatchObject({ connected: false, needsReconnect: true });
  });

  it("leaves the connection as it was when Google is only briefly unavailable", async () => {
    google.failNext("token", { kind: "status", status: 503 });

    await expect(accessToken(new Date("2026-10-28T12:00:00.000Z")).get()).rejects.toMatchObject({ kind: "TRANSIENT" });

    expect(await store.readDriveCredential()).toEqual(CREDENTIAL);
  });

  it("reports no connection when nothing is stored", async () => {
    await store.deleteDriveCredential();

    await expect(accessToken().get()).rejects.toMatchObject({ code: "DRIVE_NOT_CONNECTED", kind: "AUTH" });
  });

  it("drops a refresh that finished after the user disconnected", async () => {
    const racing = {
      refresh: async () => {
        await store.deleteDriveCredential();
        return { accessToken: "ya29.late", expiresAt: new Date(), refreshToken: null, scopes: [] };
      },
    } as unknown as OAuthClient.GoogleOAuthClient;
    const tokens = new tokenModule.DriveAccessToken({ oauth: racing, now: () => new Date("2026-10-28T12:00:00.000Z") });

    await expect(tokens.get()).rejects.toMatchObject({ code: "DRIVE_NOT_CONNECTED" });
    expect(await store.readDriveCredential()).toBeNull();
  });

  it("drops a refresh that finished after the user signed in again", async () => {
    const fresh = { ...CREDENTIAL, refreshToken: "1//new-sign-in", connectedAt: "2026-10-28T11:30:00.000Z" };
    const racing = {
      refresh: async () => {
        await store.writeDriveCredential(fresh);
        return { accessToken: "ya29.late", expiresAt: new Date(), refreshToken: null, scopes: [] };
      },
    } as unknown as OAuthClient.GoogleOAuthClient;
    const tokens = new tokenModule.DriveAccessToken({ oauth: racing, now: () => new Date("2026-10-28T12:00:00.000Z") });

    await expect(tokens.get()).rejects.toMatchObject({ code: "DRIVE_NOT_CONNECTED" });
    expect(await store.readDriveCredential()).toEqual(fresh);
  });
});

describe("disconnectDrive", () => {
  const disconnect = () => connection.disconnectDrive({ drive: DRIVE, endpoints: google.endpoints });

  it("revokes the permission at Google and forgets it, deleting nothing in Drive", async () => {
    const result = await disconnect();

    expect(result).toMatchObject({ connected: false, needsReconnect: false, revokedAtGoogle: true });
    expect(await store.readDriveCredential()).toBeNull();
    expect(google.requests.map((request) => `${request.method} ${request.path}`)).toEqual(["POST /revoke"]);
    const [revoke] = google.requestsTo("/revoke");
    expect(new URLSearchParams(revoke?.body).get("token")).toBe(CREDENTIAL.refreshToken);
    expect(revoke?.query.toString()).toBe("");
    expect(google.liveRefreshTokens.has(CREDENTIAL.refreshToken)).toBe(false);
  });

  it("still forgets the permission when Google cannot be reached, and says so", async () => {
    google.failNext("revoke", { kind: "drop" });

    const result = await disconnect();

    expect(result).toMatchObject({ connected: false, revokedAtGoogle: false });
    expect(await store.readDriveCredential()).toBeNull();
  });

  it("treats a permission Google already dropped as revoked", async () => {
    google.liveRefreshTokens.clear();

    expect(await disconnect()).toMatchObject({ revokedAtGoogle: true });
  });

  it("does nothing at Google when there is no connection", async () => {
    await store.deleteDriveCredential();

    expect(await disconnect()).toMatchObject({ connected: false, revokedAtGoogle: true });
    expect(google.requests).toHaveLength(0);
  });

  it("lets a connection that needs a new sign-in be connected again", async () => {
    await store.writeDriveCredential({ ...CREDENTIAL, status: "NEEDS_RECONNECT", accessToken: null });
    const { authorizationUrl } = await connection.startDriveConnection(
      "http://127.0.0.1:3000/api/integrations/drive/connect",
      DRIVE,
      NOW,
    );

    const status = await connection.completeDriveConnection(
      { state: new URL(authorizationUrl).searchParams.get("state") ?? "", code: "c" },
      { drive: DRIVE, endpoints: google.endpoints, now: NOW },
    );

    expect(status).toMatchObject({ connected: true, needsReconnect: false });
    expect(await store.readDriveCredential()).toMatchObject({ status: "CONNECTED", refreshToken: "1//refresh-1" });
  });
});
