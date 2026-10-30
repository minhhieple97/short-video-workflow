import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Storage from "@/features/drive/services/drive-storage.service";
import type * as Overview from "@/features/drive/services/drive-overview.service";
import type * as Repository from "@/features/drive/repositories/drive-storage.repository";
import type * as Credential from "@/server/archive/google-drive/drive-credential-store";
import type * as Db from "@/server/db/client";
import type { AppConfig } from "@/shared/config/env";

import { CONNECTED_CREDENTIAL } from "../helpers/archive-fixture";
import { FakeGoogleServer } from "../helpers/fake-google-server";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof Db;
let store: typeof Credential;
let storage: typeof Storage;
let overview: typeof Overview;
let repository: typeof Repository;
let drive: AppConfig["drive"];
let google: FakeGoogleServer;

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  store = await import("@/server/archive/google-drive/drive-credential-store");
  storage = await import("@/features/drive/services/drive-storage.service");
  overview = await import("@/features/drive/services/drive-overview.service");
  repository = await import("@/features/drive/repositories/drive-storage.repository");
  drive = (await import("@/shared/config/env")).getAppConfig().drive;
}, 60_000);

beforeEach(async () => {
  await db.prisma.driveStorageSnapshot.deleteMany();
  await db.prisma.driveCapacity.deleteMany();
  await db.prisma.driveUsageHour.deleteMany();
  google = new FakeGoogleServer();
  await google.start();
  drive.clientId = "fake-client";
  drive.clientSecret = "fake-secret";
  drive.apiBaseUrl = google.endpoints.tokenUrl.replace(/\/token$/, "");
  drive.minRequestIntervalMs = 0;
  await store.writeDriveCredential(CONNECTED_CREDENTIAL);
});

afterEach(async () => {
  await google.stop();
});
afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("Drive storage API snapshots", () => {
  it("stores exact Google values separately from the upload capacity estimate", async () => {
    google.storageQuota = {
      limit: "32985348833280",
      usage: "1085600454380",
      usageInDrive: "455028138",
      usageInDriveTrash: "0",
    };
    const snapshot = await storage.refreshDriveStorage();
    expect(snapshot).toMatchObject({
      limitBytes: 32985348833280,
      usageBytes: 1085600454380,
      usageInDriveBytes: 455028138,
      usageInDriveTrashBytes: 0,
    });
    expect(await repository.readDriveStorage("permission-1")).toEqual(snapshot);
    expect(await db.prisma.driveCapacity.count()).toBe(0);
    await db.prisma.driveCapacity.create({
      data: {
        destinationKey: "permission-1",
        limitBytes: 1000n,
        usageBytes: 999n,
        fetchedAt: new Date(),
      },
    });
    const requests = google.requests.length;
    expect((await overview.getDriveOverview()).capacity).toEqual(snapshot);
    expect(google.requests).toHaveLength(requests);
    expect(await db.prisma.driveUsageHour.count()).toBe(1);
    expect(google.requestsTo("/drive/v3/about")[0]?.query.get("fields")).toBe(
      "storageQuota(limit,usage,usageInDrive,usageInDriveTrash)",
    );
    expect(JSON.stringify(snapshot)).not.toContain(CONNECTED_CREDENTIAL.accessToken);
  });

  it("does not display the legacy estimated cache as a Google reading", async () => {
    await db.prisma.driveCapacity.create({
      data: {
        destinationKey: "permission-1",
        limitBytes: 1000n,
        usageBytes: 999n,
        fetchedAt: new Date(),
      },
    });
    expect((await overview.getDriveOverview()).capacity).toBeNull();
    expect(google.requests).toHaveLength(0);
  });

  it("preserves the last successful reading if Google fails", async () => {
    const snapshot = await storage.refreshDriveStorage();
    google.failNext("about", { kind: "status", status: 503, body: { error: { code: 503 } } });
    await expect(storage.refreshDriveStorage()).rejects.toMatchObject({ kind: "TRANSIENT" });
    expect(await repository.readDriveStorage("permission-1")).toEqual(snapshot);
  });

  it("keeps omitted metrics unknown and supports no published storage limit", async () => {
    google.storageQuota = { usage: "123" };
    expect(await storage.refreshDriveStorage()).toMatchObject({
      limitBytes: null,
      usageBytes: 123,
      usageInDriveBytes: null,
      usageInDriveTrashBytes: null,
    });
  });

  it("requires a connected account and isolates saved readings by account", async () => {
    await storage.refreshDriveStorage();
    await store.writeDriveCredential({ ...CONNECTED_CREDENTIAL, accountId: "other" });
    expect((await overview.getDriveOverview()).capacity).toBeNull();
    await store.deleteDriveCredential();
    const requests = google.requests.length;
    await expect(storage.refreshDriveStorage()).rejects.toMatchObject({ code: "DRIVE_NOT_CONNECTED" });
    expect(google.requests).toHaveLength(requests);
  });
});
