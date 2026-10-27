import type { Book, Chapter } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

const ACTIVE_LESSON_COUNT = {
  _count: { select: { lessonSources: { where: { lesson: { status: { not: "ARCHIVED" as const } } } } } },
};

export type ChapterWithLessonCount = Chapter & { _count: { lessonSources: number } };

export function listChaptersByBook(bookId: string): Promise<ChapterWithLessonCount[]> {
  return prisma.chapter.findMany({ where: { bookId }, orderBy: { order: "asc" }, include: ACTIVE_LESSON_COUNT });
}

export function findChapterWithBook(id: string): Promise<(ChapterWithLessonCount & { book: Book }) | null> {
  return prisma.chapter.findFirst({
    where: { id, book: { deletedAt: null } },
    include: { book: true, ...ACTIVE_LESSON_COUNT },
  });
}

export function updateChapterTitle(id: string, title: string): Promise<Chapter> {
  return prisma.chapter.update({ where: { id }, data: { title } });
}
