import type { OcrOperation } from "@/generated/prisma/client";
import type { OcrProvider } from "@/server/ocr/ocr-provider";
import { AppError, NotFoundError } from "@/shared/errors";

import { formatUsd, toMicroUsd } from "../domain/ocr-budget";
import { serializeChunkPlan } from "../domain/ocr-chunk-plan";
import type { PlannedOcrChunk } from "../domain/ocr-results";
import {
  reserveOcrOperation,
  setOcrCostCeiling as storeCostCeiling,
  settleOcrOperation as storeSettlement,
  type OcrSettlement,
} from "../repositories/ocr-operation.repository";

const missingExtraction = () => new NotFoundError("EXTRACTION_NOT_FOUND", "Không tìm thấy lần trích xuất.");

export interface PlanOcrOperationInput {
  provider: OcrProvider;
  extractionId: string;
  // Stable per set of chunks: a replay gets the existing operation instead of reserving budget again.
  requestKey: string;
  pageCount: number;
  // Stored with the operation so a later step can rebuild the chunk files and map results back to PDF pages.
  chunkPlan?: readonly PlannedOcrChunk[];
}

// Reserves budget for one OCR batch and records it as PLANNED before anything is sent to the provider.
export async function planOcrOperation(input: PlanOcrOperationInput): Promise<OcrOperation> {
  const { provider, extractionId, requestKey, pageCount, chunkPlan } = input;
  const result = await reserveOcrOperation({
    extractionId,
    provider: provider.id,
    model: provider.model,
    requestKey,
    pageCount,
    estimateMicroUsd: toMicroUsd(provider.estimateCostUsd(pageCount)),
    chunkPlanJson: chunkPlan ? serializeChunkPlan(chunkPlan) : undefined,
  });

  switch (result.kind) {
    case "reserved":
    case "replayed":
      return result.operation;
    case "extraction_missing":
      throw missingExtraction();
    case "ceiling_missing":
      throw new AppError(
        "OCR_CEILING_NOT_SET",
        "Lần trích xuất chưa có trần chi phí OCR. Hãy đặt trần trước khi chạy.",
        409,
      );
    case "provider_mismatch":
      throw new AppError(
        "OCR_PROVIDER_CHANGED",
        `Lần trích xuất này đã dùng ${result.provider} (${result.model}); hệ thống không tự đổi nhà cung cấp OCR.`,
        409,
      );
    case "pacing_blocked":
      throw new AppError(
        "OCR_BATCH_IN_PROGRESS",
        "Đang có một lô OCR chưa xong; chờ nó kết thúc rồi mới gửi lô tiếp.",
        409,
        {
          details: { operationId: result.openOperationId },
        },
      );
    case "budget_exceeded":
      throw new AppError(
        "OCR_BUDGET_EXCEEDED",
        `OCR cần khoảng ${formatUsd(result.requestedMicroUsd)} nhưng chỉ còn ${formatUsd(result.remainingMicroUsd)} trong trần ${formatUsd(result.ceilingMicroUsd)}.`,
        409,
        { details: { ...result } },
      );
  }
}

export async function settleOcrOperation(operationId: string, settlement: OcrSettlement): Promise<OcrOperation> {
  const operation = await storeSettlement(operationId, settlement);
  if (!operation) throw new NotFoundError("OCR_OPERATION_NOT_FOUND", "Không tìm thấy lô OCR.");
  return operation;
}

export async function setOcrCostCeiling(extractionId: string, ceilingUsd: number): Promise<void> {
  const result = await storeCostCeiling(extractionId, toMicroUsd(ceilingUsd));
  if (result.kind === "extraction_missing") throw missingExtraction();
  if (result.kind === "below_committed") {
    throw new AppError(
      "OCR_CEILING_BELOW_COMMITTED",
      `Trần phải từ ${formatUsd(result.committedMicroUsd)} trở lên vì khoản này đã chi hoặc đang giữ chỗ.`,
      409,
    );
  }
}
