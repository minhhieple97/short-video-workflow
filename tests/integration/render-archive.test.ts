import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as ArchiveRepository from "@/features/archive/repositories/render-archive.repository";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let repo: typeof ArchiveRepository;
let renderId: string;

const FILES = [
  { kind: "VIDEO", remoteName: "video_s1_r_1080x1920.mp4" },
  { kind: "SCRIPT", remoteName: "script.json" },
  { kind: "MANIFEST", remoteName: "manifest.json" },
] as const;
const DESTINATION = { folderId: "folder-1", fileIds: { VIDEO: "file-v", SCRIPT: "file-s", MANIFEST: "file-m" } };

const target = (destinationKey = "account-a") => ({ renderId, provider: "google-drive", destinationKey });
const file = async (archiveId: string, kind: string) =>
  db.prisma.renderArchiveFile.findUniqueOrThrow({ where: { archiveId_kind: { archiveId, kind } } });

async function archiveWithIds(): Promise<string> {
  const { archive } = await repo.ensureRenderArchive(target(), FILES);
  await repo.saveRemoteIds(archive.id, DESTINATION);
  return archive.id;
}

async function verifyAll(archiveId: string): Promise<void> {
  for (const { kind } of FILES) {
    await repo.markFileUploaded(archiveId, kind, 10);
    await repo.markFileVerified(archiveId, kind);
  }
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  repo = await import("@/features/archive/repositories/render-archive.repository");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  const book = await db.prisma.book.create({
    data: {
      title: "Sách",
      sourceFilePath: "books/x/original.md",
      sourceFileName: "x.md",
      sourceHash: `hash-${Math.random()}`,
      sourceFormat: "md",
      sourceSizeBytes: 1,
      status: "ACTIVE",
    },
  });
  const video = await db.prisma.video.create({
    data: { bookId: book.id, title: "Video", targetDurationSec: 60, status: "DRAFT" },
  });
  const render = await db.prisma.renderRecord.create({
    data: {
      videoId: video.id,
      scriptVersion: 1,
      outputPath: "videos/v/renders/r.mp4",
      status: "COMPLETED",
      qualityPreset: "FINAL",
      width: 1080,
      height: 1920,
      fps: 30,
    },
  });
  renderId = render.id;
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("ensureRenderArchive", () => {
  it("creates one archive with one pending entry per file, and returns the same one when asked again", async () => {
    const first = await repo.ensureRenderArchive(target(), FILES);
    const again = await repo.ensureRenderArchive(target(), FILES);

    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, archive: { id: first.archive.id } });
    expect(first.archive.status).toBe("PENDING");
    expect(first.archive.files.map((entry) => [entry.kind, entry.status, entry.remoteFileId])).toEqual([
      ["MANIFEST", "PENDING", null],
      ["SCRIPT", "PENDING", null],
      ["VIDEO", "PENDING", null],
    ]);
  });

  it("makes one archive when several callers ask at once", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => repo.ensureRenderArchive(target(), FILES)));

    expect(new Set(results.map((result) => result.archive.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await db.prisma.renderArchiveFile.count()).toBe(3);
  });

  it("keeps a separate archive for another destination of the same render", async () => {
    const a = await repo.ensureRenderArchive(target("account-a"), FILES);
    const b = await repo.ensureRenderArchive(target("account-b"), FILES);

    expect(b.created).toBe(true);
    expect(b.archive.id).not.toBe(a.archive.id);
  });

  it("leaves the render untouched and goes away with it", async () => {
    await repo.ensureRenderArchive(target(), FILES);
    const render = await db.prisma.renderRecord.findUniqueOrThrow({ where: { id: renderId } });
    expect(render.status).toBe("COMPLETED");

    await db.prisma.renderRecord.delete({ where: { id: renderId } });

    expect(await db.prisma.renderArchive.count()).toBe(0);
    expect(await db.prisma.renderArchiveFile.count()).toBe(0);
  });
});

describe("saveRemoteIds", () => {
  it("stores the folder and one remote ID per file", async () => {
    const archiveId = await archiveWithIds();

    const archive = await repo.findRenderArchive(archiveId);
    expect(archive && repo.storedDestination(archive)).toEqual(DESTINATION);
  });

  it("never replaces IDs that were already allocated, and hands back the stored ones", async () => {
    const archiveId = await archiveWithIds();

    const second = await repo.saveRemoteIds(archiveId, {
      folderId: "folder-2",
      fileIds: { VIDEO: "other-v", SCRIPT: "other-s", MANIFEST: "other-m" },
    });

    expect(second).toEqual(DESTINATION);
  });

  it("reports no destination until every ID is stored", async () => {
    const { archive } = await repo.ensureRenderArchive(target(), FILES);
    await db.prisma.renderArchive.update({ where: { id: archive.id }, data: { remoteFolderId: "folder-1" } });
    await db.prisma.renderArchiveFile.updateMany({
      where: { archiveId: archive.id, kind: { in: ["VIDEO", "SCRIPT"] } },
      data: { remoteFileId: "x" },
    });

    const stored = await repo.findRenderArchive(archive.id);
    expect(stored && repo.storedDestination(stored)).toBeNull();
  });
});

