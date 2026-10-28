import type { OcrChunkResult } from "@/server/ocr/ocr-provider";
import { createLogger } from "@/shared/logger";

import { reconcileOcrResults, type PlannedOcrChunk } from "../domain/ocr-results";
import { storeOcrPageOutcomes, type StoredOcrOutcomes } from "../repositories/extraction-page.repository";

const logger = createLogger("extraction.ocr-results");

export interface RecordedOcrResults extends StoredOcrOutcomes {
  unexpectedChunkIds: string[];
}

// Validates what the provider returned against the chunk plan and stores one outcome per page that was sent.
export async function recordOcrResults(
  extractionId: string,
  plan: readonly PlannedOcrChunk[],
  results: readonly OcrChunkResult[],
): Promise<RecordedOcrResults> {
  const { pages, unexpectedChunkIds } = reconcileOcrResults(plan, results);
  const stored = await storeOcrPageOutcomes(extractionId, pages);
  logger.info("OCR results recorded", { extractionId, ...stored, unexpectedChunks: unexpectedChunkIds.length });
  return { ...stored, unexpectedChunkIds };
}
