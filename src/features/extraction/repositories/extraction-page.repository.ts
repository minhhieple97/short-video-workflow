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
