import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as UsageRepository from "@/features/archive/repositories/drive-usage.repository";
import { DriveCapacityGuard, type DriveCapacity } from "@/server/archive/google-drive/drive-capacity";
import { GoogleDriveArchiveProvider } from "@/server/archive/google-drive/drive-archive-provider";
import { DriveRequestMeter, type DriveUsageLedger } from "@/server/archive/google-drive/drive-request-meter";
import { UPLOAD_CHUNK_UNIT } from "@/server/archive/google-drive/drive-resumable-upload";
import { GoogleDriveClient } from "@/server/archive/google-drive/google-drive-client";
import type * as DbClient from "@/server/db/client";

import { FakeGoogleServer } from "../helpers/fake-google-server";
import { InMemoryArchiveFolderStore } from "../helpers/fakes/in-memory-archive-folder-store";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let usage: typeof UsageRepository;
let google: FakeGoogleServer;

const HOUR = 60 * 60_000;
const T0 = new Date("2026-10-28T10:15:00.000Z");
const GIB = 1024 ** 3;

const reserve = (ledger: DriveUsageLedger, at: Date, bytes = 0, maxRequests = 5000, maxBytes = 10 * GIB) =>
  ledger.reserve({ at, bytes, maxRequests, maxBytes });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  usage = await import("@/features/archive/repositories/drive-usage.repository");
}, 60_000);

