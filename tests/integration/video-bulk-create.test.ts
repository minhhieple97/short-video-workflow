import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as BulkRoute from "@/app/api/videos/bulk/route";
import type * as VideoService from "@/features/videos/services/video.service";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let videos: typeof VideoService;
let route: typeof BulkRoute;

let bookId: string;
let approved: string[];

async function newBook(title: string) {
  return db.prisma.book.create({
    data: {
      title,
      sourceFilePath: "books/x/original.md",
      sourceFileName: "x.md",
      sourceHash: `hash-${Math.random()}`,
      sourceFormat: "md",
      sourceSizeBytes: 1,
      status: "ACTIVE",
    },
  });
}

async function newLesson(forBook: string, title: string, status: "DRAFT" | "APPROVED" = "APPROVED") {
  const chapter = await db.prisma.chapter.create({
    data: {
      bookId: forBook,
      order: Math.floor(Math.random() * 1e9),
      title: `Chương của ${title}`,
      contentHash: "c",
      analysisStatus: "ANALYZED",
      content: "x",
    },
  });
  return db.prisma.lesson.create({
    data: {
      bookId: forBook,
      title,
      summary: "Tóm tắt",
      principle: "Nguyên tắc",
      realLifeScenario: "Tình huống",
      commonMistake: "Sai lầm",
      betterApproach: "Cách tốt hơn",
      actionableStep: "Hành động",
      origin: "AI",
      status,
      sources: { create: { chapterId: chapter.id, sourceExcerpt: "Trích đoạn trong sách." } },
    },
  });
}

type BulkRequest = Parameters<typeof videos.createVideosFromLessons>[0];

const request = (overrides: Partial<BulkRequest> = {}): BulkRequest => ({
  bookId,
  lessonIds: approved,
  minDurationSec: 30,
  maxDurationSec: 60,
  ...overrides,
});

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  videos = await import("@/features/videos/services/video.service");
  route = await import("@/app/api/videos/bulk/route");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  bookId = (await newBook("Sách")).id;
  approved = [];
  for (const title of ["Một", "Hai", "Ba"]) approved.push((await newLesson(bookId, title)).id);
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("createVideosFromLessons", () => {
  it("makes one video for each lesson, titled like it, in the order asked for", async () => {
    const { videos: created } = await videos.createVideosFromLessons(
      request({ lessonIds: [approved[2] ?? "", approved[0] ?? "", approved[1] ?? ""] }),
    );

    expect(created.map((video) => video.title)).toEqual(["Ba", "Một", "Hai"]);
    expect(await db.prisma.video.count()).toBe(3);
    for (const [index, video] of created.entries()) {
      const record = await db.prisma.video.findUniqueOrThrow({
        where: { id: video.id },
        include: { videoLessons: true },
      });
      expect(record).toMatchObject({
        bookId,
        status: "DRAFT",
        minDurationSec: 30,
        maxDurationSec: 60,
        targetDurationSec: 60,
        pace: "STANDARD",
      });
      expect(record.videoLessons).toHaveLength(1);
      expect(record.videoLessons[0]).toMatchObject({
        lessonId: [approved[2], approved[0], approved[1]][index],
        position: 1,
        lessonSnapshotJson: { title: video.title, principle: "Nguyên tắc" },
      });
    }
  });

  it("gives every video the pace asked for", async () => {
    const { videos: created } = await videos.createVideosFromLessons(request({ pace: "FAST" }));

    const paces = await db.prisma.video.findMany({ where: { id: { in: created.map((video) => video.id) } } });
    expect(paces.map((video) => video.pace)).toEqual(Array(3).fill("FAST"));
  });

  it("refuses a lesson that is not approved and creates nothing", async () => {
    const draft = await newLesson(bookId, "Nháp", "DRAFT");

    await expect(videos.createVideosFromLessons(request({ lessonIds: [...approved, draft.id] }))).rejects.toMatchObject(
      {
        code: "LESSON_NOT_APPROVED",
        httpStatus: 409,
      },
    );
    expect(await db.prisma.video.count()).toBe(0);
  });

  it("refuses a lesson of another book and creates nothing", async () => {
    const foreign = await newLesson((await newBook("Sách khác")).id, "Của sách khác");

    await expect(
      videos.createVideosFromLessons(request({ lessonIds: [...approved, foreign.id] })),
    ).rejects.toMatchObject({ code: "LESSON_NOT_IN_BOOK", httpStatus: 400 });
    expect(await db.prisma.video.count()).toBe(0);
  });

  it("keeps the video that joins several lessons working as before", async () => {
    const { video } = await videos.createVideo({
      bookId,
      title: "Ghép",
      description: null,
      lessonIds: approved,
      minDurationSec: 30,
      maxDurationSec: 90,
    });

    expect(video.lessons.map((lesson) => lesson.title)).toEqual(["Một", "Hai", "Ba"]);
    expect(await db.prisma.video.count()).toBe(1);
  });
});

describe("POST /api/videos/bulk", () => {
  const post = (body: unknown) =>
    route.POST(
      new Request("http://127.0.0.1/api/videos/bulk", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );

  it("answers 201 with the videos made", async () => {
    const response = await post(request());

    expect(response.status).toBe(201);
    const body = (await response.json()) as { videos: { id: string; title: string }[] };
    expect(body.videos.map((video) => video.title)).toEqual(["Một", "Hai", "Ba"]);
  });

  it("answers 400 with the first problem in the user's words", async () => {
    const response = await post(request({ lessonIds: [approved[0] ?? "", approved[0] ?? ""] }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", message: "Mỗi bài học chỉ được chọn một lần." },
    });
    expect(await db.prisma.video.count()).toBe(0);
  });
});
