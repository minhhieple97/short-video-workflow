import "server-only";

import type { BookExtraction } from "@/generated/prisma/client";
import { NotFoundError } from "@/shared/errors";

import {
  isPermanentExtractionFailure,
  RUNNABLE_EXTRACTION_STATUSES,
  TEXT_COMPLETE_STATUSES,
  toExtractionStatus,
} from "../domain/extraction-status";
import { findActiveExtractionJob } from "../repositories/extraction-jobs.repository";
import {
  countExtractedByMethod,
  countPagesByStatus,
  listPageNumbersWithStatus,
} from "../repositories/extraction-page.repository";
import { findExtraction, findLatestExtractionForBook } from "../repositories/extraction.repository";
import { findOpenOcrOperation } from "../repositories/ocr-operation.repository";
import type { ExtractionDto } from "../schemas/extraction.dto";

const LISTED_FAILED_PAGES = 20;

async function toExtractionDto(extraction: BookExtraction): Promise<ExtractionDto> {
  const [byStatus, byMethod, failed, openBatch, activeJob] = await Promise.all([
    countPagesByStatus(extraction.id),
    countExtractedByMethod(extraction.id),
    listPageNumbersWithStatus(extraction.id, "FAILED"),
    findOpenOcrOperation(extraction.id),
    findActiveExtractionJob(extraction.id),
  ]);
  const status = toExtractionStatus(extraction.status);
  const held = activeJob === null && extraction.errorCode !== null && RUNNABLE_EXTRACTION_STATUSES.includes(status);
  return {
    id: extraction.id,
    bookId: extraction.bookId,
    status,
    pageCount: extraction.pageCount,
    pages: {
      text: byMethod.TEXT ?? 0,
      ocr: byMethod.OCR ?? 0,
      empty: byMethod.EMPTY ?? 0,
      waitingOcr: byStatus.NEEDS_OCR ?? 0,
      sentToOcr: byStatus.OCR_SUBMITTED ?? 0,
      failed: byStatus.FAILED ?? 0,
    },
    failedPages: failed.slice(0, LISTED_FAILED_PAGES),
    ocr: {
      provider: extraction.ocrProvider,
      model: extraction.ocrModel,
      ceilingMicroUsd: extraction.costCeilingMicroUsd,
      reservedMicroUsd: extraction.reservedCostMicroUsd,
      spentMicroUsd: extraction.actualCostMicroUsd,
      openBatch: openBatch && {
        status: openBatch.status,
        pageCount: openBatch.pageCount,
        submittedAt: openBatch.submittedAt?.toISOString() ?? null,
        lastPolledAt: openBatch.lastPolledAt?.toISOString() ?? null,
      },
    },
    errorCode: extraction.errorCode,
    errorMessage: extraction.errorMessage,
    createdAt: extraction.createdAt.toISOString(),
    completedAt: extraction.completedAt?.toISOString() ?? null,
    activeJob: activeJob && { id: activeJob.id, status: activeJob.status },
    held,
    canRetry:
      activeJob === null &&
      status !== "STAGED" &&
      status !== "COMPLETED" &&
      !isPermanentExtractionFailure(status, extraction.errorCode),
    // A FAILED run stopped before OCR (the PDF could not be read), so the ceiling does not matter to it either.
    canSetCeiling: !TEXT_COMPLETE_STATUSES.includes(status) && status !== "FAILED",
  };
}

export async function getExtraction(extractionId: string): Promise<ExtractionDto> {
  const extraction = await findExtraction(extractionId);
  if (!extraction) throw new NotFoundError("EXTRACTION_NOT_FOUND", "Không tìm thấy lần trích xuất.");
  return toExtractionDto(extraction);
}

// The book's latest run; null for a book imported from text, which has none.
export async function getBookExtraction(bookId: string): Promise<ExtractionDto | null> {
  const extraction = await findLatestExtractionForBook(bookId);
  return extraction ? toExtractionDto(extraction) : null;
}
