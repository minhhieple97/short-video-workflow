import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Connection from "@/features/drive/services/drive-connection.service";
import type * as CredentialStore from "@/server/archive/google-drive/drive-credential-store";
import type * as DbClient from "@/server/db/client";

import { FakeGoogleServer } from "../helpers/fake-google-server";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let connection: typeof Connection;
let store: typeof CredentialStore;
let google: FakeGoogleServer;

const DRIVE = { clientId: "client-1.apps.googleusercontent.com", clientSecret: "desktop-secret" };
const START = new Date("2026-10-28T10:00:00.000Z");
const AFTER = new Date("2026-10-28T10:02:00.000Z");

async function start(at = START): Promise<string> {
  const { authorizationUrl } = await connection.startDriveConnection(
    "http://127.0.0.1:3000/api/integrations/drive/connect",
    DRIVE,
    at,
  );
  return new URL(authorizationUrl).searchParams.get("state") ?? "";
}

const complete = (params: Connection.DriveCallbackParams, now = AFTER) =>
  connection.completeDriveConnection(params, { drive: DRIVE, endpoints: google.endpoints, now });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  connection = await import("@/features/drive/services/drive-connection.service");
  store = await import("@/server/archive/google-drive/drive-credential-store");
}, 60_000);

beforeEach(async () => {
  await db.prisma.oAuthAuthorization.deleteMany();
  await store.deleteDriveCredential();
  google = new FakeGoogleServer();
  await google.start();
});

