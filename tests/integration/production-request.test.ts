import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as ProductionsRoute from "@/app/api/productions/route";
import type * as ProductionRoute from "@/app/api/productions/[productionId]/route";
import type * as Request_ from "@/features/productions/services/production-request.service";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let productions: typeof Request_;
let collection: typeof ProductionsRoute;
let single: typeof ProductionRoute;

let bookId: string;
let lessonIds: string[];

async function newLesson(
  forBook: string,
  title: string,
  options: { status?: "DRAFT" | "APPROVED" | "ARCHIVED"; excerpt?: string | null } = {},
) {
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
      status: options.status ?? "DRAFT",
      sources: {
        create: {
          chapterId: chapter.id,
          sourceExcerpt: options.excerpt === undefined ? "Trích đoạn trong sách." : options.excerpt,
        },
      },
    },
  });
}

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

type ProductionRequest = Parameters<typeof productions.requestProduction>[0];

const request = (overrides: Partial<ProductionRequest> = {}): ProductionRequest => ({
  bookId,
  lessonIds,
  idempotencyKey: `key-${Math.random()}`,
  minDurationSec: 30,
  maxDurationSec: 60,
  ...overrides,
});

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  productions = await import("@/features/productions/services/production-request.service");
  collection = await import("@/app/api/productions/route");
  single = await import("@/app/api/productions/[productionId]/route");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  bookId = (await newBook("Sách")).id;
  lessonIds = [];
  for (const title of ["Một", "Hai", "Ba"]) lessonIds.push((await newLesson(bookId, title)).id);
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("requestProduction", () => {
  it("makes one item and one video per selected lesson, in the order selected", async () => {
    const { production, reused } = await productions.requestProduction(
      request({ lessonIds: [lessonIds[2] ?? "", lessonIds[0] ?? ""] }),
    );

    expect(reused).toBe(false);
    expect(production).toMatchObject({ status: "QUEUED", minDurationSec: 30, maxDurationSec: 60, bookId });
    expect(production.items.map((item) => [item.position, item.lessonTitle, item.status, item.checkpoint])).toEqual([
      [1, "Ba", "PENDING", "NONE"],
      [2, "Một", "PENDING", "NONE"],
    ]);
    expect(await db.prisma.video.count()).toBe(2);
    for (const item of production.items) {
      const video = await db.prisma.video.findUniqueOrThrow({ where: { id: item.videoId ?? "" } });
      expect(video).toMatchObject({
        title: item.lessonTitle,
        status: "DRAFT",
        minDurationSec: 30,
        maxDurationSec: 60,
        targetDurationSec: 60,
        bookId,
      });
    }
  });

  it("gives the batch and each of its videos the pace asked for, the default pace when none is", async () => {
    const fast = await productions.requestProduction(request({ pace: "FAST" }));
    const plain = await productions.requestProduction(request());

    for (const [production, pace] of [
      [fast.production, "FAST"],
      [plain.production, "STANDARD"],
    ] as const) {
      expect((await db.prisma.productionBatch.findUniqueOrThrow({ where: { id: production.id } })).pace).toBe(pace);
      for (const item of production.items) {
        expect((await db.prisma.video.findUniqueOrThrow({ where: { id: item.videoId ?? "" } })).pace).toBe(pace);
      }
    }
  });

  it("turns three selected lessons into three items and three videos", async () => {
    const { production } = await productions.requestProduction(request());

    expect(production.items).toHaveLength(3);
    expect(new Set(production.items.map((item) => item.videoId)).size).toBe(3);
    expect(await db.prisma.video.count()).toBe(3);
  });

  it("snapshots each lesson with its sources into its own video", async () => {
    const { production } = await productions.requestProduction(request({ lessonIds: [lessonIds[0] ?? ""] }));

    const link = await db.prisma.videoLesson.findFirstOrThrow({
      where: { videoId: production.items[0]?.videoId ?? "" },
    });
    expect(link.lessonId).toBe(lessonIds[0]);
    expect(link.lessonSnapshotJson).toMatchObject({
      lessonId: lessonIds[0],
      title: "Một",
      principle: "Nguyên tắc",
      sources: [{ excerpt: "Trích đoạn trong sách." }],
    });
  });

  it("keeps the snapshot as it was when the lesson is edited afterwards", async () => {
    const { production } = await productions.requestProduction(request({ lessonIds: [lessonIds[0] ?? ""] }));

    await db.prisma.lesson.update({
      where: { id: lessonIds[0] ?? "" },
      data: { title: "Đã đổi tên", principle: "Đã đổi" },
    });

    const link = await db.prisma.videoLesson.findFirstOrThrow({
      where: { videoId: production.items[0]?.videoId ?? "" },
    });
    expect(link.lessonSnapshotJson).toMatchObject({ title: "Một", principle: "Nguyên tắc" });
  });

  const statusOf = async (id: string) => (await db.prisma.lesson.findUniqueOrThrow({ where: { id } })).status;

  it("needs no approval first: choosing a draft lesson approves it, and an approved one stays approved", async () => {
    const approved = await newLesson(bookId, "Đã duyệt", { status: "APPROVED" });

    await productions.requestProduction(request({ lessonIds: [lessonIds[0] ?? "", approved.id] }));

    expect(await statusOf(lessonIds[0] ?? "")).toBe("APPROVED");
    expect(await statusOf(approved.id)).toBe("APPROVED");
  });

  it("approves only the lessons that were chosen", async () => {
    await productions.requestProduction(request({ lessonIds: [lessonIds[1] ?? ""] }));

    expect(await statusOf(lessonIds[0] ?? "")).toBe("DRAFT");
    expect(await statusOf(lessonIds[1] ?? "")).toBe("APPROVED");
    expect(await statusOf(lessonIds[2] ?? "")).toBe("DRAFT");
  });

  it("approves nothing when the request is refused", async () => {
    const unsourced = await newLesson(bookId, "Thiếu nguồn", { excerpt: null });

    await expect(
      productions.requestProduction(request({ lessonIds: [lessonIds[0] ?? "", unsourced.id] })),
    ).rejects.toMatchObject({ code: "LESSON_SOURCE_MISSING" });

    expect(await statusOf(lessonIds[0] ?? "")).toBe("DRAFT");
    expect(await statusOf(unsourced.id)).toBe("DRAFT");
  });

  it("does not approve again on a replay, so a lesson sent back to draft since stays there", async () => {
    const input = request({ lessonIds: [lessonIds[0] ?? ""] });
    await productions.requestProduction(input);
    await db.prisma.lesson.update({ where: { id: lessonIds[0] ?? "" }, data: { status: "DRAFT" } });

    const replay = await productions.requestProduction(input);

    expect(replay.reused).toBe(true);
    expect(await statusOf(lessonIds[0] ?? "")).toBe("DRAFT");
  });

  it("never brings an archived lesson back, even if it was archived after the request was checked", async () => {
    const { createProduction } = await import("@/features/productions/repositories/production.repository");
    const archived = await newLesson(bookId, "Vừa bị lưu trữ", { status: "ARCHIVED" });

    await createProduction({
      bookId,
      idempotencyKey: `key-${Math.random()}`,
      fingerprint: "f",
      range: { minDurationSec: 30, maxDurationSec: 60 },
      pace: "STANDARD",
      items: [{ lessonId: archived.id, position: 1, videoTitle: "V", snapshot: {} }],
    });

    expect(await statusOf(archived.id)).toBe("ARCHIVED");
  });

  it("returns the same production for a replayed key and creates nothing more", async () => {
    const input = request();
    const first = await productions.requestProduction(input);

    const replay = await productions.requestProduction(input);

    expect(replay.reused).toBe(true);
    expect(replay.production.id).toBe(first.production.id);
    expect(replay.production.items.map((item) => item.videoId)).toEqual(
      first.production.items.map((item) => item.videoId),
    );
    expect(await db.prisma.productionBatch.count()).toBe(1);
    expect(await db.prisma.video.count()).toBe(3);
  });

  it("returns the original production on a replay even if a lesson was archived in the meantime", async () => {
    const input = request();
    const first = await productions.requestProduction(input);
    await db.prisma.lesson.update({ where: { id: lessonIds[0] ?? "" }, data: { status: "ARCHIVED" } });

    const replay = await productions.requestProduction(input);

    expect(replay).toMatchObject({ reused: true, production: { id: first.production.id } });
  });

  it("creates one production and one set of videos when the same submit races itself", async () => {
    const input = request();

    const results = await Promise.allSettled(Array.from({ length: 4 }, () => productions.requestProduction(input)));

    const fulfilled = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    expect(fulfilled).toHaveLength(4);
    expect(new Set(fulfilled.map((result) => result.production.id)).size).toBe(1);
    expect(fulfilled.filter((result) => !result.reused)).toHaveLength(1);
    expect(await db.prisma.productionBatch.count()).toBe(1);
    expect(await db.prisma.video.count()).toBe(3);
  });

  it("rejects a key reused for a different selection and creates nothing", async () => {
    const input = request();
    await productions.requestProduction(input);

    await expect(productions.requestProduction({ ...input, lessonIds: [lessonIds[0] ?? ""] })).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      httpStatus: 409,
    });
    await expect(productions.requestProduction({ ...input, maxDurationSec: 45 })).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    await expect(productions.requestProduction({ ...input, pace: "FASTER" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(await db.prisma.productionBatch.count()).toBe(1);
  });

  it("allows the same lessons to be produced again under a new key", async () => {
    await productions.requestProduction(request());
    await productions.requestProduction(request());

    expect(await db.prisma.productionBatch.count()).toBe(2);
    expect(await db.prisma.video.count()).toBe(6);
  });

  it("refuses a lesson from another book and creates nothing", async () => {
    const otherBook = await newBook("Sách khác");
    const foreign = await newLesson(otherBook.id, "Của sách khác");

    await expect(
      productions.requestProduction(request({ lessonIds: [lessonIds[0] ?? "", foreign.id] })),
    ).rejects.toMatchObject({ code: "LESSON_NOT_IN_BOOK", httpStatus: 400, details: { lessonIds: [foreign.id] } });

    expect(await db.prisma.productionBatch.count()).toBe(0);
    expect(await db.prisma.video.count()).toBe(0);
  });

  it("refuses an archived lesson", async () => {
    const archived = await newLesson(bookId, "Lưu trữ", { status: "ARCHIVED" });

    await expect(productions.requestProduction(request({ lessonIds: [archived.id] }))).rejects.toMatchObject({
      code: "LESSON_ARCHIVED",
    });
  });

  it.each([
    ["has no source excerpt", null],
    ["has a blank source excerpt", "   "],
  ])("refuses a lesson that %s, naming it", async (_label, excerpt) => {
    const unsourced = await newLesson(bookId, "Thiếu nguồn", { excerpt });

    await expect(
      productions.requestProduction(request({ lessonIds: [lessonIds[0] ?? "", unsourced.id] })),
    ).rejects.toMatchObject({ code: "LESSON_SOURCE_MISSING", details: { lessonIds: [unsourced.id] } });
    expect(await db.prisma.video.count()).toBe(0);
  });

  it("reports an unknown book as not found", async () => {
    await expect(productions.requestProduction(request({ bookId: "missing" }))).rejects.toMatchObject({
      httpStatus: 404,
    });
  });
});

describe("production API", () => {
  const post = (body: unknown) =>
    collection.POST(
      new Request("http://127.0.0.1/api/productions", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );

  it("answers 202 with the production, then lets it be read back", async () => {
    const response = await post({
      bookId,
      lessonIds,
      idempotencyKey: "key-abcdefgh",
      minDurationSec: 30,
      maxDurationSec: 60,
    });

    expect(response.status).toBe(202);
    const created = (await response.json()) as { id: string; reused: boolean; items: unknown[] };
    expect(created).toMatchObject({ reused: false });
    expect(created.items).toHaveLength(3);

    const read = await single.GET(new Request("http://127.0.0.1/x"), {
      params: Promise.resolve({ productionId: created.id }),
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ id: created.id, status: "QUEUED" });
  });

  it("answers 202 for a replay and marks it reused", async () => {
    const body = { bookId, lessonIds, idempotencyKey: "key-abcdefgh", minDurationSec: 30, maxDurationSec: 60 };
    await post(body);

    const replay = await post(body);

    expect(replay.status).toBe(202);
    expect(await replay.json()).toMatchObject({ reused: true });
  });

  it.each([
    ["no lessons", { lessonIds: [] }],
    ["a lesson selected twice", { lessonIds: ["a", "a"] }],
    ["a short key", { idempotencyKey: "short" }],
    ["no length range", {}],
    ["a length that is no preset", { minDurationSec: 30, maxDurationSec: 150 }],
    ["more than five minutes", { minDurationSec: 30, maxDurationSec: 360 }],
    ["a minimum above the maximum", { minDurationSec: 90, maxDurationSec: 60 }],
  ])("answers 400 for %s", async (_label, override) => {
    const response = await post({ bookId, lessonIds, idempotencyKey: "key-abcdefgh", ...override });

    expect(response.status).toBe(400);
    expect(await db.prisma.productionBatch.count()).toBe(0);
  });

  it("accepts a range up to five minutes, and plans each video at the maximum until its draft proposes a length", async () => {
    const response = await post({
      bookId,
      lessonIds,
      idempotencyKey: "key-abcdefgh",
      minDurationSec: 30,
      maxDurationSec: 300,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ minDurationSec: 30, maxDurationSec: 300 });
    const videos = await db.prisma.video.findMany({ where: { bookId } });
    expect(videos.map((video) => [video.minDurationSec, video.maxDurationSec, video.targetDurationSec])).toEqual([
      [30, 300, 300],
      [30, 300, 300],
      [30, 300, 300],
    ]);
    expect(videos.every((video) => video.durationReason === null)).toBe(true);
  });

  it("answers 404 for an unknown production", async () => {
    const read = await single.GET(new Request("http://127.0.0.1/x"), {
      params: Promise.resolve({ productionId: "missing" }),
    });

    expect(read.status).toBe(404);
    expect(await read.json()).toMatchObject({ error: { code: "PRODUCTION_NOT_FOUND" } });
  });
});
