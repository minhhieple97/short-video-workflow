import type { Job } from "bullmq";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ArchiveControl from "@/features/archive/services/archive-control.service";
import type * as ArchiveRequest from "@/features/archive/services/archive-request.service";
import type * as ProviderFactory from "@/features/archive/services/drive-archive-provider.factory";
import type * as JobControl from "@/features/jobs/services/job-control.service";
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
let control: typeof ArchiveControl;
let requests: typeof ArchiveRequest;
let jobControl: typeof JobControl;
let store: typeof CredentialStore;
let processor: typeof ArchiveProcessor;
let google: FakeGoogleServer;

let videoId: string;
let renderId: string;

const runJob = (archiveId: string) =>
  processor.processArchiveRender({
    job: { data: { jobRecordId: "job-1", archiveId } } as unknown as Job,
    jobRecordId: "job-1",
    signal: new AbortController().signal,
    reportProgress: async () => undefined,
  } as ProcessorContext);
const archiveJobs = () => db.prisma.jobRecord.findMany({ where: { jobType: "ARCHIVE_RENDER" } });
const activeArchiveJobs = async () => (await archiveJobs()).filter((job) => job.status === "QUEUED");
const archive = (id: string) => db.prisma.renderArchive.findUniqueOrThrow({ where: { id }, include: { files: true } });
const fileOf = async (id: string, kind: string) => (await archive(id)).files.find((file) => file.kind === kind);

async function failedArchive(code: string): Promise<string> {
  const outcome = await requests.requestRenderArchive(renderId);
  if (outcome.status !== "REQUESTED") throw new Error("not requested");
  await db.prisma.jobRecord.updateMany({ data: { status: "FAILED" } });
  await db.prisma.renderArchive.update({
    where: { id: outcome.archiveId },
    data: { status: "FAILED", errorCode: code, errorMessage: "lỗi", retries: 3 },
  });
  return outcome.archiveId;
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  control = await import("@/features/archive/services/archive-control.service");
  requests = await import("@/features/archive/services/archive-request.service");
  jobControl = await import("@/features/jobs/services/job-control.service");
  store = await import("@/server/archive/google-drive/drive-credential-store");
  processor = await import("@/worker/processors/archive-render");
}, 60_000);

beforeEach(async () => {
  google = new FakeGoogleServer();
  await google.start();
  fake.endpoints = google.endpoints;
  await db.prisma.jobRecord.deleteMany();
  await db.prisma.archiveFolder.deleteMany();
  await db.prisma.driveCapacity.deleteMany();
  videoId = await seedArchiveVideo(db);
  renderId = await seedArchivableRender(db, env.dataDir, videoId);
  await store.writeDriveCredential(CONNECTED_CREDENTIAL);
});

