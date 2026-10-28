import { prisma } from "@/server/db/client";

import type { OcrPageOutcome } from "../domain/ocr-results";

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
