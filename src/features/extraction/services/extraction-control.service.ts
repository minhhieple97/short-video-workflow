import "server-only";

import { AppError, NotFoundError } from "@/shared/errors";

import { TEXT_COMPLETE_STATUSES, toExtractionStatus } from "../domain/extraction-status";
import { findExtraction } from "../repositories/extraction.repository";
import type { ExtractionDto } from "../schemas/extraction.dto";
import { setOcrCostCeiling } from "./ocr-budget.service";
import { getExtraction } from "./extraction-view.service";

// Only the user changes the OCR ceiling, and only while the run may still need OCR; never below what is committed.
export async function updateOcrCeiling(extractionId: string, ceilingUsd: number): Promise<ExtractionDto> {
  const extraction = await findExtraction(extractionId);
  if (!extraction) throw new NotFoundError("EXTRACTION_NOT_FOUND", "Không tìm thấy lần trích xuất.");
  if (TEXT_COMPLETE_STATUSES.includes(toExtractionStatus(extraction.status))) {
    throw new AppError("EXTRACTION_FINISHED", "Sách đã có toàn bộ chữ; không cần đổi trần chi phí OCR nữa.", 409);
  }
  await setOcrCostCeiling(extractionId, ceilingUsd);
  return getExtraction(extractionId);
}
