import type { Job } from "bullmq";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ArchiveRequest from "@/features/archive/services/archive-request.service";
import type * as ProviderFactory from "@/features/archive/services/drive-archive-provider.factory";
import type * as JobDashboard from "@/features/jobs/services/job-dashboard.service";
import type * as JobEffects from "@/features/jobs/services/job-effects";
import type * as CredentialStore from "@/server/archive/google-drive/drive-credential-store";
import type { GoogleEndpoints } from "@/server/archive/google-drive/google-http";
import type * as DbClient from "@/server/db/client";
import type * as ArchiveProcessor from "@/worker/processors/archive-render";
import type { ProcessorContext } from "@/worker/processors/types";

import { CONNECTED_CREDENTIAL, seedArchivableRender, seedArchiveVideo } from "../helpers/archive-fixture";
import { FakeGoogleServer } from "../helpers/fake-google-server";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const fake = vi.hoisted(() => ({ endpoints: null as GoogleEndpoints | null }));

vi.mock("@/features/archive/services/drive-archive-provider.factory", async (importOriginal) => {
  const actual = await importOriginal<typeof ProviderFactory>();
  const { TEST_DRIVE_CONFIG } = await import("../helpers/archive-fixture");
  return {
    createDriveArchiveProvider: (destinationKey: string) =>
      actual.createDriveArchiveProvider(destinationKey, {
        endpoints: fake.endpoints ?? undefined,
        drive: TEST_DRIVE_CONFIG,
      }),
  };
});

let env: TestEnvironment;
let db: typeof DbClient;
let requests: typeof ArchiveRequest;
let store: typeof CredentialStore;
let processor: typeof ArchiveProcessor;
let effects: typeof JobEffects;
let dashboard: typeof JobDashboard;
let google: FakeGoogleServer;

let videoId: string;
let renderId: string;

const CREDENTIAL = CONNECTED_CREDENTIAL;
const seedRender = (overrides: { qualityPreset?: "DRAFT" | "FINAL"; archiveIntentAt?: Date | null } = {}) =>
  seedArchivableRender(db, env.dataDir, videoId, overrides);

const archiveJobs = () =>
  db.prisma.jobRecord.findMany({ where: { jobType: "ARCHIVE_RENDER" }, include: { dispatch: true } });
const archiveOf = (id: string) => db.prisma.renderArchive.findFirstOrThrow({ where: { renderId: id } });
const runJob = (archiveId: string, signal = new AbortController().signal) =>
  processor.processArchiveRender({
    job: { data: { jobRecordId: "job-1", archiveId } } as unknown as Job,
    jobRecordId: "job-1",
    lane: "archive",
    signal,
    reportProgress: async () => undefined,
  } as ProcessorContext);

async function requested(id = renderId): Promise<string> {
  const outcome = await requests.requestRenderArchive(id);
  if (outcome.status !== "REQUESTED") throw new Error(`expected REQUESTED, got ${outcome.status}`);
  return outcome.archiveId;
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  requests = await import("@/features/archive/services/archive-request.service");
  store = await import("@/server/archive/google-drive/drive-credential-store");
  processor = await import("@/worker/processors/archive-render");
  effects = await import("@/features/jobs/services/job-effects");
  dashboard = await import("@/features/jobs/services/job-dashboard.service");
}, 60_000);

