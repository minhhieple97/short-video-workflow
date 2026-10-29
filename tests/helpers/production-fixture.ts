import type * as DbClient from "@/server/db/client";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";

// One book with one sourced lesson and a production of it, ready for a pipeline step to be driven in a test.
export async function seedProduction(deps: {
  db: typeof DbClient;
  productions: typeof ProductionRequest;
}): Promise<{ bookId: string; lessonId: string; itemId: string; videoId: string }> {
  const { db, productions } = deps;
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
  const chapter = await db.prisma.chapter.create({
    data: { bookId: book.id, order: 1, title: "Chương", contentHash: "c", analysisStatus: "ANALYZED", content: "x" },
  });
  const lesson = await db.prisma.lesson.create({
    data: {
      bookId: book.id,
      title: "Bài",
      summary: "s",
      principle: "p",
      realLifeScenario: "r",
      commonMistake: "m",
      betterApproach: "b",
      actionableStep: "a",
      origin: "AI",
      sources: { create: { chapterId: chapter.id, sourceExcerpt: "Trích đoạn." } },
    },
  });
  const { production } = await productions.requestProduction({
    bookId: book.id,
    lessonIds: [lesson.id],
    idempotencyKey: `key-${Math.random()}`,
    minDurationSec: 30,
    maxDurationSec: 60,
  });
  return {
    bookId: book.id,
    lessonId: lesson.id,
    itemId: production.items[0]?.id ?? "",
    videoId: production.items[0]?.videoId ?? "",
  };
}
