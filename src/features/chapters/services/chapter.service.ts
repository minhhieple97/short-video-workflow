import { readDataFile } from "@/features/books/services/book-files";
import { AppError, NotFoundError } from "@/shared/errors";

import { toChapterAnalysisStatus, type ChapterAnalysisStatus } from "../domain/analysis-status";
import {
  findChapterWithBook,
  listChaptersByBook,
  updateChapterTitle,
  type ChapterWithLessonCount,
} from "../repositories/chapter.repository";
import type { RenameChapterInput } from "../schemas/chapter.schema";

export interface ChapterSummary {
  id: string;
  bookId: string;
  order: number;
  title: string;
  sourceLength: number;
  analysisStatus: ChapterAnalysisStatus;
  analyzedAt: string | null;
  lessonCount: number;
}

export interface ChapterDetail extends ChapterSummary {
  book: { id: string; title: string };
  contentHash: string;
  sourceStartOffset: number | null;
  sourceEndOffset: number | null;
  content: string;
}

function toChapterSummary(chapter: ChapterWithLessonCount): ChapterSummary {
  return {
    id: chapter.id,
    bookId: chapter.bookId,
    order: chapter.order,
    title: chapter.title,
    sourceLength: (chapter.sourceEndOffset ?? 0) - (chapter.sourceStartOffset ?? 0),
    analysisStatus: toChapterAnalysisStatus(chapter.analysisStatus),
    analyzedAt: chapter.analyzedAt?.toISOString() ?? null,
    lessonCount: chapter._count.lessonSources,
  };
}

export async function listChapters(bookId: string): Promise<ChapterSummary[]> {
  return (await listChaptersByBook(bookId)).map(toChapterSummary);
}

export async function getChapter(id: string): Promise<ChapterDetail> {
  const chapter = await findChapterWithBook(id);
  if (!chapter) throw new NotFoundError("CHAPTER_NOT_FOUND", "Không tìm thấy chương.");

  let content = chapter.content ?? "";
  if (chapter.contentPath) {
    try {
      content = await readDataFile(chapter.contentPath);
    } catch (error) {
      throw new AppError("CHAPTER_CONTENT_MISSING", "Không đọc được tệp nội dung của chương.", 500, { cause: error });
    }
  }

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