describe("upload checkpoints", () => {
  it("records the local file once, before the upload starts", async () => {
    const archiveId = await archiveWithIds();

    expect(await repo.saveLocalFile(archiveId, "VIDEO", { localPath: "a.mp4", bytes: 100, sha256: "aa" })).toBe(true);
    await repo.saveUploadCheckpoint(archiveId, "VIDEO", { token: "session-1", bytesSent: 10 });

    expect(await repo.saveLocalFile(archiveId, "VIDEO", { localPath: "b.mp4", bytes: 5, sha256: "bb" })).toBe(false);
    expect(await file(archiveId, "VIDEO")).toMatchObject({ localPath: "a.mp4", bytes: 100, sha256: "aa" });
  });

  it("only moves forward within one session, and starts over for a new one", async () => {
    const archiveId = await archiveWithIds();

    expect(await repo.saveUploadCheckpoint(archiveId, "VIDEO", { token: "session-1", bytesSent: 50 })).toBe(true);
    expect(await repo.saveUploadCheckpoint(archiveId, "VIDEO", { token: "session-1", bytesSent: 20 })).toBe(false);
    expect(await repo.saveUploadCheckpoint(archiveId, "VIDEO", { token: "session-1", bytesSent: 50 })).toBe(true);
    expect(await file(archiveId, "VIDEO")).toMatchObject({
      status: "UPLOADING",
      checkpointToken: "session-1",
      checkpointBytes: 50,
    });

    expect(await repo.saveUploadCheckpoint(archiveId, "VIDEO", { token: "session-2", bytesSent: 0 })).toBe(true);
    expect(await file(archiveId, "VIDEO")).toMatchObject({ checkpointToken: "session-2", checkpointBytes: 0 });
  });

  it("drops the session token once the file is uploaded, and takes no checkpoint after that", async () => {
    const archiveId = await archiveWithIds();
    await repo.saveUploadCheckpoint(archiveId, "VIDEO", { token: "session-1", bytesSent: 50 });

    expect(await repo.markFileUploaded(archiveId, "VIDEO", 100)).toBe(true);

    expect(await file(archiveId, "VIDEO")).toMatchObject({
      status: "UPLOADED",
      checkpointToken: null,
      checkpointBytes: 100,
    });
    expect(await repo.saveUploadCheckpoint(archiveId, "VIDEO", { token: "late", bytesSent: 100 })).toBe(false);
  });

  it("verifies only a file that was uploaded", async () => {
    const archiveId = await archiveWithIds();

    expect(await repo.markFileVerified(archiveId, "SCRIPT")).toBe(false);
    await repo.markFileUploaded(archiveId, "SCRIPT", 10);
    expect(await repo.markFileVerified(archiveId, "SCRIPT")).toBe(true);
    expect((await file(archiveId, "SCRIPT")).verifiedAt).not.toBeNull();
  });

  it("abandons an upload session that cannot be resumed, keeping the remote file", async () => {
    const archiveId = await archiveWithIds();
    await repo.saveUploadCheckpoint(archiveId, "VIDEO", { token: "expired-session", bytesSent: 70 });

    await repo.restartFileUpload(archiveId, "VIDEO");

    expect(await file(archiveId, "VIDEO")).toMatchObject({
      status: "PENDING",
      remoteFileId: "file-v",
      checkpointToken: null,
      checkpointBytes: 0,
    });
  });

  it("uploads a mismatched file again into the same remote file, from the start", async () => {
    const archiveId = await archiveWithIds();
    await repo.markFileUploaded(archiveId, "SCRIPT", 10);
    await repo.markFileVerified(archiveId, "SCRIPT");

    await repo.restartFileUpload(archiveId, "SCRIPT");

    expect(await file(archiveId, "SCRIPT")).toMatchObject({
      status: "PENDING",
      remoteFileId: "file-s",
      checkpointToken: null,
      checkpointBytes: 0,
      verifiedAt: null,
    });
  });
});

describe("archive status", () => {
  it("completes only when every file was verified", async () => {
    const archiveId = await archiveWithIds();
    await repo.markFileUploaded(archiveId, "VIDEO", 10);
    await repo.markFileVerified(archiveId, "VIDEO");

    expect(await repo.completeArchive(archiveId)).toBe(false);

    await verifyAll(archiveId);
    expect(await repo.completeArchive(archiveId)).toBe(true);
    const archive = await repo.findRenderArchive(archiveId);
    expect(archive).toMatchObject({ status: "COMPLETED", errorCode: null });
    expect(archive?.completedAt).not.toBeNull();
  });

  it("records a failure and clears it when the archive runs again", async () => {
    const archiveId = await archiveWithIds();

    await repo.setArchiveStatus(archiveId, "FAILED", { code: "ARCHIVE_AUTH_REQUIRED", message: "Cần kết nối lại." });
    expect(await repo.findRenderArchive(archiveId)).toMatchObject({
      status: "FAILED",
      errorCode: "ARCHIVE_AUTH_REQUIRED",
    });

    await repo.setArchiveStatus(archiveId, "RUNNING");
    expect(await repo.findRenderArchive(archiveId)).toMatchObject({ status: "RUNNING", errorCode: null });
  });

  it("never reopens a completed archive", async () => {
    const archiveId = await archiveWithIds();
    await verifyAll(archiveId);
    await repo.completeArchive(archiveId);

    expect(await repo.setArchiveStatus(archiveId, "RUNNING")).toBe(false);
    expect(await repo.completeArchive(archiveId)).toBe(false);
    expect((await repo.findRenderArchive(archiveId))?.status).toBe("COMPLETED");
  });

  it("lists the archives that still have work to do, oldest first", async () => {
    const done = await archiveWithIds();
    await verifyAll(done);
    await repo.completeArchive(done);
    const waiting = (await repo.ensureRenderArchive(target("account-b"), FILES)).archive.id;
    await repo.setArchiveStatus(waiting, "WAITING");
    const failed = (await repo.ensureRenderArchive(target("account-c"), FILES)).archive.id;
    await repo.setArchiveStatus(failed, "FAILED", { code: "X", message: "x" });
    const pending = (await repo.ensureRenderArchive(target("account-d"), FILES)).archive.id;

    expect(await repo.listUnfinishedArchiveIds()).toEqual([waiting, pending]);
  });
});
