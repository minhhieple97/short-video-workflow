import { countChaptersInBook } from "@/features/chapters/repositories/chapter.repository";
import { AppError, NotFoundError } from "@/shared/errors";

import { pickLessonText, type LessonStatus } from "../domain/lesson-fields";
import {
  createLessonRecord,
  findLessonDetail,
  listLessonRecords,
  mergeLessonInto,
  setLessonStatus,
  updateLessonText,
  type LessonDetailRecord,
  type LessonListRecord,
} from "../repositories/lesson.repository";
import type { LessonDetail, LessonSummary } from "../schemas/lesson.dto";
import type { CreateManualLessonInput, LessonFilterInput, LessonTextInput } from "../schemas/lesson.schema";
import { lessonContentHash } from "./lesson-hash";

function uniqueChapters(sources: readonly { chapter: { id: string; order: number; title: string } }[]) {
  const byId = new Map(sources.map((source) => [source.chapter.id, source.chapter]));
  return [...byId.values()].sort((a, b) => a.order - b.order);
}

function toLessonSummary(lesson: LessonListRecord): LessonSummary {
  return {
    id: lesson.id,
    bookId: lesson.bookId,
    title: lesson.title,
    summary: lesson.summary,
    status: lesson.status,
    origin: lesson.origin,
    chapters: uniqueChapters(lesson.sources),
    usedInVideoCount: lesson._count.videoLessons,
    createdAt: lesson.createdAt.toISOString(),
  };
}

function toLessonDetail(lesson: LessonDetailRecord): LessonDetail {
  return {
    id: lesson.id,
    book: { id: lesson.book.id, title: lesson.book.title },
    status: lesson.status,
    origin: lesson.origin,
    analysisPromptVersion: lesson.analysisPromptVersion,
    ...pickLessonText(lesson),
    sources: lesson.sources.map((source) => ({
      id: source.id,
      chapter: source.chapter,
      excerpt: source.sourceExcerpt,
      locator: source.sourceLocator,
    })),
    videos: lesson.videoLessons.map((videoLesson) => videoLesson.video),
    createdAt: lesson.createdAt.toISOString(),
    updatedAt: lesson.updatedAt.toISOString(),
  };
}

async function requireLesson(id: string): Promise<LessonDetailRecord> {
  const lesson = await findLessonDetail(id);
  if (!lesson || lesson.book.deletedAt) throw new NotFoundError("LESSON_NOT_FOUND", "Không tìm thấy bài học.");
  return lesson;
}

export async function listLessons(bookId: string, filter: LessonFilterInput = {}): Promise<LessonSummary[]> {
  return (await listLessonRecords({ bookId, ...filter })).map(toLessonSummary);
}

export async function getLesson(id: string): Promise<LessonDetail> {
  return toLessonDetail(await requireLesson(id));
}

export async function updateLesson(id: string, input: LessonTextInput): Promise<LessonDetail> {
  await requireLesson(id);
  const text = pickLessonText(input);
  await updateLessonText(id, text, lessonContentHash(text));
  return getLesson(id);
}

const ALLOWED_TRANSITIONS: Record<LessonStatus, readonly LessonStatus[]> = {
  DRAFT: ["APPROVED", "ARCHIVED"],
  APPROVED: ["ARCHIVED", "DRAFT"],
  ARCHIVED: ["DRAFT"],
};

export async function changeLessonStatus(id: string, status: LessonStatus): Promise<LessonDetail> {
  const lesson = await requireLesson(id);
  if (lesson.status === status) return toLessonDetail(lesson);
  if (!ALLOWED_TRANSITIONS[lesson.status].includes(status)) {
    throw new AppError("INVALID_LESSON_TRANSITION", "Không thể chuyển trạng thái bài học theo cách này.", 409);
  }
  await setLessonStatus(id, status);
  return getLesson(id);
}

export async function createManualLesson(bookId: string, input: CreateManualLessonInput): Promise<LessonDetail> {
  const chapterIds = [...new Set(input.chapterIds)];
  if ((await countChaptersInBook(bookId, chapterIds)) !== chapterIds.length) {
    throw new AppError("INVALID_SOURCE_CHAPTER", "Chương nguồn phải thuộc cùng cuốn sách.", 400);
  }
  const text = pickLessonText(input);
  const lesson = await createLessonRecord({
    bookId,
    origin: "MANUAL",
    text,
    contentHash: lessonContentHash(text),
    sources: chapterIds.map((chapterId, index) => ({
      chapterId,
      sourceExcerpt: index === 0 ? input.sourceExcerpt : null,
      sourceLocator: null,
      confidence: null,
    })),
  });
  return getLesson(lesson.id);
}

export async function mergeLesson(sourceId: string, targetId: string): Promise<LessonDetail> {
  if (sourceId === targetId) throw new AppError("INVALID_MERGE", "Không thể gộp bài học với chính nó.", 400);
  const [source, target] = await Promise.all([requireLesson(sourceId), requireLesson(targetId)]);
  if (source.book.id !== target.book.id) {
    throw new AppError("INVALID_MERGE", "Chỉ gộp được bài học trong cùng một cuốn sách.", 400);
  }
  if (target.status === "ARCHIVED") throw new AppError("INVALID_MERGE", "Bài học đích đã bị lưu trữ.", 409);
  if (source.videoLessons.length > 0) {
    throw new AppError("LESSON_IN_USE", "Bài học đang được dùng trong video nên không thể gộp.", 409);
  }
  await mergeLessonInto(sourceId, targetId);
  return getLesson(targetId);
}