beforeEach(async () => {
  await db.prisma.providerCooldown.deleteMany();
  google = new FakeGoogleServer();
  await google.start();
  fake.endpoints = google.endpoints;
  await db.prisma.jobRecord.deleteMany();
  await db.prisma.archiveFolder.deleteMany();
  await db.prisma.driveUsageHour.deleteMany();
  await db.prisma.driveCapacity.deleteMany();
  videoId = await seedArchiveVideo(db);
  renderId = await seedRender();
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

describe("requestRenderArchive", () => {
  it("creates the archive, its three entries and its job together, once", async () => {
    const archiveId = await requested();
    await requested();

    const archive = await db.prisma.renderArchive.findUniqueOrThrow({
      where: { id: archiveId },
      include: { files: true },
    });
    expect(archive).toMatchObject({ provider: "google-drive", destinationKey: "permission-1", status: "PENDING" });
    expect(archive.files.map((file) => [file.kind, file.remoteName]).sort()).toEqual([
      ["MANIFEST", "manifest.json"],
      ["SCRIPT", "script.json"],
      ["VIDEO", `video_s2_${renderId}_1080x1920.mp4`],
    ]);
    const jobs = await archiveJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ entityType: "ARCHIVE", entityId: archiveId, status: "QUEUED" });
    expect(JSON.parse(jobs[0]?.dispatch?.payloadJson ?? "null")).toEqual({ archiveId });
  });

  it("does nothing without a usable Drive connection, leaving the intent for later", async () => {
    await store.deleteDriveCredential();
    expect(await requests.requestRenderArchive(renderId)).toEqual({ status: "NOT_CONNECTED" });

    await store.writeDriveCredential({ ...CREDENTIAL, status: "NEEDS_RECONNECT" });
    expect(await requests.requestRenderArchive(renderId)).toEqual({ status: "NOT_CONNECTED" });

    expect(await db.prisma.renderArchive.count()).toBe(0);
    expect(await archiveJobs()).toHaveLength(0);
  });

  it("archives any finished render that asked for it, a draft included, and not one that did not", async () => {
    const draft = await seedRender({ qualityPreset: "DRAFT" });
    const noIntent = await seedRender({ archiveIntentAt: null });

    expect(await requests.requestRenderArchive(draft)).toMatchObject({ status: "REQUESTED", created: true });
    expect(await requests.requestRenderArchive(noIntent)).toEqual({ status: "NOT_ARCHIVABLE" });
    expect(await requests.requestRenderArchive("missing")).toEqual({ status: "NOT_ARCHIVABLE" });
  });

  it("archives a render that never asked when the user asks, but never one that has not finished", async () => {
    const older = await seedRender({ qualityPreset: "DRAFT", archiveIntentAt: null });
    const unfinished = await seedRender();
    await db.prisma.renderRecord.update({ where: { id: unfinished }, data: { status: "RENDERING" } });

    expect(await requests.requestRenderArchive(older, undefined, { userRequested: true })).toMatchObject({
      status: "REQUESTED",
      created: true,
    });
    expect(await requests.requestRenderArchive(unfinished, undefined, { userRequested: true })).toEqual({
      status: "NOT_ARCHIVABLE",
    });
  });
});

