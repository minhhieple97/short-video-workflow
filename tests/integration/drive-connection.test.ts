import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Connection from "@/features/drive/services/drive-connection.service";
import type * as CredentialStore from "@/server/archive/google-drive/drive-credential-store";
import type * as GoogleOAuth from "@/server/archive/google-drive/google-oauth";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let connection: typeof Connection;
let store: typeof CredentialStore;
let oauth: typeof GoogleOAuth;

const DRIVE = { clientId: "client-1.apps.googleusercontent.com", clientSecret: "desktop-secret" };
const REQUEST_URL = "http://127.0.0.1:3000/api/integrations/drive/connect";
const NOW = new Date("2026-10-28T10:00:00.000Z");
const CREDENTIAL: CredentialStore.DriveCredential = {
  status: "CONNECTED",
  refreshToken: "1//refresh-token-value",
  scope: "https://www.googleapis.com/auth/drive.file",
  accessToken: "ya29.access-token-value",
  accessTokenExpiresAt: "2026-10-28T11:00:00.000Z",
  accountId: "permission-1",
  accountEmail: "ban@example.com",
  connectedAt: "2026-10-28T10:00:00.000Z",
};

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  connection = await import("@/features/drive/services/drive-connection.service");
  store = await import("@/server/archive/google-drive/drive-credential-store");
  oauth = await import("@/server/archive/google-drive/google-oauth");
}, 60_000);

