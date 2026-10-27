import type { Book, Chapter } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

import type { ChapterAnalysisStatus } from "../domain/analysis-status";

const ACTIVE_LESSON_SOURCES = {
  lessonSources: { where: { lesson: { status: { not: "ARCHIVED" as const } } }, select: { lessonId: true } },
};

export type ChapterWithLessonSources = Chapter & { lessonSources: { lessonId: string }[] };

export function listChaptersByBook(bookId: string): Promise<ChapterWithLessonSources[]> {
  return prisma.chapter.findMany({ where: { bookId }, orderBy: { order: "asc" }, include: ACTIVE_LESSON_SOURCES });
}

export function findChapterWithBook(id: string): Promise<(ChapterWithLessonSources & { book: Book }) | null> {
  return prisma.chapter.findFirst({
    where: { id, book: { deletedAt: null } },
    include: { book: true, ...ACTIVE_LESSON_SOURCES },
  });
}

export function updateChapterTitle(id: string, title: string): Promise<Chapter> {
  return prisma.chapter.update({ where: { id }, data: { title } });
}

export function setChapterAnalysisStatus(
  id: string,
  status: ChapterAnalysisStatus,
  completed?: { analyzedAt: Date; analysisPromptVersion: string },
): Promise<Chapter> {
  return prisma.chapter.update({ where: { id }, data: { analysisStatus: status, ...completed } });
}

export async function countChaptersInBook(bookId: string, chapterIds: readonly string[]): Promise<number> {
  return prisma.chapter.count({ where: { bookId, id: { in: [...chapterIds] } } });
}
