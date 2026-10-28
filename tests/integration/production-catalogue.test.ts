import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Catalogue from "@/features/productions/services/catalogue.service";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let catalogue: typeof Catalogue;
let bookId: string;
let chapterOne: string;
let chapterTwo: string;

async function lesson(
  title: string,
  status: "DRAFT" | "APPROVED" | "ARCHIVED",
  sources: { chapterId: string; excerpt: string | null }[],
) {
  return db.prisma.lesson.create({
    data: {
      bookId,
      title,
      summary: `Tóm tắt ${title}`,
      principle: "p",
      realLifeScenario: "r",
      commonMistake: "m",
      betterApproach: "b",
      actionableStep: "a",
      origin: "AI",
      status,
      sources: { create: sources.map((source) => ({ chapterId: source.chapterId, sourceExcerpt: source.excerpt })) },
    },
  });
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  catalogue = await import("@/features/productions/services/catalogue.service");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  bookId = (
    await db.prisma.book.create({
      data: {
        title: "Thói quen nhỏ",
        sourceFilePath: "books/x/original.md",
        sourceFileName: "x.md",
        sourceHash: `hash-${Math.random()}`,
        sourceFormat: "md",
        sourceSizeBytes: 1,
        status: "ACTIVE",
      },
    })
  ).id;
  chapterTwo = (
    await db.prisma.chapter.create({
      data: { bookId, order: 2, title: "Chương 2", contentHash: "c2", analysisStatus: "ANALYZED" },
    })
  ).id;
  chapterOne = (
    await db.prisma.chapter.create({
      data: { bookId, order: 1, title: "Chương 1", contentHash: "c1", analysisStatus: "ANALYZED" },
    })
  ).id;
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("getCatalogue", () => {
  it("offers every lesson that is not archived, approved or not, with its sources in chapter order", async () => {
    await lesson("Bắt đầu nhỏ", "DRAFT", [
      { chapterId: chapterTwo, excerpt: "  Trích đoạn chương hai.  " },
      { chapterId: chapterOne, excerpt: "Trích đoạn chương một." },
    ]);
    await lesson("Đã duyệt", "APPROVED", [{ chapterId: chapterOne, excerpt: "x" }]);
    await lesson("Đã lưu trữ", "ARCHIVED", [{ chapterId: chapterOne, excerpt: "x" }]);

    const result = await catalogue.getCatalogue(bookId);

    expect(result.book).toEqual({ id: bookId, title: "Thói quen nhỏ" });
    expect(result.lessons.map((entry) => [entry.title, entry.status])).toEqual([
      ["Bắt đầu nhỏ", "DRAFT"],
      ["Đã duyệt", "APPROVED"],
    ]);
    expect(result.lessons[0]).toMatchObject({
      summary: "Tóm tắt Bắt đầu nhỏ",
      unavailableReason: null,
      sources: [
        { chapterTitle: "Chương 1", excerpt: "Trích đoạn chương một." },
        { chapterTitle: "Chương 2", excerpt: "Trích đoạn chương hai." },
      ],
    });
  });

  it("shows a lesson without any excerpt but does not let it be chosen", async () => {
    await lesson("Không nguồn", "APPROVED", [
      { chapterId: chapterOne, excerpt: null },
      { chapterId: chapterTwo, excerpt: "   " },
    ]);

    const [entry] = (await catalogue.getCatalogue(bookId)).lessons;

    expect(entry).toMatchObject({ sources: [], unavailableReason: "Chưa có trích đoạn nguồn trong sách." });
  });

  it("shortens long excerpts and counts the videos a lesson is already in", async () => {
    const created = await lesson("Dài", "APPROVED", [{ chapterId: chapterOne, excerpt: "a".repeat(1000) }]);
    const video = await db.prisma.video.create({
      data: { bookId, title: "V", targetDurationSec: 60, status: "DRAFT" },
    });
    await db.prisma.videoLesson.create({
      data: { videoId: video.id, lessonId: created.id, position: 1, lessonSnapshotJson: {} },
    });

    const [entry] = (await catalogue.getCatalogue(bookId)).lessons;

    expect(entry?.sources[0]?.excerpt).toHaveLength(280);
    expect(entry?.usedInVideoCount).toBe(1);
  });

  it("reports an unknown book as not found", async () => {
    await expect(catalogue.getCatalogue("missing")).rejects.toMatchObject({ httpStatus: 404 });
  });
});