afterEach(async () => {
  await google.stop();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("completeDriveConnection", () => {
  it("exchanges the code with the stored verifier and keeps the tokens and the account", async () => {
    const state = await start();
    const [row] = await db.prisma.oAuthAuthorization.findMany();

    const status = await complete({ state, code: "4/auth-code" });

    expect(status).toEqual({
      configured: true,
      connected: true,
      needsReconnect: false,
      accountEmail: "ban@example.com",
      connectedAt: AFTER.toISOString(),
    });
    const [tokenRequest] = google.requestsTo("/token");
    expect(Object.fromEntries(new URLSearchParams(tokenRequest?.body))).toEqual({
      client_id: DRIVE.clientId,
      client_secret: DRIVE.clientSecret,
      grant_type: "authorization_code",
      code: "4/auth-code",
      code_verifier: row?.codeVerifier,
      redirect_uri: "http://127.0.0.1:3000",
    });
    const [about] = google.requestsTo("/drive/v3/about");
    expect(about?.headers.authorization).toBe("Bearer ya29.access-1");
    expect(about?.query.get("fields")).toBe("user(permissionId,emailAddress)");
    expect(await store.readDriveCredential()).toEqual({
      status: "CONNECTED",
      refreshToken: "1//refresh-1",
      scope: "https://www.googleapis.com/auth/drive.file",
      accessToken: "ya29.access-1",
      accessTokenExpiresAt: new Date(AFTER.getTime() + 3599_000).toISOString(),
      accountId: "permission-1",
      accountEmail: "ban@example.com",
      connectedAt: AFTER.toISOString(),
    });
  });

  it("sends no client secret when none is configured", async () => {
    const state = await start();

    await connection.completeDriveConnection(
      { state, code: "c" },
      { drive: { clientId: DRIVE.clientId, clientSecret: undefined }, endpoints: google.endpoints, now: AFTER },
    );

    expect(new URLSearchParams(google.requestsTo("/token")[0]?.body).has("client_secret")).toBe(false);
  });

  it("accepts an account whose email Google does not show", async () => {
    google.account = { permissionId: "permission-2" };
    const state = await start();

    const status = await complete({ state, code: "c" });

    expect(status.accountEmail).toBeNull();
    expect((await store.readDriveCredential())?.accountId).toBe("permission-2");
  });

  it("spends the state: the same answer replayed is refused before reaching Google", async () => {
    const state = await start();
    await complete({ state, code: "c" });

    await expect(complete({ state, code: "c" })).rejects.toMatchObject({ code: "DRIVE_OAUTH_STATE_USED" });
    expect(google.requestsTo("/token")).toHaveLength(1);
  });

  it("lets only one of two simultaneous callbacks with the same state through", async () => {
    const state = await start();

    const results = await Promise.allSettled([complete({ state, code: "c" }), complete({ state, code: "c" })]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(google.requestsTo("/token")).toHaveLength(1);
  });

  it("refuses a state older than 10 minutes, and an unknown or missing one, without calling Google", async () => {
    const state = await start();

    await expect(complete({ state, code: "c" }, new Date(START.getTime() + 10 * 60_000))).rejects.toMatchObject({
      code: "DRIVE_OAUTH_STATE_EXPIRED",
    });
    await expect(complete({ state: "made-up", code: "c" })).rejects.toMatchObject({
      code: "DRIVE_OAUTH_STATE_INVALID",
    });
    await expect(complete({ code: "c" })).rejects.toMatchObject({ code: "DRIVE_OAUTH_STATE_INVALID" });
    expect(google.requests).toHaveLength(0);
    expect(await store.readDriveCredential()).toBeNull();
  });

  it("reports a refusal on Google's page and spends the state", async () => {
    const state = await start();

    await expect(complete({ state, error: "access_denied" })).rejects.toMatchObject({ code: "DRIVE_ACCESS_DENIED" });
    await expect(complete({ state, code: "c" })).rejects.toMatchObject({ code: "DRIVE_OAUTH_STATE_USED" });
    expect(google.requests).toHaveLength(0);
  });

  it("stores nothing when the drive.file permission was not granted", async () => {
    google.grantedScope = "openid";
    const state = await start();

    await expect(complete({ state, code: "c" })).rejects.toMatchObject({ code: "DRIVE_SCOPE_NOT_GRANTED" });
    expect(await store.readDriveCredential()).toBeNull();
    expect(google.requestsTo("/drive/v3/about")).toHaveLength(0);
  });

  it("stores nothing without a refresh token", async () => {
    google.issueRefreshToken = false;
    const state = await start();

    await expect(complete({ state, code: "c" })).rejects.toMatchObject({ code: "DRIVE_NO_REFRESH_TOKEN" });
    expect(await store.readDriveCredential()).toBeNull();
  });

  it("stores nothing when Google refuses the code", async () => {
    google.failNext("token", { kind: "status", status: 400, body: { error: "invalid_grant", error_description: "x" } });
    const state = await start();

    await expect(complete({ state, code: "c" })).rejects.toMatchObject({ code: "GOOGLE_INVALID_GRANT", kind: "AUTH" });
    expect(await store.readDriveCredential()).toBeNull();
  });

  it("stores nothing when Google's answer is not a bearer token", async () => {
    google.failNext("token", {
      kind: "json",
      body: { access_token: "a", expires_in: 3599, refresh_token: "r", scope: google.grantedScope, token_type: "mac" },
    });
    const state = await start();

    await expect(complete({ state, code: "c" })).rejects.toMatchObject({ code: "GOOGLE_BAD_RESPONSE" });
    expect(await store.readDriveCredential()).toBeNull();
  });

  it("stores nothing when the account cannot be read", async () => {
    google.failNext("about", { kind: "status", status: 500 });
    const state = await start();

    await expect(complete({ state, code: "c" })).rejects.toMatchObject({ kind: "TRANSIENT" });
    expect(await store.readDriveCredential()).toBeNull();
  });

  it("keeps the previous connection when a new attempt fails", async () => {
    await complete({ state: await start(), code: "c" });
    const before = await store.readDriveCredential();

    google.failNext("token", { kind: "status", status: 400, body: { error: "invalid_grant" } });
    await expect(complete({ state: await start(), code: "c" })).rejects.toThrow();

    expect(await store.readDriveCredential()).toEqual(before);
  });
});

describe("GET /api/integrations/drive/callback", () => {
  it("always sends the browser on to Settings, naming what went wrong", async () => {
    const { GET } = await import("@/app/api/integrations/drive/callback/route");

    const response = await GET(new Request("http://127.0.0.1:3000/api/integrations/drive/callback?code=c"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/settings?drive_error=DRIVE_OAUTH_STATE_INVALID",
    );
  });
});
