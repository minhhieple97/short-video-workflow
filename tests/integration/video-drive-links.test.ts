import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as ArchiveControl from "@/features/archive/services/archive-control.service";
import type * as DbClient from "@/server/db/client";

import { seedArchiveVideo } from "../helpers/archive-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let control: typeof ArchiveControl;

let bookId: string;
let videoId: string;
let tick = 0;

type FileSpec = { kind: string; status: string; id?: string };

async function newVideo(): Promise<string> {
  return (await db.prisma.video.create({ data: { bookId, title: "Video khác", targetDurationSec: 60 } })).id;
}

// Each render is made a second after the one before, so "newest" is never a tie.
async function render(
  forVideo: string,
  options: { quality?: "DRAFT" | "FINAL"; status?: string; scriptVersion?: number } = {},
): Promise<string> {
  tick += 1;
  const record = await db.prisma.renderRecord.create({
    data: {
      videoId: forVideo,
      scriptVersion: options.scriptVersion ?? 1,
      outputPath: `videos/${forVideo}/renders/${tick}.mp4`,
      status: options.status ?? "COMPLETED",
      qualityPreset: options.quality ?? "FINAL",
      width: 1080,
      height: 1920,
      fps: 30,
      createdAt: new Date(Date.UTC(2026, 9, 30, 9, 0, tick)),
    },
  });
  return record.id;
}

async function archive(
  renderId: string,
  options: { status: string; destinationKey?: string; files?: FileSpec[]; folder?: string },
): Promise<string> {
  tick += 1;
  const record = await db.prisma.renderArchive.create({
    data: {
      renderId,
      provider: "google-drive",
      destinationKey: options.destinationKey ?? "account-1",
      status: options.status,
      remoteFolderId: options.folder ?? "folder-1",
      createdAt: new Date(Date.UTC(2026, 9, 30, 9, 30, tick)),
      files: {
        create: (options.files ?? []).map((file) => ({
          kind: file.kind,
          remoteName: `${file.kind}.bin`,
          remoteFileId: file.id ?? `${file.kind.toLowerCase()}-1`,
          status: file.status,
        })),
      },
    },
  });
  return record.id;
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  control = await import("@/features/archive/services/archive-control.service");
}, 60_000);

beforeEach(async () => {
  videoId = await seedArchiveVideo(db);
  bookId = (await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).bookId;
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("getVideoDriveLinks", () => {
  it("leaves out a video that has no finished FINAL render: there is nothing to put on Drive", async () => {
    const other = await newVideo();
    await render(videoId, { quality: "DRAFT" });
    await render(videoId, { quality: "FINAL", status: "RENDERING" });
    await render(other, { quality: "FINAL", status: "FAILED" });

    expect(await control.getVideoDriveLinks([videoId, other, "unknown"])).toEqual({});
    expect(await control.getVideoDriveLinks([])).toEqual({});
  });

  it("shows a finished FINAL render that no archive was made for", async () => {
    const renderId = await render(videoId);

    expect(await control.getVideoDriveLinks([videoId])).toEqual({
      [videoId]: { renderId, archive: null, outdated: false },
    });
  });

  it("links the folder and the video once the archive is complete", async () => {
    const renderId = await render(videoId);
    await archive(renderId, {
      status: "COMPLETED",
      files: [
        { kind: "VIDEO", status: "VERIFIED", id: "file-9" },
        { kind: "SCRIPT", status: "VERIFIED" },
        { kind: "MANIFEST", status: "VERIFIED" },
      ],
    });

    const drive = (await control.getVideoDriveLinks([videoId]))[videoId];

    expect(drive).toMatchObject({ renderId, outdated: false });
    expect(drive?.archive).toMatchObject({
      status: "COMPLETED",
      folderUrl: "https://drive.google.com/drive/folders/folder-1",
      videoUrl: "https://drive.google.com/file/d/file-9/view",
    });
  });

  it("links the video as soon as it is on Drive, before the rest of the archive and without the folder", async () => {
    const renderId = await render(videoId);
    await archive(renderId, {
      status: "RUNNING",
      files: [
        { kind: "VIDEO", status: "VERIFIED", id: "file-9" },
        { kind: "SCRIPT", status: "UPLOADING" },
      ],
    });

    expect((await control.getVideoDriveLinks([videoId]))[videoId]?.archive).toMatchObject({
      status: "RUNNING",
      folderUrl: null,
      videoUrl: "https://drive.google.com/file/d/file-9/view",
    });
  });

  it("links nothing while the video itself is still going up, and keeps the reason for a failure", async () => {
    const renderId = await render(videoId);
    const archiveId = await archive(renderId, { status: "RUNNING", files: [{ kind: "VIDEO", status: "UPLOADING" }] });
    expect((await control.getVideoDriveLinks([videoId]))[videoId]?.archive).toMatchObject({
      folderUrl: null,
      videoUrl: null,
    });

    await db.prisma.renderArchive.update({
      where: { id: archiveId },
      data: { status: "FAILED", errorCode: "DRIVE_QUOTA", errorMessage: "Drive hết dung lượng." },
    });
    expect((await control.getVideoDriveLinks([videoId]))[videoId]?.archive).toMatchObject({
      status: "FAILED",
      errorMessage: "Drive hết dung lượng.",
      videoUrl: null,
    });
  });

  it("speaks of the newest finished FINAL render, even when an older one is on Drive and the newest is not", async () => {
    const older = await render(videoId);
    await archive(older, { status: "COMPLETED", files: [{ kind: "VIDEO", status: "VERIFIED" }] });
    const newer = await render(videoId);

    expect((await control.getVideoDriveLinks([videoId]))[videoId]).toEqual({
      renderId: newer,
      archive: null,
      outdated: false,
    });
  });

  it("speaks of the newest archive of that render when it was archived for more than one account", async () => {
    const renderId = await render(videoId);
    await archive(renderId, { status: "COMPLETED", destinationKey: "account-1", folder: "old-folder" });
    await archive(renderId, { status: "PENDING", destinationKey: "account-2", folder: "new-folder" });

    expect((await control.getVideoDriveLinks([videoId]))[videoId]?.archive).toMatchObject({
      status: "PENDING",
      folderUrl: null,
    });
  });

  it("says the copy on Drive is old once the script has moved on", async () => {
    await render(videoId, { scriptVersion: 1 });
    await db.prisma.video.update({ where: { id: videoId }, data: { scriptVersion: 2 } });

    expect((await control.getVideoDriveLinks([videoId]))[videoId]?.outdated).toBe(true);
  });

  it("answers for several videos in one go", async () => {
    const other = await newVideo();
    const first = await render(videoId);
    const second = await render(other);
    await archive(second, { status: "COMPLETED", files: [{ kind: "VIDEO", status: "VERIFIED" }] });

    const drives = await control.getVideoDriveLinks([videoId, other]);

    expect(drives[videoId]).toMatchObject({ renderId: first, archive: null });
    expect(drives[other]).toMatchObject({ renderId: second, archive: { status: "COMPLETED" } });
  });
});
