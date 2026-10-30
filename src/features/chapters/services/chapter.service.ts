import { readDataFile } from "@/features/books/services/book-files";
import { AppError, NotFoundError } from "@/shared/errors";
import { loadPage, mapPage, type Page, type PageRequest } from "@/shared/pagination";

import { toChapterAnalysisStatus } from "../domain/analysis-status";
import {
  countChaptersByBook,
  findChapterWithBook,
  listChapterRefs,
  listChaptersByBook,
  updateChapterTitle,
  type ChapterWithLessonSources,
} from "../repositories/chapter.repository";
import type { ChapterDetail, ChapterSummary } from "../schemas/chapter.dto";
import type { RenameChapterInput } from "../schemas/chapter.schema";

function toChapterSummary(chapter: ChapterWithLessonSources): ChapterSummary {
  return {
    id: chapter.id,
    bookId: chapter.bookId,
    order: chapter.order,
    title: chapter.title,
    sourceLength: (chapter.sourceEndOffset ?? 0) - (chapter.sourceStartOffset ?? 0),
    analysisStatus: toChapterAnalysisStatus(chapter.analysisStatus),
    analyzedAt: chapter.analyzedAt?.toISOString() ?? null,
    lessonCount: new Set(chapter.lessonSources.map((source) => source.lessonId)).size,
  };
}

export async function listChapters(bookId: string): Promise<ChapterSummary[]> {
  return (await listChaptersByBook(bookId)).map(toChapterSummary);
}

// Every chapter's id, number and title, for the pickers that offer all of them (filter, create-lesson dialog).
export function listChapterRefsOfBook(bookId: string): Promise<{ id: string; order: number; title: string }[]> {
  return listChapterRefs(bookId);
}

export async function listChaptersPage(bookId: string, request: PageRequest): Promise<Page<ChapterSummary>> {
  const records = await loadPage(request, {
    count: () => countChaptersByBook(bookId),
    fetch: (range) => listChaptersByBook(bookId, range),
  });
  return mapPage(records, toChapterSummary);
}

export async function readChapterContent(chapter: {
  contentPath: string | null;
  content: string | null;
}): Promise<string> {
  if (!chapter.contentPath) return chapter.content ?? "";
  try {
    return await readDataFile(chapter.contentPath);
  } catch (error) {
    throw new AppError("CHAPTER_CONTENT_MISSING", "Không đọc được tệp nội dung của chương.", 500, { cause: error });
  }
}

export async function getChapter(id: string): Promise<ChapterDetail> {
  const chapter = await findChapterWithBook(id);
  if (!chapter) throw new NotFoundError("CHAPTER_NOT_FOUND", "Không tìm thấy chương.");

  const content = await readChapterContent(chapter);
  return {
    ...toChapterSummary(chapter),
    book: { id: chapter.book.id, title: chapter.book.title },
    contentHash: chapter.contentHash,
    sourceStartOffset: chapter.sourceStartOffset,
    sourceEndOffset: chapter.sourceEndOffset,
    content,
  };
}

export async function renameChapter(id: string, input: RenameChapterInput): Promise<ChapterSummary> {
  const chapter = await findChapterWithBook(id);
  if (!chapter) throw new NotFoundError("CHAPTER_NOT_FOUND", "Không tìm thấy chương.");
  await updateChapterTitle(id, input.title);
  return toChapterSummary({ ...chapter, title: input.title });
}
