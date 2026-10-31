import "server-only";

import { getBook } from "@/features/books/services/book.service";
import { hasCompletedAiRun } from "@/features/jobs/repositories/ai-run.repository";
import { enqueueTrackedJob } from "@/features/jobs/services/job-service";
import { CHAPTER_ANALYSIS_PROMPT_VERSION } from "@/server/ai/prompts/chapter-analysis-prompt";
import { LESSON_EXTRACTION_PROMPT_VERSION } from "@/server/script-studio/notebooklm/prompts/lesson-extraction-prompt";
import { getAppConfig } from "@/shared/config/env";
import { AppError, NotFoundError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";

import { findChapterWithBook, listChaptersByBook, setChapterAnalysisStatus } from "../repositories/chapter.repository";
import { analysisInputHash } from "./chapter-analysis.service";
import { chapterAnalysisLane, notebookAnalysisInputHash } from "./notebook-chapter-analysis.service";

interface AnalysisTarget {
  id: string;
  title: string;
  contentHash: string;
  analysisStatus: string;
  analysisPromptVersion: string | null;
}

export async function isUpToDate(chapter: AnalysisTarget, bookTitle: string): Promise<boolean> {
  if (chapter.analysisStatus !== "ANALYZED") return false;
  // A chapter catalogued by NotebookLM is up to date against its own prompt version and input.
  if (chapter.analysisPromptVersion === LESSON_EXTRACTION_PROMPT_VERSION) {
    return hasCompletedAiRun(
      notebookAnalysisInputHash({ contentHash: chapter.contentHash, chapterTitle: chapter.title, bookTitle }),
    );
  }
  if (chapter.analysisPromptVersion !== CHAPTER_ANALYSIS_PROMPT_VERSION) return false;
  return hasCompletedAiRun(
    analysisInputHash({
      mode: getAppConfig().ai.mode,
      contentHash: chapter.contentHash,
      chapterTitle: chapter.title,
      bookTitle,
    }),
  );
}

async function enqueueAnalysis(
  chapter: AnalysisTarget,
  sourceFormat: string,
  force: boolean,
): Promise<{ job: JobDto; reused: boolean }> {
  const result = await enqueueTrackedJob({
    jobType: "ANALYZE_CHAPTER",
    entityType: "CHAPTER",
    entityId: chapter.id,
    payload: { chapterId: chapter.id, force, lane: chapterAnalysisLane(sourceFormat) },
    requestFingerprint: `${chapter.contentHash}:${CHAPTER_ANALYSIS_PROMPT_VERSION}:${force ? "force" : "auto"}`,
  });
  if (!result.reused) await setChapterAnalysisStatus(chapter.id, "QUEUED");
  return result;
}

export async function requestChapterAnalysis(chapterId: string, force: boolean): Promise<JobDto> {
  const chapter = await findChapterWithBook(chapterId);
  if (!chapter) throw new NotFoundError("CHAPTER_NOT_FOUND", "Không tìm thấy chương.");
  if (!force && (await isUpToDate(chapter, chapter.book.title))) {
    throw new AppError(
      "ANALYSIS_UP_TO_DATE",
      "Chương đã được phân tích với cùng nội dung và phiên bản prompt. Chọn “Phân tích lại” nếu vẫn muốn chạy.",
      409,
    );
  }
  return (await enqueueAnalysis(chapter, chapter.book.sourceFormat, force)).job;
}

function pickChapters<T extends { id: string }>(chapters: readonly T[], chapterIds: readonly string[]): T[] {
  const wanted = new Set(chapterIds);
  const picked = chapters.filter((chapter) => wanted.has(chapter.id));
  if (picked.length !== wanted.size) {
    throw new NotFoundError("CHAPTER_NOT_FOUND", "Có chương được chọn không thuộc sách này.");
  }
  return picked;
}

// Queues the chosen chapters (every chapter when none are named) that still need analysis, in book order; their lane
// (NotebookLM's for a PDF book, Claude's otherwise) runs as many at once as Settings allow.
export async function requestBookAnalysis(
  bookId: string,
  chapterIds?: readonly string[],
): Promise<{ jobs: JobDto[]; skipped: number }> {
  const book = await getBook(bookId);
  const bookChapters = await listChaptersByBook(bookId);
  if (bookChapters.length === 0) {
    throw new AppError(
      "BOOK_HAS_NO_CHAPTERS",
      "Sách chưa có chương để phân tích. Với PDF, hãy hoàn tất trích xuất và tạo chương trước.",
      409,
    );
  }
  const chapters = chapterIds ? pickChapters(bookChapters, chapterIds) : bookChapters;
  const jobs: JobDto[] = [];
  let skipped = 0;

  for (const chapter of chapters) {
    if (await isUpToDate(chapter, book.title)) {
      skipped += 1;
      continue;
    }
    jobs.push((await enqueueAnalysis(chapter, book.sourceFormat, false)).job);
  }
  return { jobs, skipped };
}