describe("processArchiveRender", () => {
  it("uploads the archive and touches nothing but Drive: no render, voice-over or AI job, render unchanged", async () => {
    const before = await db.prisma.renderRecord.findUniqueOrThrow({ where: { id: renderId } });
    const archiveId = await requested();

    expect(await runJob(archiveId)).toEqual({ archiveId, outcome: "COMPLETED" });

    expect((await archiveOf(renderId)).status).toBe("COMPLETED");
    expect(new Set((await db.prisma.jobRecord.findMany()).map((job) => job.jobType))).toEqual(
      new Set(["ARCHIVE_RENDER"]),
    );
    expect(await db.prisma.renderRecord.findUniqueOrThrow({ where: { id: renderId } })).toEqual(before);
    expect(google.requests.every((request) => request.headers.authorization === "Bearer ya29.stored")).toBe(true);
    expect(await db.prisma.driveUsageHour.count()).toBe(1);
  });

  it("waits out a temporary failure with a growing pause, keeping the reason on the archive", async () => {
    const archiveId = await requested();
    google.failNext("generateIds", { kind: "status", status: 503 });
    google.failNext("generateIds", { kind: "status", status: 503 });

    expect(await runJob(archiveId)).toEqual({ deferred: true, retryAfterMs: 30_000 });
    expect(await archiveOf(renderId)).toMatchObject({ status: "WAITING", retries: 1, errorCode: "GOOGLE_HTTP_503" });
    expect(await runJob(archiveId)).toMatchObject({ deferred: true });
    expect((await archiveOf(renderId)).retries).toBe(1);
    await db.prisma.providerCooldown.updateMany({ data: { blockedUntil: new Date(0) } });
    expect(await runJob(archiveId)).toEqual({ deferred: true, retryAfterMs: 60_000 });
    await db.prisma.providerCooldown.updateMany({ data: { blockedUntil: new Date(0) } });

    expect(await runJob(archiveId)).toEqual({ archiveId, outcome: "COMPLETED" });
  });

  it("uses the pause Google asks for on a rate limit", async () => {
    const archiveId = await requested();
    google.failNext("generateIds", {
      kind: "status",
      status: 429,
      headers: { "retry-after": "120" },
      body: { error: { errors: [{ reason: "rateLimitExceeded" }] } },
    });

    expect(await runJob(archiveId)).toEqual({ deferred: true, retryAfterMs: 120_000 });
  });

  it("gives up after a bounded number of temporary failures, with the reason", async () => {
    const archiveId = await requested();
    await db.prisma.renderArchive.update({
      where: { id: archiveId },
      data: { retries: processor.MAX_ARCHIVE_RETRIES },
    });
    google.failNext("generateIds", { kind: "status", status: 503 });

    await expect(runJob(archiveId)).rejects.toMatchObject({ code: "GOOGLE_HTTP_503" });
    const archive = await archiveOf(renderId);
    expect(archive.status).toBe("FAILED");
    expect(archive.errorMessage).toContain(`đã thử lại ${processor.MAX_ARCHIVE_RETRIES} lần`);
  });

  it("caps the growing pause", () => {
    expect([1, 2, 3, 7, 20].map((retries) => processor.archiveBackoffMs(retries))).toEqual([
      30_000, 60_000, 120_000, 1_800_000, 1_800_000,
    ]);
  });

  it("fails at once when the Drive is full, without uploading", async () => {
    google.storageQuota = { limit: "1000", usage: "999" };
    const archiveId = await requested();

    await expect(runJob(archiveId)).rejects.toMatchObject({ code: "DRIVE_STORAGE_FULL" });
    expect(await archiveOf(renderId)).toMatchObject({ status: "FAILED", errorCode: "DRIVE_STORAGE_FULL" });
    expect(google.requests.some((request) => request.path === "/upload/drive/v3/files")).toBe(false);
  });

  it("fails when the connection needs a new sign-in or now belongs to another account", async () => {
    const archiveId = await requested();
    await store.writeDriveCredential({ ...CREDENTIAL, status: "NEEDS_RECONNECT" });
    await expect(runJob(archiveId)).rejects.toMatchObject({ code: "DRIVE_RECONNECT_REQUIRED" });

    const other = await seedRender();
    await store.writeDriveCredential(CREDENTIAL);
    const otherArchive = await requested(other);
    await store.writeDriveCredential({ ...CREDENTIAL, accountId: "permission-2" });
    await expect(runJob(otherArchive)).rejects.toMatchObject({ code: "ARCHIVE_DESTINATION_CHANGED" });
    expect(google.requests).toHaveLength(0);
  });

  it("leaves a failed archive for the user's retry and reports a completed one as done", async () => {
    const archiveId = await requested();
    await db.prisma.renderArchive.update({ where: { id: archiveId }, data: { status: "FAILED" } });
    expect(await runJob(archiveId)).toEqual({ archiveId, skipped: true });

    await db.prisma.renderArchive.update({ where: { id: archiveId }, data: { status: "COMPLETED" } });
    await store.writeDriveCredential({ ...CREDENTIAL, accountId: "permission-2" });
    expect(await runJob(archiveId)).toEqual({ archiveId, outcome: "COMPLETED" });
    expect((await archiveOf(renderId)).status).toBe("COMPLETED");
    expect(google.requests).toHaveLength(0);
  });

  it("lets a cancelled job end untouched, and cancelling the job stops the archive", async () => {
    const archiveId = await requested();
    const controller = new AbortController();
    controller.abort();

    await expect(runJob(archiveId, controller.signal)).rejects.toThrow();
    expect((await archiveOf(renderId)).retries).toBe(0);

    const [job] = await archiveJobs();
    if (!job) throw new Error("no job");
    await effects.releaseJobEntity(job, "CANCELLED", "Đã huỷ.");
    expect(await archiveOf(renderId)).toMatchObject({ status: "FAILED", errorCode: "ARCHIVE_CANCELLED" });

    await db.prisma.renderArchive.update({ where: { id: archiveId }, data: { status: "COMPLETED", errorCode: null } });
    await effects.releaseJobEntity(job, "CANCELLED", "Đã huỷ.");
    expect(await archiveOf(renderId)).toMatchObject({ status: "COMPLETED", errorCode: null });
  });
});

