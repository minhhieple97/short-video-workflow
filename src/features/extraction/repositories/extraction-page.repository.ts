import { prisma } from "@/server/db/client";

import type { OcrPageOutcome } from "../domain/ocr-results";
import type { PageClassification } from "../domain/page-classification";

// Only a page still waiting for OCR (or one whose earlier OCR failed) may take an OCR result. A page that already
// holds text, from the PDF's text layer or from an earlier OCR success, is never overwritten.
const OCR_ELIGIBLE_STATUSES = ["NEEDS_OCR", "OCR_SUBMITTED", "FAILED"];

export interface StoredOcrOutcomes {
  stored: number;
  failed: number;
  skipped: number;
}

export async function storeOcrPageOutcomes(
  extractionId: string,
  outcomes: readonly OcrPageOutcome[],
): Promise<StoredOcrOutcomes> {
  const results = await prisma.$transaction(
    outcomes.map((outcome) =>
      prisma.extractionPage.updateMany({
        where: { extractionId, pageNumber: outcome.pageNumber, status: { in: OCR_ELIGIBLE_STATUSES } },
        data:
          outcome.status === "OK"
            ? {
                status: "EXTRACTED",
                method: outcome.method,
                text: outcome.text,
                confidence: outcome.confidence,
                errorCode: null,
              }
            : { status: "FAILED", errorCode: outcome.code },
      }),
    ),
  );

  const summary: StoredOcrOutcomes = { stored: 0, failed: 0, skipped: 0 };
  results.forEach((result, index) => {
    if (result.count === 0) summary.skipped += 1;
    else if (outcomes[index]?.status === "OK") summary.stored += 1;
    else summary.failed += 1;
  });
  return summary;
}

export interface ClassifiedPage {
  pageNumber: number;
  classification: PageClassification;
}

// Records the text-layer result of every page. A page already further along (OCR sent, OCR done, OCR failed) keeps its
// state, so running the step again after a crash never undoes OCR work or pays for it twice.
export function storeClassifiedPages(extractionId: string, pages: readonly ClassifiedPage[]): Promise<void> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.extractionPage.findMany({
      where: { extractionId },
      select: { pageNumber: true, status: true },
    });
    const status = new Map(existing.map((page) => [page.pageNumber, page.status]));
    for (const { pageNumber, classification } of pages) {
      const current = status.get(pageNumber);
      if (current !== undefined && current !== "PENDING") continue;
      const data =
        classification.method === "OCR"
          ? { status: "NEEDS_OCR", method: null, ocrReason: classification.reason, text: null }
          : { status: "EXTRACTED", method: classification.method, ocrReason: null, text: classification.text };
      if (current === undefined) await tx.extractionPage.create({ data: { extractionId, pageNumber, ...data } });
      else await tx.extractionPage.update({ where: { extractionId_pageNumber: { extractionId, pageNumber } }, data });
    }
  });
}

export async function countPagesByStatus(extractionId: string): Promise<Record<string, number>> {
  const groups = await prisma.extractionPage.groupBy({ by: ["status"], where: { extractionId }, _count: true });
  return Object.fromEntries(groups.map((group) => [group.status, group._count]));
}

export async function countExtractedByMethod(extractionId: string): Promise<Record<string, number>> {
  const groups = await prisma.extractionPage.groupBy({
    by: ["method"],
    where: { extractionId, status: "EXTRACTED" },
    _count: true,
  });
  return Object.fromEntries(groups.map((group) => [group.method ?? "", group._count]));
}

export function listExtractionPages(extractionId: string) {
  return prisma.extractionPage.findMany({
    where: { extractionId },
    orderBy: { pageNumber: "asc" },
    select: { pageNumber: true, status: true, text: true },
  });
}

// Pages that were headed for OCR and failed go back to the queue; pages that failed for another reason are left alone.
export async function resetFailedOcrPages(extractionId: string): Promise<number[]> {
  return prisma.$transaction(async (tx) => {
    const failed = await tx.extractionPage.findMany({
      where: { extractionId, status: "FAILED", ocrReason: { not: null } },
      orderBy: { pageNumber: "asc" },
      select: { pageNumber: true },
    });
    const pageNumbers = failed.map((page) => page.pageNumber);
    await tx.extractionPage.updateMany({
      where: { extractionId, pageNumber: { in: pageNumbers }, status: "FAILED" },
      data: { status: "NEEDS_OCR", errorCode: null },
    });
    return pageNumbers;
  });
}

export async function listPageNumbersWithStatus(extractionId: string, status: string): Promise<number[]> {
  const pages = await prisma.extractionPage.findMany({
    where: { extractionId, status },
    orderBy: { pageNumber: "asc" },
    select: { pageNumber: true },
  });
  return pages.map((page) => page.pageNumber);
}

// Pages that cannot be sent at all (a single page over the provider's size limit) fail with their reason instead of
// being skipped, so the run ends PARTIAL rather than silently missing them.
export async function markPagesUnsendable(
  extractionId: string,
  pageNumbers: readonly number[],
  errorCode: string,
): Promise<void> {
  await prisma.extractionPage.updateMany({
    where: { extractionId, pageNumber: { in: [...pageNumbers] }, status: "NEEDS_OCR" },
    data: { status: "FAILED", errorCode },
  });
}

// Pages marked as sent while no operation is open any more belong to nothing; they go back to the queue to be sent.
export async function requeueOrphanedOcrPages(extractionId: string): Promise<number> {
  const { count } = await prisma.extractionPage.updateMany({
    where: { extractionId, status: "OCR_SUBMITTED" },
    data: { status: "NEEDS_OCR" },
  });
  return count;
}
