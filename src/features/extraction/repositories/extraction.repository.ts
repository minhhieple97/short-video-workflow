import type { NewChapterRecord } from "@/features/books/repositories/book.repository";
import type { Book, BookExtraction, JobRecord } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { AppError } from "@/shared/errors";
import { notifyExtractionFailureWithin } from "@/features/notifications/repositories/notification-events.repository";

import { startExtractionJobWithin } from "./extraction-jobs.repository";

interface NewPdfBook {
  id: string;
  title: string;
  sourceFilePath: string;
  sourceFileName: string;
  sourceHash: string;
  sourceSizeBytes: number;
}

// The book, its first extraction run and the job that runs it are created together: a PDF book without a run, or a run
// without a job, would never be processed.
export function createPdfBookWithExtraction(
  book: NewPdfBook,
  costCeilingMicroUsd: number,
): Promise<{ book: Book; extraction: BookExtraction; job: JobRecord }>;
export function createPdfBookWithExtraction(
  book: NewPdfBook,
  costCeilingMicroUsd: number,
  batchItemId: string | undefined,
): Promise<{ book: Book; extraction: BookExtraction; job: JobRecord | null }>;
export function createPdfBookWithExtraction(
  book: NewPdfBook,
  costCeilingMicroUsd: number,
  batchItemId?: string,
): Promise<{ book: Book; extraction: BookExtraction; job: JobRecord | null }> {
  return prisma.$transaction(async (tx) => {
    if (batchItemId) {
      const attached = await tx.bookImportItem.updateMany({
        where: { id: batchItemId, bookId: null, batch: { status: "UPLOADING" }, fileName: book.sourceFileName },
        data: { status: "QUEUED" },
      });
      if (!attached.count)
        throw new AppError("BOOK_IMPORT_FILE_CONFLICT", "Tệp đã được tải lên hoặc đợt nhập đã đóng.", 409);
    }
    const created = await tx.book.create({
      data: { ...book, sourceFormat: "pdf", language: "vi", status: "ACTIVE" },
    });
    const extraction = await tx.bookExtraction.create({
      data: {
        bookId: created.id,
        status: batchItemId ? "STAGED" : "QUEUED",
        sourceHash: book.sourceHash,
        costCeilingMicroUsd,
      },
    });
    if (batchItemId) await tx.bookImportItem.update({ where: { id: batchItemId }, data: { bookId: created.id } });
    return { book: created, extraction, job: batchItemId ? null : await startExtractionJobWithin(tx, extraction.id) };
  });
}

export function findExtraction(extractionId: string): Promise<BookExtraction | null> {
  return prisma.bookExtraction.findUnique({ where: { id: extractionId } });
}

export async function setCanonicalPath(extractionId: string, canonicalPath: string): Promise<void> {
  await prisma.bookExtraction.update({ where: { id: extractionId }, data: { canonicalPath } });
}

export function findExtractionWithBook(extractionId: string) {
  return prisma.bookExtraction.findUnique({
    where: { id: extractionId },
    include: { book: { select: { id: true, title: true, sourceFilePath: true, sourceFormat: true } } },
  });
}

// Moves the run on only from a status it is expected to be in, so a stale step cannot pull it back.
export async function moveExtractionStatus(
  extractionId: string,
  from: readonly string[],
  data: {
    status: string;
    pageCount?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    completedAt?: Date | null;
  },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.bookExtraction.findUnique({ where: { id: extractionId } });
    const { count } = await tx.bookExtraction.updateMany({
      where: { id: extractionId, status: { in: [...from] } },
      data,
    });
    if (
      count > 0 &&
      data.errorCode &&
      data.errorMessage &&
      (previous?.status !== data.status || previous.errorCode !== data.errorCode)
    ) {
      await notifyExtractionFailureWithin(tx, extractionId, {
        code: data.errorCode,
        message: data.errorMessage,
        stage: extractionStage(previous?.status),
      });
    }
    return count > 0;
  });
}

function extractionStage(status?: string): string {
  if (status === "DETECTING_CHAPTERS" || status === "ASSEMBLING") return "Nhận diện / chia chương";
  if (status === "OCR_PENDING") return "OCR nội dung PDF";
  return "Đọc / trích xuất PDF";
}

// Records why the run cannot go on by itself (no OCR key, budget, permission) without changing where it stands.
export async function holdExtraction(extractionId: string, error: { code: string; message: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const previous = await tx.bookExtraction.findUniqueOrThrow({ where: { id: extractionId } });
    await tx.bookExtraction.update({
      where: { id: extractionId },
      data: { errorCode: error.code, errorMessage: error.message },
    });
    if (previous.errorCode !== error.code || previous.errorMessage !== error.message) {
      await notifyExtractionFailureWithin(tx, extractionId, { ...error, stage: extractionStage(previous.status) });
    }
  });
}

export async function recordExtractionProgress(extractionId: string): Promise<void> {
  await prisma.bookExtraction.update({
    where: { id: extractionId },
    data: { transientFailures: 0, errorCode: null, errorMessage: null },
  });
}

// Returns how many temporary failures in a row the run has now had.
export async function recordExtractionTransientFailure(
  extractionId: string,
  error: { code: string; message: string },
): Promise<number> {
  const updated = await prisma.bookExtraction.update({
    where: { id: extractionId },
    data: { transientFailures: { increment: 1 }, errorCode: error.code, errorMessage: error.message },
    select: { transientFailures: true },
  });
  return updated.transientFailures;
}

export type FinishExtractionResult = "completed" | "already_finished";

// Creates the book's chapters and completes the run in one transaction. Moving the run out of `from` is the first write,
// so a replayed step finds it already finished instead of creating the chapters twice.
export function completeExtractionWithChapters(
  extractionId: string,
  bookId: string,
  from: "ASSEMBLING" | "DETECTING_CHAPTERS",
  chapters: readonly NewChapterRecord[],
): Promise<FinishExtractionResult> {
  return prisma.$transaction(async (tx): Promise<FinishExtractionResult> => {
    const { count } = await tx.bookExtraction.updateMany({
      where: { id: extractionId, status: from },
      data: { status: "COMPLETED", completedAt: new Date(), errorCode: null, errorMessage: null },
    });
    if (count === 0) return "already_finished";
    await tx.chapter.createMany({
      data: chapters.map((chapter) => ({ ...chapter, bookId, analysisStatus: "NOT_ANALYZED" })),
    });
    return "completed";
  });
}

export function findLatestExtractionForBook(bookId: string): Promise<BookExtraction | null> {
  return prisma.bookExtraction.findFirst({ where: { bookId }, orderBy: { createdAt: "desc" } });
}

// The run a PDF book's chapters were made from: its latest completed extraction.
export function findCompletedExtractionForBook(bookId: string): Promise<BookExtraction | null> {
  return prisma.bookExtraction.findFirst({
    where: { bookId, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
  });
}