describe("sweepRenderArchives", () => {
  it("archives finished renders that were waiting for a connection, drafts too, once", async () => {
    await seedRender({ qualityPreset: "DRAFT" });
    await seedRender({ archiveIntentAt: null });

    // The final render of beforeEach and the draft; a render that never asked waits for the user's click.
    expect(await requests.sweepRenderArchives()).toEqual({ requested: 2, resumed: 0 });
    expect(await requests.sweepRenderArchives()).toEqual({ requested: 0, resumed: 0 });
    expect(await db.prisma.renderArchive.count()).toBe(2);
    expect(await archiveJobs()).toHaveLength(2);
  });

  it("gives a job back to an unfinished archive that lost its own, and leaves a failed one alone", async () => {
    const archiveId = await requested();
    const failed = await requested(await seedRender());
    await db.prisma.jobRecord.updateMany({ data: { status: "FAILED" } });
    await db.prisma.renderArchive.update({ where: { id: failed }, data: { status: "FAILED" } });

    expect(await requests.sweepRenderArchives()).toEqual({ requested: 0, resumed: 1 });
    const active = (await archiveJobs()).filter((job) => job.status === "QUEUED");
    expect(active.map((job) => job.entityId)).toEqual([archiveId]);
  });

  it("does nothing without a connection", async () => {
    await store.deleteDriveCredential();

    expect(await requests.sweepRenderArchives()).toEqual({ requested: 0, resumed: 0 });
    expect(await db.prisma.renderArchive.count()).toBe(0);
  });

  it("starts a fresh archive in the newly connected account and leaves the old account's archive alone", async () => {
    await requested();
    await db.prisma.jobRecord.updateMany({ data: { status: "FAILED" } });
    await store.writeDriveCredential({ ...CREDENTIAL, accountId: "permission-2" });

    expect(await requests.sweepRenderArchives()).toEqual({ requested: 1, resumed: 0 });
    expect((await db.prisma.renderArchive.findMany()).map((archive) => archive.destinationKey).sort()).toEqual([
      "permission-1",
      "permission-2",
    ]);
    const active = (await archiveJobs()).filter((job) => job.status === "QUEUED");
    const newArchive = await db.prisma.renderArchive.findFirstOrThrow({ where: { destinationKey: "permission-2" } });
    expect(active.map((job) => job.entityId)).toEqual([newArchive.id]);
  });
});

describe("the jobs page", () => {
  it("names an archive job after its video and links to the render page", async () => {
    await requested();

    const [job] = await dashboard.listJobsForDashboard();

    expect(job).toMatchObject({
      jobType: "ARCHIVE_RENDER",
      entityLabel: "Lưu Drive · Video",
      entityHref: `/videos/${videoId}/render`,
    });
  });
});
