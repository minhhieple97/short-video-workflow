import type { OcrOperation } from "@/generated/prisma/client";
import { IntegrationError } from "@/server/integrations/integration-error";
import type { OcrChunkResult, OcrInputChunk, OcrProvider } from "@/server/ocr/ocr-provider";
import { AppError, NotFoundError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import type { PlannedOcrChunk } from "../domain/ocr-results";
import { resetFailedOcrPages } from "../repositories/extraction-page.repository";
import {
  beginOcrSubmit,
  findOcrOperation,
  markOcrCleaned,
  markOcrOutputStored,
  markOcrPagesFailed,
  markOcrPagesReadyForRetry,
  markOcrPolled,
  markOcrSubmitted,
  markOcrUnknownOutcome,
  revertOcrToPlanned,
} from "../repositories/ocr-operation.repository";
import { settleOcrOperation } from "./ocr-budget.service";
import { recordOcrResults, type RecordedOcrResults } from "./ocr-results.service";

const logger = createLogger("extraction.ocr-operation");

export interface OcrChunkSpec extends PlannedOcrChunk {
  filePath: string;
  bytes: number;
}

export type OcrCompletion = { status: "COMPLETED" } & RecordedOcrResults;

export type SubmitOcrOutcome =
  | { status: "SUBMITTED"; operationRef: string }
  | OcrCompletion
  // The provider may or may not have accepted it: reconcile before sending anything again.
  | { status: "UNKNOWN_OUTCOME" }
  | { status: "FAILED"; code: string }
  // Nothing was accepted or billed (auth, quota, outage): the operation is PLANNED again, reservation intact.
  | { status: "RETRY_LATER"; code: string; retryAfterMs: number | null };

export type CollectOcrOutcome =
  | { status: "PENDING"; retryAfterMs: number }
  | OcrCompletion
  | { status: "FAILED"; code: string; retryable: boolean }
  | { status: "CANCELLED" };

const toPlan = (chunks: readonly OcrChunkSpec[]): PlannedOcrChunk[] =>
  chunks.map(({ chunkId, pageNumbers }) => ({ chunkId, pageNumbers }));

const pageNumbersOf = (plan: readonly PlannedOcrChunk[]): number[] => plan.flatMap((chunk) => [...chunk.pageNumbers]);

const toInputChunks = (chunks: readonly OcrChunkSpec[]): OcrInputChunk[] =>
  chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    filePath: chunk.filePath,
    pageCount: chunk.pageNumbers.length,
    bytes: chunk.bytes,
  }));

async function requireOperation(operationId: string): Promise<OcrOperation> {
  const operation = await findOcrOperation(operationId);
  if (!operation) throw new NotFoundError("OCR_OPERATION_NOT_FOUND", "Không tìm thấy lô OCR.");
  return operation;
}

// Stores the results first, then settles the budget, and only then asks the provider to delete its copies: if
// anything before the cleanup fails, the provider still holds the output and the step can simply run again.
async function finishCompleted(
  provider: OcrProvider,
  operation: OcrOperation,
  plan: readonly PlannedOcrChunk[],
  chunks: readonly OcrChunkResult[],
): Promise<OcrCompletion> {
  const recorded = await recordOcrResults(operation.extractionId, plan, chunks);
  await markOcrOutputStored(operation.id);
  await settleOcrOperation(operation.id, { status: "COMPLETED", reportedMicroUsd: null });

  if (operation.operationRef) {
    try {
      await provider.cleanup(operation.operationRef);
      await markOcrCleaned(operation.id);
    } catch (error) {
      logger.warn("Provider cleanup failed; the output is already stored", {
        operationId: operation.id,
        error: toSafeErrorMessage(error),
      });
    }
  }
  return { status: "COMPLETED", ...recorded };
}

export type ReconcileOcrOutcome = { status: "SUBMITTED"; operationRef: string } | { status: "NOT_FOUND" };

// For an operation whose submit outcome is unknown (or that was left SUBMITTING by a crash): ask the provider whether a
// submission with this request key exists. Found means it is adopted; not found means it is safe to submit again.
export async function reconcileOcrOperation(input: {
  provider: OcrProvider;
  operationId: string;
  plan: readonly PlannedOcrChunk[];
  signal?: AbortSignal;
}): Promise<ReconcileOcrOutcome> {
  const operation = await requireOperation(input.operationId);
  if (operation.status === "SUBMITTED" && operation.operationRef) {
    return { status: "SUBMITTED", operationRef: operation.operationRef };
  }
  if (operation.status !== "UNKNOWN_OUTCOME" && operation.status !== "SUBMITTING") {
    throw new AppError("OCR_OPERATION_NOT_UNKNOWN", "Lô OCR này không ở trạng thái cần đối soát.", 409);
  }

  const operationRef = await input.provider.findOperation(operation.requestKey, { signal: input.signal });
  if (operationRef) {
    await markOcrSubmitted(operation.id, operationRef);
    logger.info("Unknown OCR submission found at the provider", { operationId: operation.id });
    return { status: "SUBMITTED", operationRef };
  }

  await revertOcrToPlanned(operation, pageNumbersOf(input.plan));
  logger.info("Unknown OCR submission was never accepted; safe to submit again", { operationId: operation.id });
  return { status: "NOT_FOUND" };
}