beforeEach(async () => {
  await db.prisma.driveUsageHour.deleteMany();
  await db.prisma.driveCapacity.deleteMany();
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

describe("driveUsageLedger", () => {
  it("counts requests and bytes per hour, for this app only", async () => {
    const ledger = usage.driveUsageLedger("google-drive");

    await reserve(ledger, T0, 100);
    await reserve(ledger, new Date(T0.getTime() + 10 * 60_000), 50);
    await reserve(ledger, new Date(T0.getTime() + HOUR), 7);
    await reserve(usage.driveUsageLedger("other-provider"), T0, 1000);

    expect(await usage.sumDriveUsage("google-drive", new Date(T0.getTime() + HOUR))).toEqual({
      requests: 3,
      bytesSent: 157,
    });
    const hours = await db.prisma.driveUsageHour.findMany({
      where: { provider: "google-drive" },
      orderBy: { hourStart: "asc" },
    });
    expect(hours.map((hour) => [hour.hourStart.toISOString(), hour.requests, Number(hour.bytesSent)])).toEqual([
      ["2026-10-28T10:00:00.000Z", 2, 150],
      ["2026-10-28T11:00:00.000Z", 1, 7],
    ]);
  });

  it("refuses the request that would pass the daily request limit and says when room comes back", async () => {
    const ledger = usage.driveUsageLedger("google-drive");
    await reserve(ledger, T0, 0, 3);
    await reserve(ledger, new Date(T0.getTime() + 2 * HOUR), 0, 3);
    await reserve(ledger, new Date(T0.getTime() + 3 * HOUR), 0, 3);

    const refused = await reserve(ledger, new Date(T0.getTime() + 5 * HOUR), 0, 3);

    // The oldest use (the 10:00 hour) leaves the window at 10:00 the next day.
    expect(refused).toEqual({ ok: false, limit: "requests", retryAfterMs: 24 * HOUR - 5 * HOUR - 15 * 60_000 });
    expect(await usage.sumDriveUsage("google-drive", new Date(T0.getTime() + 5 * HOUR))).toEqual({
      requests: 3,
      bytesSent: 0,
    });
  });

  it("judges the limits on this provider's use alone", async () => {
    await reserve(usage.driveUsageLedger("other-provider"), T0, 0, 1);

    expect(await reserve(usage.driveUsageLedger("google-drive"), T0, 0, 1)).toEqual({ ok: true });
  });

  it("refuses an upload that would pass the daily byte limit, counting nothing", async () => {
    const ledger = usage.driveUsageLedger("google-drive");
    await reserve(ledger, T0, 8 * GIB);

    expect(await reserve(ledger, T0, 3 * GIB)).toMatchObject({ ok: false, limit: "bytes" });
    expect(await reserve(ledger, T0, 2 * GIB)).toEqual({ ok: true });
    expect(await usage.sumDriveUsage("google-drive", T0)).toEqual({ requests: 2, bytesSent: 10 * GIB });
  });

  it("forgets use older than a day, so the limit is a rolling 24 hours", async () => {
    const ledger = usage.driveUsageLedger("google-drive");
    await reserve(ledger, T0, 0, 1);

    expect(await reserve(ledger, new Date(T0.getTime() + 23 * HOUR), 0, 1)).toMatchObject({ ok: false });
    expect(await reserve(ledger, new Date(T0.getTime() + 24 * HOUR), 0, 1)).toEqual({ ok: true });
    expect(await db.prisma.driveUsageHour.count()).toBe(1);
  });

  it("never lets two simultaneous reservations both take the last request", async () => {
    const ledger = usage.driveUsageLedger("google-drive");
    await reserve(ledger, T0, 0, 2);

    const results = await Promise.all([reserve(ledger, T0, 0, 2), reserve(ledger, T0, 0, 2)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });
});

describe("DriveRequestMeter", () => {
  function meter(options: { maxRequestsPerDay?: number; intervalMs?: number } = {}) {
    let clock = T0.getTime();
    const sleeps: number[] = [];
    const instance = new DriveRequestMeter({
      ledger: usage.driveUsageLedger("google-drive"),
      minIntervalMs: options.intervalMs ?? 1000,
      maxRequestsPerDay: options.maxRequestsPerDay ?? 5000,
      maxBytesPerDay: 10 * GIB,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    return { instance, sleeps, advance: (ms: number) => (clock += ms) };
  }

  it("leaves at least the interval between two requests, and no pause when enough time passed", async () => {
    const { instance, sleeps, advance } = meter();

    await instance.beforeRequest(0);
    advance(300);
    await instance.beforeRequest(0);
    advance(5000);
    await instance.beforeRequest(0);

    expect(sleeps).toEqual([700]);
  });

  it("reports a reached daily limit as QUOTA with the time to wait, without pausing", async () => {
    const { instance, sleeps } = meter({ maxRequestsPerDay: 1 });
    await instance.beforeRequest(0);

    const error = await instance.beforeRequest(0).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "DRIVE_APP_DAILY_LIMIT", kind: "QUOTA", details: { limit: "requests" } });
    expect((error as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(20 * HOUR);
    expect((error as Error).message).toContain("giới hạn của ứng dụng");
    expect(sleeps).toEqual([]);
  });

  it("meters every Drive request with the bytes it sends, including a retry after a refused token", async () => {
    const metered: number[] = [];
    const drive = new GoogleDriveClient({
      getAccessToken: async () => "t",
      invalidateAccessToken: () => undefined,
      beforeRequest: async (bytes) => void metered.push(bytes),
      endpoints: google.endpoints,
    });
    google.failNext("generateIds", { kind: "status", status: 401 });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-meter-"));
    const localPath = path.join(directory, "v.mp4");
    fs.writeFileSync(localPath, Buffer.alloc(UPLOAD_CHUNK_UNIT + 10, 1));
    const provider = new GoogleDriveArchiveProvider({
      drive,
      folders: new InMemoryArchiveFolderStore(),
      chunkBytes: UPLOAD_CHUNK_UNIT,
    });

    const destination = await provider.prepareDestination({ bookId: "b", videoId: "v", renderId: "r" });
    metered.length = 0;
    await provider.upload({
      destination,
      checkpoint: null,
      file: { kind: "VIDEO", localPath, remoteName: "v.mp4", mimeType: "video/mp4", bytes: UPLOAD_CHUNK_UNIT + 10 },
    });

    expect(google.requestsTo("/drive/v3/files/generateIds")).toHaveLength(2);
    expect(metered.slice(1)).toEqual([UPLOAD_CHUNK_UNIT, 10]);
    expect(metered[0]).toBeGreaterThan(0);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("Drive failures", () => {
  const drive = () => new GoogleDriveClient({ getAccessToken: async () => "t", endpoints: google.endpoints });
  const driveError = (reason: string) => ({ error: { code: 403, errors: [{ reason }] } });

  it("tells a full Drive apart from a rate limit, and neither from a permission problem", async () => {
    google.failNext("generateIds", { kind: "status", status: 403, body: driveError("storageQuotaExceeded") });
    google.failNext("generateIds", { kind: "status", status: 403, body: driveError("dailyLimitExceeded") });
    google.failNext("generateIds", { kind: "status", status: 403, body: driveError("sharingRateLimitExceeded") });
    google.failNext("generateIds", { kind: "status", status: 403, body: driveError("insufficientFilePermissions") });

    const full = await drive()
      .generateIds(1)
      .catch((caught: unknown) => caught);
    expect(full).toMatchObject({ code: "GOOGLE_STORAGEQUOTAEXCEEDED", kind: "REJECTED" });
    expect((full as Error).message).toContain("hết dung lượng");
    await expect(drive().generateIds(1)).rejects.toMatchObject({ kind: "QUOTA" });
    await expect(drive().generateIds(1)).rejects.toMatchObject({ kind: "QUOTA" });
    await expect(drive().generateIds(1)).rejects.toMatchObject({ kind: "AUTH" });
  });
});

describe("DriveCapacityGuard", () => {
  const cache = () => usage.driveCapacityCache("permission-1");
  const guard = (now = T0) =>
    new DriveCapacityGuard(
      new GoogleDriveClient({ getAccessToken: async () => "t", endpoints: google.endpoints }),
      cache(),
      () => now,
    );
  const aboutCalls = () => google.requestsTo("/drive/v3/about").length;

  it("reads the storage once, keeps it for an hour, and counts finished uploads into it", async () => {
    google.storageQuota = { limit: "1000", usage: "600" };

    await guard().ensureRoomFor(300);
    await guard(new Date(T0.getTime() + 59 * 60_000)).ensureRoomFor(300);
    await guard().recordUpload(300);

    expect(aboutCalls()).toBe(1);
    expect(google.requestsTo("/drive/v3/about")[0]?.query.get("fields")).toBe("storageQuota(limit,usage)");
    expect(await cache().read()).toEqual<DriveCapacity>({ limitBytes: 1000, usageBytes: 900, fetchedAt: T0 });
    await expect(guard().ensureRoomFor(101)).rejects.toMatchObject({ code: "DRIVE_STORAGE_FULL", kind: "REJECTED" });
  });

  it("refreshes a reading older than an hour", async () => {
    google.storageQuota = { limit: "1000", usage: "950" };
    await expect(guard().ensureRoomFor(100)).rejects.toMatchObject({ code: "DRIVE_STORAGE_FULL" });

    google.storageQuota = { limit: "1000", usage: "100" };
    await guard(new Date(T0.getTime() + 61 * 60_000)).ensureRoomFor(100);

    expect(aboutCalls()).toBe(2);
  });

  it("lets anything through on unlimited storage", async () => {
    google.storageQuota = { usage: "999999999999" };

    await guard().ensureRoomFor(10 * GIB);

    expect((await cache().read())?.limitBytes).toBeNull();
  });

  it("refuses a new upload that cannot fit before sending any of it, but lets a resumed one go on", async () => {
    google.storageQuota = { limit: "100", usage: "90" };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-capacity-"));
    const localPath = path.join(directory, "v.mp4");
    fs.writeFileSync(localPath, Buffer.alloc(50, 1));
    const drive = new GoogleDriveClient({ getAccessToken: async () => "t", endpoints: google.endpoints });
    const provider = new GoogleDriveArchiveProvider({
      drive,
      folders: new InMemoryArchiveFolderStore(),
      capacity: new DriveCapacityGuard(drive, cache(), () => T0),
    });
    const destination = await provider.prepareDestination({ bookId: "b", videoId: "v", renderId: "r" });
    const file = { kind: "VIDEO" as const, localPath, remoteName: "v.mp4", mimeType: "video/mp4", bytes: 50 };

    await expect(provider.upload({ destination, file, checkpoint: null })).rejects.toMatchObject({
      code: "DRIVE_STORAGE_FULL",
    });
    expect(google.requests.some((entry) => entry.path === "/upload/drive/v3/files")).toBe(false);

    const session = await drive.startResumableUpload({
      id: destination.fileIds.VIDEO,
      name: "v.mp4",
      parentId: destination.folderId,
      mimeType: "video/mp4",
      bytes: 50,
    });
    expect(await provider.upload({ destination, file, checkpoint: { token: session, bytesSent: 0 } })).toEqual({
      bytes: 50,
    });
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
