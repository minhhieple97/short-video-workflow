import type * as DbClient from "@/server/db/client";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";

// One book with sourced lessons (one by default) and a production of them, ready for a pipeline step to be driven in a test.
// itemId and videoId are those of the first item; itemIds lists every item in the order of its position.
export async function seedProduction(deps: {
  db: typeof DbClient;
  productions: typeof ProductionRequest;
  lessonCount?: number;
}): Promise<{ bookId: string; lessonId: string; itemId: string; videoId: string; itemIds: string[] }> {
  const { db, productions, lessonCount = 1 } = deps;
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
  const lessonIds: string[] = [];
  for (let index = 0; index < lessonCount; index += 1) {
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
    lessonIds.push(lesson.id);
  }
  const { production } = await productions.requestProduction({
    bookId: book.id,
    lessonIds,
    idempotencyKey: `key-${Math.random()}`,
    minDurationSec: 30,
    maxDurationSec: 60,
  });
  return {
    bookId: book.id,
    lessonId: lessonIds[0] ?? "",
    itemId: production.items[0]?.id ?? "",
    videoId: production.items[0]?.videoId ?? "",
    itemIds: production.items.map((item) => item.id),
  };
}