export async function submitOcrOperation(input: {
  provider: OcrProvider;
  operationId: string;
  chunks: readonly OcrChunkSpec[];
  signal?: AbortSignal;
}): Promise<SubmitOcrOutcome> {
  const { provider, signal } = input;
  const plan = toPlan(input.chunks);
  let operation = await requireOperation(input.operationId);

  if (operation.status === "SUBMITTED" && operation.operationRef) {
    return { status: "SUBMITTED", operationRef: operation.operationRef };
  }
  if (operation.status === "SUBMITTING" || operation.status === "UNKNOWN_OUTCOME") {
    const reconciled = await reconcileOcrOperation({ provider, operationId: operation.id, plan, signal });
    if (reconciled.status === "SUBMITTED") return reconciled;
    operation = await requireOperation(operation.id);
  }
  if (operation.status !== "PLANNED") {
    throw new AppError("OCR_OPERATION_SETTLED", "Lô OCR này đã kết thúc, không thể gửi.", 409);
  }
  if (!(await beginOcrSubmit(operation, pageNumbersOf(plan)))) {
    throw new AppError("OCR_OPERATION_BUSY", "Lô OCR đang được xử lý ở nơi khác.", 409);
  }

  try {
    const started = await provider.start(
      { requestKey: operation.requestKey, chunks: toInputChunks(input.chunks) },
      { signal },
    );
    if (started.status === "completed") return await finishCompleted(provider, operation, plan, started.chunks);

    await markOcrSubmitted(operation.id, started.operationRef);
    return { status: "SUBMITTED", operationRef: started.operationRef };
  } catch (error) {
    return handleSubmitFailure(operation, plan, error);
  }
}

async function handleSubmitFailure(
  operation: OcrOperation,
  plan: readonly PlannedOcrChunk[],
  error: unknown,
): Promise<SubmitOcrOutcome> {
  if (!(error instanceof IntegrationError)) {
    // Anything unexpected (including an abort mid-call) may have reached the provider, so reconcile before resubmitting.
    await markOcrUnknownOutcome(operation.id, "OCR_SUBMIT_ERROR", toSafeErrorMessage(error));
    throw error;
  }

  switch (error.kind) {
    case "UNKNOWN_OUTCOME":
      await markOcrUnknownOutcome(operation.id, error.code, error.message);
      return { status: "UNKNOWN_OUTCOME" };
    case "REJECTED":
      await markOcrPagesFailed(operation, pageNumbersOf(plan), error.code);
      await settleOcrOperation(operation.id, { status: "FAILED" });
      return { status: "FAILED", code: error.code };
    default:
      await revertOcrToPlanned(operation, pageNumbersOf(plan));
      return { status: "RETRY_LATER", code: error.code, retryAfterMs: error.retryAfterMs ?? null };
  }
}

// One non-blocking step: ask the provider where the batch stands. Never waits; a pending batch is reported back so
// the caller can defer the job.
export async function collectOcrOperation(input: {
  provider: OcrProvider;
  operationId: string;
  plan: readonly PlannedOcrChunk[];
  signal?: AbortSignal;
}): Promise<CollectOcrOutcome> {
  const { provider, plan, signal } = input;
  const operation = await requireOperation(input.operationId);
  if (operation.status !== "SUBMITTED" || !operation.operationRef) {
    throw new AppError("OCR_OPERATION_NOT_SUBMITTED", "Lô OCR chưa được gửi nên chưa thể lấy kết quả.", 409);
  }

  const status = await provider.poll(operation.operationRef, { signal });
  await markOcrPolled(operation.id);

  switch (status.status) {
    case "pending":
      return { status: "PENDING", retryAfterMs: status.retryAfterMs };
    case "completed":
      return finishCompleted(provider, operation, plan, status.chunks);
    case "failed":
      await markOcrPagesFailed(operation, pageNumbersOf(plan), status.code);
      await settleOcrOperation(operation.id, { status: "FAILED" });
      return { status: "FAILED", code: status.code, retryable: status.retryable };
    case "cancelled":
      await markOcrPagesReadyForRetry(operation, pageNumbersOf(plan));
      await settleOcrOperation(operation.id, { status: "CANCELLED" });
      return { status: "CANCELLED" };
  }
}

// Sends only what needs sending again: the pages that were headed for OCR and failed. The caller chunks them and plans a
// new operation, which has to fit the remaining budget.
export function resetFailedOcrPagesForRetry(extractionId: string): Promise<number[]> {
  return resetFailedOcrPages(extractionId);
}
