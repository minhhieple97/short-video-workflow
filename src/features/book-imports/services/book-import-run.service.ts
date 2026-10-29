import { createHash } from "node:crypto";

import { currentArchiveDestination } from "@/features/archive/services/archive-request.service";
import { findRenderArchive } from "@/features/archive/repositories/render-archive.repository";
import { retryArchiveRecord } from "@/features/archive/services/archive-retry.service";
import { resetExtractionForRetry } from "@/features/extraction/repositories/extraction-jobs.repository";
import { resetItemForRetry } from "@/features/productions/repositories/production-jobs.repository";
import { findActiveJobForEntity } from "@/features/jobs/repositories/job-record.repository";
import {
  findLessonsForProduction,
  createProduction,
  findProductionByKey,
} from "@/features/productions/repositories/production.repository";
import { MAX_LESSONS_PER_PRODUCTION } from "@/features/productions/schemas/production.schema";
import { buildLessonSnapshot } from "@/features/videos/services/lesson-snapshot-builder";
import { AppError } from "@/shared/errors";
import { toSafeErrorMessage } from "@/shared/logger";

import { FINISHED_BOOK_IMPORT_ITEMS } from "../domain/book-import-status";
import {
  activateBookExtraction,
  findImportArchives,
  findLatestImportChapterJob,
  findNextBookImport,
  finishBookImport,
  listImportedLessonIds,
  queueImportedChapter,
  setBookImportItem,
  type BookImportRecord,
} from "../repositories/book-import.repository";

type ImportItem = BookImportRecord["items"][number];

async function produceAllLessons(batch: BookImportRecord, item: ImportItem): Promise<void> {
  if (!item.bookId) throw new AppError("BOOK_IMPORT_MISSING", "Sách chưa được tải lên.");
  const ids = (await listImportedLessonIds(item.bookId)).map((lesson) => lesson.id);
  if (ids.length === 0)
    throw new AppError("BOOK_HAS_NO_LESSONS", "NotebookLM chưa tìm được bài học nào. Hãy kiểm tra sách.", 422);
  for (let offset = 0; offset < ids.length; offset += MAX_LESSONS_PER_PRODUCTION) {
    const lessonIds = ids.slice(offset, offset + MAX_LESSONS_PER_PRODUCTION);
    const idempotencyKey = `book-import-${item.id}-${offset}`;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ lessonIds, min: batch.minDurationSec, max: batch.maxDurationSec, pace: batch.pace }))
      .digest("hex");
    const saved = await findProductionByKey(idempotencyKey);
    if (saved) {
      if (saved.fingerprint !== fingerprint)
        throw new AppError(
          "BOOK_IMPORT_CATALOGUE_CHANGED",
          "Danh sách bài học đã đổi trong lúc tạo video. Hãy kiểm tra đợt sản xuất.",
          409,
        );
      continue;
    }
    const lessons = await findLessonsForProduction(item.bookId, lessonIds);
    const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    const capturedAt = new Date().toISOString();
    await createProduction({
      bookId: item.bookId,
      importItemId: item.id,
      idempotencyKey,
      fingerprint,
      range: { minDurationSec: batch.minDurationSec, maxDurationSec: batch.maxDurationSec },
      pace: batch.pace,
      items: lessonIds.map((id, index) => {
        const lesson = byId.get(id);
        if (!lesson)
          throw new AppError("BOOK_IMPORT_LESSON_MISSING", "Bài học đã bị thay đổi trong lúc tạo video.", 409);
        return {
          lessonId: id,
          position: index + 1,
          videoTitle: lesson.title.slice(0, 200),
          snapshot: buildLessonSnapshot(lesson, capturedAt),
        };
      }),
    });
  }
  await setBookImportItem(item.id, "PRODUCING");
}

