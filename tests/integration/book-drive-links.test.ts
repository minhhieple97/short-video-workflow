import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as DriveLinksRoute from "@/app/api/books/[bookId]/drive-links/route";
import type * as BookDriveLinks from "@/features/archive/services/book-drive-links.service";
import type * as DbClient from "@/server/db/client";

import { seedArchiveVideo } from "../helpers/archive-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let service: typeof BookDriveLinks;
let route: typeof DriveLinksRoute;

let bookId: string;
let first: string;
let tick = 0;

// Every row is made a second after the one before, so "oldest first" is never a tie.
const at = () => new Date(Date.UTC(2026, 9, 30, 9, 0, (tick += 1)));

async function video(title: string, forBook = bookId): Promise<string> {
  return (
    await db.prisma.video.create({
      data: { bookId: forBook, title, targetDurationSec: 60, createdAt: at() },
    })
  ).id;
}

async function finalRender(videoId: string): Promise<string> {
  return (
    await db.prisma.renderRecord.create({
      data: {
        videoId,
        scriptVersion: 1,
        outputPath: `videos/${videoId}/final.mp4`,
        status: "COMPLETED",
        qualityPreset: "FINAL",
        width: 1080,
        height: 1920,
        fps: 30,
        createdAt: at(),
      },
    })
  ).id;
}

async function archive(renderId: string, status: string, videoFile: { status: string; id: string } | null) {
  await db.prisma.renderArchive.create({
    data: {
      renderId,
      provider: "google-drive",
      destinationKey: "account-1",
      status,
      remoteFolderId: `folder-${renderId}`,
      files: videoFile
        ? { create: [{ kind: "VIDEO", remoteName: "video.mp4", remoteFileId: videoFile.id, status: videoFile.status }] }
        : undefined,
    },
  });
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  service = await import("@/features/archive/services/book-drive-links.service");
  route = await import("@/app/api/books/[bookId]/drive-links/route");
}, 60_000);

beforeEach(async () => {
  first = await seedArchiveVideo(db);
  bookId = (await db.prisma.video.findUniqueOrThrow({ where: { id: first } })).bookId;
  // The seeded video is the oldest of the book.
  await db.prisma.video.update({ where: { id: first }, data: { title: "Video đầu", createdAt: at() } });
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("getBookDriveLinks", () => {
  it("lists every video of the book oldest first, each with where it stands on Drive", async () => {
    await archive(await finalRender(first), "COMPLETED", { status: "VERIFIED", id: "file-1" });
    const second = await video("Video hai");
    await archive(await finalRender(second), "RUNNING", { status: "UPLOADING", id: "file-2" });
    const third = await video("Video ba");

    const links = await service.getBookDriveLinks(bookId);

    expect(links.bookId).toBe(bookId);
    expect(links.videos.map((entry) => entry.title)).toEqual(["Video đầu", "Video hai", "Video ba"]);
    expect(links.videos[0]?.drive?.archive).toMatchObject({
      status: "COMPLETED",
      videoUrl: "https://drive.google.com/file/d/file-1/view",
      folderUrl: expect.stringContaining("/drive/folders/folder-"),
    });
    expect(links.videos[1]?.drive?.archive).toMatchObject({ status: "RUNNING", videoUrl: null, folderUrl: null });
    expect(links.videos[2]).toEqual({ id: third, title: "Video ba" });
  });

  it("shows a finished final render that was never put on Drive, and leaves out a video that has none", async () => {
    const renderId = await finalRender(first);
    const unrendered = await video("Chưa render");

    const links = await service.getBookDriveLinks(bookId);

    expect(links.videos[0]?.drive).toEqual({ renderId, archive: null, outdated: false });
    expect(links.videos.find((entry) => entry.id === unrendered)?.drive).toBeUndefined();
  });

  it("holds only the videos of this book", async () => {
    const other = await db.prisma.book.create({
      data: {
        title: "Sách khác",
        sourceFilePath: "books/y/original.md",
        sourceFileName: "y.md",
        sourceHash: `hash-${Math.random()}`,
        sourceFormat: "md",
        sourceSizeBytes: 1,
        status: "ACTIVE",
      },
    });
    await video("Của sách khác", other.id);

    expect((await service.getBookDriveLinks(bookId)).videos.map((entry) => entry.title)).toEqual(["Video đầu"]);
    expect((await service.getBookDriveLinks(other.id)).videos.map((entry) => entry.title)).toEqual(["Của sách khác"]);
  });

  it("is empty for a book without videos and an error for one that does not exist", async () => {
    await db.prisma.video.deleteMany({ where: { bookId } });

    expect((await service.getBookDriveLinks(bookId)).videos).toEqual([]);
    await expect(service.getBookDriveLinks("missing")).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("GET /api/books/:id/drive-links", () => {
  const get = (id: string) => route.GET(new Request("http://127.0.0.1/x"), { params: Promise.resolve({ bookId: id }) });

  it("answers with the list", async () => {
    await archive(await finalRender(first), "COMPLETED", { status: "VERIFIED", id: "file-1" });

    const response = await get(bookId);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { videos: { title: string; drive?: { archive: { videoUrl: string } } }[] };
    expect(body.videos).toHaveLength(1);
    expect(body.videos[0]?.drive?.archive.videoUrl).toBe("https://drive.google.com/file/d/file-1/view");
  });

  it("answers 404 for an unknown book", async () => {
    const response = await get("missing");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { message: expect.any(String) } });
  });
});
