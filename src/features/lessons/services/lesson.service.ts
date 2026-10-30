import { countChaptersInBook } from "@/features/chapters/repositories/chapter.repository";
import { AppError, NotFoundError } from "@/shared/errors";
import { loadPage, mapPage, type Page, type PageRequest } from "@/shared/pagination";

import { canMoveLesson, pickLessonText, type LessonStatus } from "../domain/lesson-fields";
import { hasSourceExcerpt } from "../domain/source-excerpts";
import {
  countLessonRecords,
  createLessonRecord,
  findLessonDetail,
  findLessonStatuses,
  listLessonRecords,
  mergeLessonInto,
  setLessonStatus,
  setLessonStatuses,
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
    hasSourceExcerpt: hasSourceExcerpt(lesson.sources),
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

export async function listLessonsPage(
  bookId: string,
  filter: LessonFilterInput,
  request: PageRequest,
): Promise<Page<LessonSummary>> {
  const records = await loadPage(request, {
    count: () => countLessonRecords({ bookId, ...filter }),
    fetch: (range) => listLessonRecords({ bookId, ...filter }, range),
  });
  return mapPage(records, toLessonSummary);
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

export async function changeLessonStatus(id: string, status: LessonStatus): Promise<LessonDetail> {
  const lesson = await requireLesson(id);
  if (lesson.status === status) return toLessonDetail(lesson);
  if (!canMoveLesson(lesson.status, status)) {
    throw new AppError("INVALID_LESSON_TRANSITION", "Không thể chuyển trạng thái bài học theo cách này.", 409);
  }
  await setLessonStatus(id, status);
  return getLesson(id);
}

export interface BulkStatusResult {
  changed: number;
  // Already in the requested status.
  unchanged: number;
  // The status cannot be reached from where the lesson is (it changed since the page was drawn).
  blocked: number;
}

// Moves several lessons of one book to a status at once, by the same rules as one lesson; the ones that cannot move
// are counted, not failed, so a stale page still applies to everything it can.
export async function changeLessonStatuses(
  bookId: string,
  lessonIds: readonly string[],
  status: LessonStatus,
): Promise<BulkStatusResult> {
  const ids = [...new Set(lessonIds)];
  const lessons = await findLessonStatuses(bookId, ids);
  if (lessons.length !== ids.length) {
    throw new NotFoundError("LESSON_NOT_FOUND", "Có bài học được chọn không thuộc sách này.");
  }
  const unchanged = lessons.filter((lesson) => lesson.status === status).length;
  const movable = lessons.filter((lesson) => canMoveLesson(lesson.status, status));
  if (movable.length > 0) {
    await setLessonStatuses(
      movable.map((lesson) => lesson.id),
      status,
    );
  }
  return { changed: movable.length, unchanged, blocked: lessons.length - unchanged - movable.length };
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