async function advanceBook(batch: BookImportRecord, item: ImportItem): Promise<void> {
  const book = item.book;
  const extraction = book?.extractions[0];
  if (!book || !extraction || book.deletedAt)
    throw new AppError("BOOK_IMPORT_MISSING", "Không còn tìm thấy sách hoặc lần trích xuất.", 409);
  if (extraction.status === "STAGED") {
    await activateBookExtraction(item.id, extraction.id);
    return;
  }
  if (extraction.status !== "COMPLETED") {
    const active = await findActiveJobForEntity("EXTRACT_PDF", "EXTRACTION", extraction.id);
    if (!active && item.status === "QUEUED") {
      await resetExtractionForRetry(extraction.id);
      await setBookImportItem(item.id, "EXTRACTING");
      return;
    }
    if (!active)
      throw new AppError(
        extraction.errorCode ?? "EXTRACTION_STOPPED",
        extraction.errorMessage ?? "Trích xuất đã dừng. Hãy kiểm tra sách và thử lại.",
        422,
      );
    return;
  }
  if (book.chapters.length === 0) throw new AppError("BOOK_HAS_NO_CHAPTERS", "Sách chưa có chương để phân tích.", 422);
  const chapter = book.chapters.find((row) => row.analysisStatus !== "ANALYZED");
  if (chapter) {
    const active = await findActiveJobForEntity("ANALYZE_CHAPTER", "CHAPTER", chapter.id);
    if (!active && item.status !== "QUEUED" && ["FAILED", "PARTIAL"].includes(chapter.analysisStatus)) {
      const previous = await findLatestImportChapterJob(chapter.id);
      if (previous?.errorCode !== "JOB_LOST")
        throw new AppError(
          "CHAPTER_ANALYSIS_STOPPED",
          `Chương “${chapter.title.slice(0, 120)}” phân tích chưa hoàn tất. Hãy kiểm tra trước khi thử lại.`,
          422,
        );
    }
    await setBookImportItem(item.id, "ANALYZING");
    await queueImportedChapter(item.id, chapter.id);
    return;
  }
  if (item.status !== "PRODUCING") {
    if (item.status === "QUEUED" && item.productions.length > 0) {
      const videos = item.productions.flatMap((production) => production.items);
      for (const video of videos) if (["FAILED", "CANCELLED"].includes(video.status)) await resetItemForRetry(video.id);
      for (const archive of await findImportArchives(
        videos.flatMap((video) => (video.renderId ? [video.renderId] : [])),
      )) {
        if (archive.status === "FAILED") {
          const record = await findRenderArchive(archive.id);
          if (record) await retryArchiveRecord(record);
        }
      }
    }
    await produceAllLessons(batch, item);
    return;
  }
  const videos = item.productions.flatMap((production) => production.items);
  if (videos.length === 0) throw new AppError("BOOK_IMPORT_NO_PRODUCTION", "Chưa có video nào trong đợt nhập.", 422);
  if (videos.some((video) => !["COMPLETED", "FAILED", "CANCELLED"].includes(video.status))) return;
  const renders = videos.flatMap((video) => (video.renderId ? [video.renderId] : []));
  const destination = await currentArchiveDestination();
  const archives = destination
    ? (await findImportArchives(renders)).filter((archive) => archive.destinationKey === destination.destinationKey)
    : [];
  if (
    destination &&
    (renders.some((id) => !archives.some((archive) => archive.renderId === id)) ||
      archives.some((archive) => !["COMPLETED", "FAILED", "CANCELLED"].includes(archive.status)))
  )
    return;
  const failure =
    videos.find((video) => video.status !== "COMPLETED") ?? archives.find((archive) => archive.status !== "COMPLETED");
  if (failure)
    throw new AppError(
      failure.errorCode ?? "BOOK_IMPORT_VIDEO_FAILED",
      failure.errorMessage ?? "Có video hoặc bản lưu Drive lỗi. Mở đợt sản xuất để xem chi tiết.",
      422,
    );
  await setBookImportItem(item.id, "COMPLETED");
}

export async function sweepBookImports(): Promise<void> {
  const batch = await findNextBookImport();
  if (!batch) return;
  if (
    batch.items.some(
      (row) =>
        row.status === "FAILED" &&
        row.productions.some((production) =>
          production.items.some((video) => !["COMPLETED", "FAILED", "CANCELLED"].includes(video.status)),
        ),
    )
  )
    return;
  const item = batch.items.find((row) => !FINISHED_BOOK_IMPORT_ITEMS.includes(row.status));
  if (!item) return finishBookImport(batch.id);
  try {
    await advanceBook(batch, item);
  } catch (error) {
    await setBookImportItem(item.id, "FAILED", {
      code: error instanceof AppError ? error.code : "BOOK_IMPORT_ERROR",
      message: toSafeErrorMessage(error),
    });
  }
  await finishBookImport(batch.id);
}