beforeEach(async () => {
  await db.prisma.oAuthAuthorization.deleteMany();
  await store.deleteDriveCredential();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("startDriveConnection", () => {
  it("records the sign-in with a hashed state, the verifier behind the challenge and a 10 minute expiry", async () => {
    const { authorizationUrl } = await connection.startDriveConnection(REQUEST_URL, DRIVE, NOW);

    const params = new URL(authorizationUrl).searchParams;
    const state = params.get("state") ?? "";
    const [row] = await db.prisma.oAuthAuthorization.findMany();
    expect(row).toMatchObject({
      provider: "google-drive",
      stateHash: oauth.hashOAuthState(state),
      redirectUri: "http://127.0.0.1:3000",
      consumedAt: null,
    });
    expect(row?.expiresAt.toISOString()).toBe("2026-10-28T10:10:00.000Z");
    expect(params.get("code_challenge")).toBe(
      (await import("node:crypto"))
        .createHash("sha256")
        .update(row?.codeVerifier ?? "")
        .digest("base64url"),
    );
    expect(params.get("redirect_uri")).toBe("http://127.0.0.1:3000");
  });

  it("keeps the state, the verifier and the client secret out of what it stores in plain or returns", async () => {
    const { authorizationUrl } = await connection.startDriveConnection(REQUEST_URL, DRIVE, NOW);

    const state = new URL(authorizationUrl).searchParams.get("state") ?? "";
    const [row] = await db.prisma.oAuthAuthorization.findMany();
    expect(JSON.stringify(row)).not.toContain(state);
    expect(authorizationUrl).not.toContain(row?.codeVerifier ?? "-");
    expect(authorizationUrl).not.toContain(DRIVE.clientSecret);
  });

  it("drops sign-ins that expired or were used, and keeps the live ones", async () => {
    await connection.startDriveConnection(REQUEST_URL, DRIVE, new Date(NOW.getTime() - 11 * 60_000));
    await connection.startDriveConnection(REQUEST_URL, DRIVE, new Date(NOW.getTime() - 5 * 60_000));
    const used = await connection.startDriveConnection(REQUEST_URL, DRIVE, new Date(NOW.getTime() - 60_000));
    const usedHash = oauth.hashOAuthState(new URL(used.authorizationUrl).searchParams.get("state") ?? "");
    await db.prisma.oAuthAuthorization.update({ where: { stateHash: usedHash }, data: { consumedAt: NOW } });

    await connection.startDriveConnection(REQUEST_URL, DRIVE, NOW);

    expect(await db.prisma.oAuthAuthorization.count()).toBe(2);
    expect(await db.prisma.oAuthAuthorization.count({ where: { stateHash: usedHash } })).toBe(0);
  });

  it("refuses to start without a client ID, storing nothing", async () => {
    await expect(
      connection.startDriveConnection(REQUEST_URL, { clientId: undefined, clientSecret: undefined }, NOW),
    ).rejects.toMatchObject({ code: "DRIVE_NOT_CONFIGURED", httpStatus: 409 });
    expect(await db.prisma.oAuthAuthorization.count()).toBe(0);
  });

  it("refuses a request that did not come in on the loopback address, storing nothing", async () => {
    await expect(
      connection.startDriveConnection("http://192.168.1.20:3000/api/integrations/drive/connect", DRIVE, NOW),
    ).rejects.toMatchObject({ code: "DRIVE_REDIRECT_NOT_LOOPBACK", httpStatus: 400 });
    expect(await db.prisma.oAuthAuthorization.count()).toBe(0);
  });
});

describe("getDriveConnectionStatus", () => {
  it("reports configuration and connection without any secret", async () => {
    expect(await connection.getDriveConnectionStatus({ clientId: undefined, clientSecret: undefined })).toEqual({
      configured: false,
      connected: false,
      needsReconnect: false,
      accountEmail: null,
      connectedAt: null,
    });

    await store.writeDriveCredential(CREDENTIAL);
    const status = await connection.getDriveConnectionStatus(DRIVE);

    expect(status).toEqual({
      configured: true,
      connected: true,
      needsReconnect: false,
      accountEmail: "ban@example.com",
      connectedAt: "2026-10-28T10:00:00.000Z",
    });
    const json = JSON.stringify(status);
    for (const secret of [CREDENTIAL.refreshToken, CREDENTIAL.accessToken ?? "-", DRIVE.clientSecret, "permission-1"]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("drive credential store", () => {
  it("writes the tokens to a file only this user can read, in a directory only this user can list", async () => {
    await store.writeDriveCredential(CREDENTIAL);

    const file = store.driveCredentialPath();
    expect(file.startsWith(env.dataDir)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(await store.readDriveCredential()).toEqual(CREDENTIAL);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["google-drive.json"]);
  });

  it("tightens a directory that was created with looser permissions", async () => {
    fs.mkdirSync(path.dirname(store.driveCredentialPath()), { recursive: true });
    fs.chmodSync(path.dirname(store.driveCredentialPath()), 0o755);

    await store.writeDriveCredential(CREDENTIAL);

    expect(fs.statSync(path.dirname(store.driveCredentialPath())).mode & 0o777).toBe(0o700);
  });

  it("reads nothing when there is no connection, and forgets it on delete", async () => {
    expect(await store.readDriveCredential()).toBeNull();

    await store.writeDriveCredential(CREDENTIAL);
    await store.deleteDriveCredential();

    expect(await store.readDriveCredential()).toBeNull();
  });

  it("reads a file written before connections had a status as connected", async () => {
    const { status: _status, ...older } = CREDENTIAL;
    fs.mkdirSync(path.dirname(store.driveCredentialPath()), { recursive: true });
    fs.writeFileSync(store.driveCredentialPath(), JSON.stringify(older));

    expect((await store.readDriveCredential())?.status).toBe("CONNECTED");
  });

  it("changes the connection only while it is still the one that was read", async () => {
    await store.writeDriveCredential(CREDENTIAL);

    const changed = await store.updateDriveCredential(CREDENTIAL.connectedAt, (current) => ({
      ...current,
      accessToken: "ya29.new",
    }));
    expect(changed?.accessToken).toBe("ya29.new");

    expect(await store.updateDriveCredential("2020-01-01T00:00:00.000Z", (current) => current)).toBeNull();
    await store.deleteDriveCredential();
    expect(await store.updateDriveCredential(CREDENTIAL.connectedAt, (current) => current)).toBeNull();
    expect(await store.readDriveCredential()).toBeNull();
  });

  it("reports a damaged file without repeating its content", async () => {
    await store.writeDriveCredential(CREDENTIAL);
    fs.writeFileSync(store.driveCredentialPath(), JSON.stringify({ ...CREDENTIAL, connectedAt: 5 }));

    const error = await store.readDriveCredential().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "DRIVE_CREDENTIAL_INVALID" });
    expect(JSON.stringify(error)).not.toContain(CREDENTIAL.refreshToken);
    expect(String((error as Error).message)).not.toContain(CREDENTIAL.refreshToken);

    fs.writeFileSync(store.driveCredentialPath(), "{not json");
    await expect(store.readDriveCredential()).rejects.toMatchObject({ code: "DRIVE_CREDENTIAL_INVALID" });
  });

  it("refuses to write an incomplete credential", async () => {
    await expect(store.writeDriveCredential({ ...CREDENTIAL, refreshToken: "" })).rejects.toThrow();
    expect(await store.readDriveCredential()).toBeNull();
  });
});