afterEach(async () => {
  await google.stop();
  await store.deleteDriveCredential();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("GET /api/renders/:renderId/archive", () => {
  it("shows each archive's progress without the session token, local paths, checksums or account", async () => {
    const { GET } = await import("@/app/api/renders/[renderId]/archive/route");
    const outcome = await requests.requestRenderArchive(renderId);
    if (outcome.status !== "REQUESTED") throw new Error("not requested");
    await db.prisma.renderArchive.update({ where: { id: outcome.archiveId }, data: { remoteFolderId: "folder-x" } });
    await db.prisma.renderArchiveFile.updateMany({
      where: { archiveId: outcome.archiveId, kind: "VIDEO" },
      data: {
        status: "UPLOADING",
        checkpointToken: "http://127.0.0.1/upload?upload_id=secret-session",
        checkpointBytes: 1024,
        localPath: "videos/x/r.mp4",
        sha256: "abc123",
        bytes: 4000,
      },
    });

    const response = await GET(new Request("http://127.0.0.1:3000"), { params: Promise.resolve({ renderId }) });
    const text = await response.text();

    expect(response.status).toBe(200);
    const body = JSON.parse(text) as { archives: { files: { kind: string }[]; folderUrl: string | null }[] };
    expect(body.archives).toHaveLength(1);
    expect(body.archives[0]?.folderUrl).toBeNull();
    expect(body.archives[0]?.files.find((file) => file.kind === "VIDEO")).toMatchObject({
      status: "UPLOADING",
      uploadedBytes: 1024,
      bytes: 4000,
    });
    for (const hidden of [
      "secret-session",
      "videos/x/r.mp4",
      "abc123",
      "permission-1",
      "checkpointToken",
      "localPath",
    ]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("links to the Drive folder only once the archive is verified", async () => {
    const outcome = await requests.requestRenderArchive(renderId);
    if (outcome.status !== "REQUESTED") throw new Error("not requested");
    await runJob(outcome.archiveId);

    const { archives } = await control.getRenderArchives(renderId);

    const folder = (await archive(outcome.archiveId)).remoteFolderId;
    expect(archives[0]).toMatchObject({
      status: "COMPLETED",
      folderUrl: `https://drive.google.com/drive/folders/${folder}`,
    });
  });

  it("answers 404 for an unknown render", async () => {
    const { GET } = await import("@/app/api/renders/[renderId]/archive/route");

    const response = await GET(new Request("http://127.0.0.1:3000"), { params: Promise.resolve({ renderId: "nope" }) });

    expect(response.status).toBe(404);
  });
});

describe("POST /api/renders/:renderId/archive", () => {
  it("starts the archive of a finished FINAL render and answers 202", async () => {
    const { POST } = await import("@/app/api/renders/[renderId]/archive/route");

    const response = await POST(new Request("http://127.0.0.1:3000", { method: "POST" }), {
      params: Promise.resolve({ renderId }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "PENDING" });
    expect(await activeArchiveJobs()).toHaveLength(1);
  });

  it("refuses without a connection, and for a render that is not a finished FINAL", async () => {
    const draft = await seedArchivableRender(db, env.dataDir, videoId, { qualityPreset: "DRAFT" });
    await expect(control.archiveRenderNow(draft)).rejects.toMatchObject({
      code: "ARCHIVE_NOT_ARCHIVABLE",
      httpStatus: 409,
    });

    await store.deleteDriveCredential();
    await expect(control.archiveRenderNow(renderId)).rejects.toMatchObject({
      code: "DRIVE_NOT_CONNECTED",
      httpStatus: 409,
    });
    expect(await db.prisma.renderArchive.count()).toBe(0);
  });

  it("retries a failed archive from where it stopped: same remote IDs, same checkpoints, a new job, no render", async () => {
    const archiveId = await failedArchive("DRIVE_STORAGE_FULL");
    await db.prisma.renderArchive.update({ where: { id: archiveId }, data: { remoteFolderId: "folder-1" } });
    await db.prisma.renderArchiveFile.updateMany({
      where: { archiveId },
      data: { remoteFileId: "kept", status: "UPLOADING", checkpointToken: "session", checkpointBytes: 512 },
    });

    const dto = await control.archiveRenderNow(renderId);

    expect(dto).toMatchObject({ id: archiveId, status: "PENDING", errorCode: null, errorMessage: null, retries: 0 });
    const stored = await archive(archiveId);
    expect(stored.remoteFolderId).toBe("folder-1");
    expect(stored.files.every((file) => file.remoteFileId === "kept" && file.checkpointToken === "session")).toBe(true);
    expect(await activeArchiveJobs()).toHaveLength(1);
    expect(new Set((await db.prisma.jobRecord.findMany()).map((job) => job.jobType))).toEqual(
      new Set(["ARCHIVE_RENDER"]),
    );
  });

  it("starts one job when the same archive is retried twice at once", async () => {
    const archiveId = await failedArchive("GOOGLE_HTTP_503");
    const { resetArchiveForRetry } = await import("@/features/archive/repositories/render-archive.repository");

    await Promise.all([control.archiveRenderNow(renderId), control.archiveRenderNow(renderId)]);
    expect(await activeArchiveJobs()).toHaveLength(1);

    await db.prisma.renderArchive.update({ where: { id: archiveId }, data: { status: "FAILED" } });
    const results = await Promise.all([
      resetArchiveForRetry(archiveId, "RESUME"),
      resetArchiveForRetry(archiveId, "RESUME"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("gives files that did not match new IDs, keeping the verified ones", async () => {
    const archiveId = await failedArchive("ARCHIVE_REMOTE_MISMATCH");
    await db.prisma.renderArchive.update({ where: { id: archiveId }, data: { remoteFolderId: "folder-1" } });
    await db.prisma.renderArchiveFile.updateMany({ where: { archiveId }, data: { remoteFileId: "old" } });
    await db.prisma.renderArchiveFile.updateMany({
      where: { archiveId, kind: "VIDEO" },
      data: { status: "VERIFIED", verifiedAt: new Date() },
    });
    await db.prisma.renderArchiveFile.updateMany({
      where: { archiveId, kind: "MANIFEST" },
      data: { status: "UPLOADED" },
    });

    await control.archiveRenderNow(renderId);

    expect(await fileOf(archiveId, "VIDEO")).toMatchObject({ status: "VERIFIED", remoteFileId: "old" });
    expect(await fileOf(archiveId, "MANIFEST")).toMatchObject({ status: "PENDING", remoteFileId: null });
    expect((await archive(archiveId)).remoteFolderId).toBe("folder-1");
  });

  it("rebuilds the render's folder when it was removed from Drive, and then finishes", async () => {
    const outcome = await requests.requestRenderArchive(renderId);
    if (outcome.status !== "REQUESTED") throw new Error("not requested");
    google.failNext("startUpload", {
      kind: "status",
      status: 403,
      body: { error: { errors: [{ reason: "storageQuotaExceeded" }] } },
    });
    await expect(runJob(outcome.archiveId)).rejects.toThrow();
    const oldFolder = (await archive(outcome.archiveId)).remoteFolderId ?? "";
    google.objects.delete(oldFolder);
    await db.prisma.renderArchive.update({ where: { id: outcome.archiveId }, data: { status: "PENDING" } });
    await expect(runJob(outcome.archiveId)).rejects.toMatchObject({ code: "ARCHIVE_FOLDER_MISSING" });

    await control.archiveRenderNow(renderId);
    const reset = await archive(outcome.archiveId);
    expect(reset.remoteFolderId).toBeNull();
    expect(reset.files.every((file) => file.remoteFileId === null && file.status === "PENDING")).toBe(true);

    expect(await runJob(outcome.archiveId)).toEqual({ archiveId: outcome.archiveId, outcome: "COMPLETED" });
    const done = await archive(outcome.archiveId);
    expect(done.remoteFolderId).not.toBe(oldFolder);
    expect(google.objects.has(done.remoteFolderId ?? "")).toBe(true);
  });

  it("returns a finished archive as it is, and gives an archive in progress its job back", async () => {
    const outcome = await requests.requestRenderArchive(renderId);
    if (outcome.status !== "REQUESTED") throw new Error("not requested");
    await db.prisma.jobRecord.updateMany({ data: { status: "FAILED" } });

    await control.archiveRenderNow(renderId);
    expect(await activeArchiveJobs()).toHaveLength(1);

    await db.prisma.renderArchive.update({ where: { id: outcome.archiveId }, data: { status: "COMPLETED" } });
    await db.prisma.jobRecord.updateMany({ data: { status: "COMPLETED" } });
    expect(await control.archiveRenderNow(renderId)).toMatchObject({ status: "COMPLETED" });
    expect(await activeArchiveJobs()).toHaveLength(0);
  });
});

describe("retrying an archive job from the jobs page", () => {
  it("retries the archive and hands back its new job", async () => {
    const archiveId = await failedArchive("GOOGLE_HTTP_503");
    const [failedJob] = await archiveJobs();

    const job = await jobControl.retryJob(failedJob?.id ?? "");

    expect(job).toMatchObject({ jobType: "ARCHIVE_RENDER", status: "QUEUED" });
    expect(job.id).not.toBe(failedJob?.id);
    expect((await archive(archiveId)).status).toBe("PENDING");
  });
});
