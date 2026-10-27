import type { Lesson, LessonStatus } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

import type { LessonText } from "../domain/lesson-fields";

const CHAPTER_REF = { select: { id: true, order: true, title: true } };

const LIST_INCLUDE = {
  sources: { select: { chapter: CHAPTER_REF } },
  _count: { select: { videoLessons: true } },
};

const DETAIL_INCLUDE = {
  book: { select: { id: true, title: true, deletedAt: true } },
  sources: { include: { chapter: CHAPTER_REF }, orderBy: { chapter: { order: "asc" as const } } },
  videoLessons: { include: { video: { select: { id: true, title: true } } } },
};

export type LessonListRecord = Lesson & {
  sources: { chapter: { id: string; order: number; title: string } }[];
  _count: { videoLessons: number };
};

export type LessonDetailRecord = NonNullable<Awaited<ReturnType<typeof findLessonDetail>>>;

export interface LessonFilter {
  bookId: string;
  chapterId?: string;
  status?: LessonStatus;
  usage?: "used" | "unused";
}

export interface NewLessonSource {
  chapterId: string;
  sourceExcerpt: string | null;
  sourceLocator: string | null;
  confidence: number | null;
}

export interface AnalysisDraft {
  text: LessonText;
  contentHash: string;
  sources: NewLessonSource[];
}

export function listLessonRecords(filter: LessonFilter): Promise<LessonListRecord[]> {
  return prisma.lesson.findMany({
    where: {
      bookId: filter.bookId,
      status: filter.status,
      sources: filter.chapterId ? { some: { chapterId: filter.chapterId } } : undefined,
      videoLessons: filter.usage === "used" ? { some: {} } : filter.usage === "unused" ? { none: {} } : undefined,
    },
    orderBy: { createdAt: "asc" },
    include: LIST_INCLUDE,
  });
}

export function findLessonDetail(id: string) {
  return prisma.lesson.findUnique({ where: { id }, include: DETAIL_INCLUDE });
}

export function createLessonRecord(input: {
  bookId: string;
  origin: "AI" | "MANUAL";
  text: LessonText;
  contentHash: string;
  sources: NewLessonSource[];
}): Promise<Lesson> {
  return prisma.lesson.create({
    data: {
      bookId: input.bookId,
      origin: input.origin,
      status: "DRAFT",
      contentHash: input.contentHash,
      ...input.text,
      sources: { create: input.sources },
    },
  });
}

export function updateLessonText(id: string, text: LessonText, contentHash: string): Promise<Lesson> {
  return prisma.lesson.update({ where: { id }, data: { ...text, contentHash } });
}

export function setLessonStatus(id: string, status: LessonStatus): Promise<Lesson> {
  return prisma.lesson.update({ where: { id }, data: { status } });
}

// Re-analysis archives earlier AI drafts that cite only this chapter; approved or manual lessons are never touched.
export async function replaceChapterDraftLessons(input: {
  bookId: string;
  chapterId: string;
  promptVersion: string;
  drafts: readonly AnalysisDraft[];
}): Promise<{ created: string[]; archived: number }> {
  return prisma.$transaction(async (tx) => {
    const archived = await tx.lesson.updateMany({
      where: {
        bookId: input.bookId,
        origin: "AI",
        status: "DRAFT",
        sources: { some: { chapterId: input.chapterId }, every: { chapterId: input.chapterId } },
      },
      data: { status: "ARCHIVED" },
    });

    const created: string[] = [];
    for (const draft of input.drafts) {
      const lesson = await tx.lesson.create({
        data: {
          bookId: input.bookId,
          origin: "AI",
          status: "DRAFT",
          contentHash: draft.contentHash,
          analysisPromptVersion: input.promptVersion,
          ...draft.text,
          sources: { create: draft.sources },
        },
      });
      created.push(lesson.id);
    }
    return { created, archived: archived.count };
  });
}

// Moves the source lesson's evidence onto the target (skipping duplicates) and archives the source lesson.
export async function mergeLessonInto(sourceId: string, targetId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const [sources, targetSources] = await Promise.all([
      tx.lessonSource.findMany({ where: { lessonId: sourceId } }),
      tx.lessonSource.findMany({ where: { lessonId: targetId } }),
    ]);
    const existing = new Set(targetSources.map((source) => `${source.chapterId}|${source.sourceLocator ?? ""}`));
    for (const source of sources) {
      const key = `${source.chapterId}|${source.sourceLocator ?? ""}`;
      if (existing.has(key)) continue;
      existing.add(key);
      await tx.lessonSource.create({
        data: {
          lessonId: targetId,
          chapterId: source.chapterId,
          sourceExcerpt: source.sourceExcerpt,
          sourceLocator: source.sourceLocator,
          confidence: source.confidence,
        },
      });
    }
    await tx.lesson.update({ where: { id: sourceId }, data: { status: "ARCHIVED" } });
  });
}
