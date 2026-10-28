import type { BookExtraction, OcrOperation } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

import {
  fitsBudget,
  MAX_OPEN_OCR_OPERATIONS,
  OPEN_OCR_OPERATION_STATUSES,
  remainingBudget,
  SETTLED_OCR_OPERATION_STATUSES,
} from "../domain/ocr-budget";

export interface ReserveOcrOperationInput {
  extractionId: string;
  provider: string;
  model: string;
  requestKey: string;
  pageCount: number;
  estimateMicroUsd: number;
}

export type ReserveOcrOperationResult =
  | { kind: "reserved"; operation: OcrOperation }
  | { kind: "replayed"; operation: OcrOperation }
  | { kind: "extraction_missing" }
  | { kind: "ceiling_missing" }
  | { kind: "provider_mismatch"; provider: string; model: string }
  | { kind: "pacing_blocked"; openOperationId: string }
  | { kind: "budget_exceeded"; requestedMicroUsd: number; remainingMicroUsd: number; ceilingMicroUsd: number };

// One transaction decides everything, so two callers can never both reserve the last of the budget or both open a batch.
export function reserveOcrOperation(input: ReserveOcrOperationInput): Promise<ReserveOcrOperationResult> {
  return prisma.$transaction(async (tx): Promise<ReserveOcrOperationResult> => {
    const replay = await tx.ocrOperation.findUnique({ where: { requestKey: input.requestKey } });
    if (replay) return { kind: "replayed", operation: replay };

    const extraction = await tx.bookExtraction.findUnique({ where: { id: input.extractionId } });
    if (!extraction) return { kind: "extraction_missing" };
    if (extraction.costCeilingMicroUsd === null) return { kind: "ceiling_missing" };
    if (
      extraction.ocrProvider !== null &&
      (extraction.ocrProvider !== input.provider || extraction.ocrModel !== input.model)
    ) {
      return { kind: "provider_mismatch", provider: extraction.ocrProvider, model: extraction.ocrModel ?? "" };
    }

    const open = await tx.ocrOperation.findMany({
      where: { extractionId: input.extractionId, status: { in: [...OPEN_OCR_OPERATION_STATUSES] } },
      select: { id: true },
      take: MAX_OPEN_OCR_OPERATIONS,
    });
    const blocking = open[MAX_OPEN_OCR_OPERATIONS - 1];
    if (blocking) return { kind: "pacing_blocked", openOperationId: blocking.id };

    const budget = {
      ceilingMicroUsd: extraction.costCeilingMicroUsd,
      reservedMicroUsd: extraction.reservedCostMicroUsd,
      spentMicroUsd: extraction.actualCostMicroUsd,
    };
    if (!fitsBudget(budget, input.estimateMicroUsd)) {
      return {
        kind: "budget_exceeded",
        requestedMicroUsd: input.estimateMicroUsd,
        remainingMicroUsd: remainingBudget(budget),
        ceilingMicroUsd: extraction.costCeilingMicroUsd,
      };
    }

    const operation = await tx.ocrOperation.create({
      data: {
        extractionId: input.extractionId,
        provider: input.provider,
        model: input.model,
        requestKey: input.requestKey,
        status: "PLANNED",
        pageCount: input.pageCount,
        reservedCostMicroUsd: input.estimateMicroUsd,
      },
    });
    await tx.bookExtraction.update({
      where: { id: input.extractionId },
      data: {
        reservedCostMicroUsd: { increment: input.estimateMicroUsd },
        ocrProvider: input.provider,
        ocrModel: input.model,
      },
    });
    return { kind: "reserved", operation };
  });
}

// COMPLETED was billed: the provider's figure when it reports one, otherwise the reservation is kept as the spend.
// FAILED and CANCELLED were never billed, so the reservation is released.
export type OcrSettlement =
  { status: "COMPLETED"; reportedMicroUsd: number | null } | { status: "FAILED" | "CANCELLED" };

// Returns null for an unknown operation; settling an already settled operation changes nothing.
export function settleOcrOperation(operationId: string, settlement: OcrSettlement): Promise<OcrOperation | null> {
  return prisma.$transaction(async (tx) => {
    const operation = await tx.ocrOperation.findUnique({ where: { id: operationId } });
    if (!operation) return null;
    if ((SETTLED_OCR_OPERATION_STATUSES as readonly string[]).includes(operation.status)) return operation;

    const reported = settlement.status === "COMPLETED" ? settlement.reportedMicroUsd : null;
    const spent = settlement.status === "COMPLETED" ? (reported ?? operation.reservedCostMicroUsd) : 0;
    await tx.bookExtraction.update({
      where: { id: operation.extractionId },
      data: {
        reservedCostMicroUsd: { decrement: operation.reservedCostMicroUsd },
        actualCostMicroUsd: { increment: spent },
      },
    });
    return tx.ocrOperation.update({
      where: { id: operationId },
      data: { status: settlement.status, actualCostMicroUsd: reported, completedAt: new Date() },
    });
  });
}

export type SetCostCeilingResult =
  | { kind: "updated"; extraction: BookExtraction }
  | { kind: "extraction_missing" }
  | { kind: "below_committed"; committedMicroUsd: number };

// Only an explicit user decision changes the ceiling, and never below what is already spent or reserved.
export function setOcrCostCeiling(extractionId: string, ceilingMicroUsd: number): Promise<SetCostCeilingResult> {
  return prisma.$transaction(async (tx): Promise<SetCostCeilingResult> => {
    const extraction = await tx.bookExtraction.findUnique({ where: { id: extractionId } });
    if (!extraction) return { kind: "extraction_missing" };

    const committedMicroUsd = extraction.reservedCostMicroUsd + extraction.actualCostMicroUsd;
    if (ceilingMicroUsd < committedMicroUsd) return { kind: "below_committed", committedMicroUsd };
    return {
      kind: "updated",
      extraction: await tx.bookExtraction.update({
        where: { id: extractionId },
        data: { costCeilingMicroUsd: ceilingMicroUsd },
      }),
    };
  });
}

export function findOcrOperation(operationId: string): Promise<OcrOperation | null> {
  return prisma.ocrOperation.findUnique({ where: { id: operationId } });
}

// The intent is recorded before the provider is called: SUBMITTING with the pages marked as sent. Returns false when
// another caller already moved the operation on.
export function beginOcrSubmit(operation: OcrOperation, pageNumbers: readonly number[]): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.ocrOperation.updateMany({
      where: { id: operation.id, status: "PLANNED" },
      data: { status: "SUBMITTING", errorCode: null, errorMessage: null },
    });
    if (count === 0) return false;
    await tx.extractionPage.updateMany({
      where: { extractionId: operation.extractionId, pageNumber: { in: [...pageNumbers] }, status: "NEEDS_OCR" },
      data: { status: "OCR_SUBMITTED" },
    });
    return true;
  });
}

export async function markOcrSubmitted(operationId: string, operationRef: string): Promise<void> {
  await prisma.ocrOperation.updateMany({
    where: { id: operationId, status: { in: ["SUBMITTING", "UNKNOWN_OUTCOME"] } },
    data: { status: "SUBMITTED", operationRef, submittedAt: new Date(), errorCode: null, errorMessage: null },
  });
}

export async function markOcrUnknownOutcome(
  operationId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await prisma.ocrOperation.updateMany({
    where: { id: operationId, status: "SUBMITTING" },
    data: { status: "UNKNOWN_OUTCOME", errorCode, errorMessage },
  });
}

// Nothing reached the provider (or it was never found there): the operation can be submitted again, reservation intact.
export function revertOcrToPlanned(operation: OcrOperation, pageNumbers: readonly number[]): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await tx.ocrOperation.updateMany({
      where: { id: operation.id, status: { in: ["SUBMITTING", "UNKNOWN_OUTCOME"] } },
      data: { status: "PLANNED" },
    });
    await tx.extractionPage.updateMany({
      where: { extractionId: operation.extractionId, pageNumber: { in: [...pageNumbers] }, status: "OCR_SUBMITTED" },
      data: { status: "NEEDS_OCR" },
    });
  });
}

export async function markOcrPagesFailed(
  operation: OcrOperation,
  pageNumbers: readonly number[],
  errorCode: string,
): Promise<void> {
  await prisma.extractionPage.updateMany({
    where: { extractionId: operation.extractionId, pageNumber: { in: [...pageNumbers] }, status: "OCR_SUBMITTED" },
    data: { status: "FAILED", errorCode },
  });
}

export async function markOcrPagesReadyForRetry(
  operation: OcrOperation,
  pageNumbers: readonly number[],
): Promise<void> {
  await prisma.extractionPage.updateMany({
    where: { extractionId: operation.extractionId, pageNumber: { in: [...pageNumbers] }, status: "OCR_SUBMITTED" },
    data: { status: "NEEDS_OCR" },
  });
}

export async function markOcrPolled(operationId: string): Promise<void> {
  await prisma.ocrOperation.update({ where: { id: operationId }, data: { lastPolledAt: new Date() } });
}

export async function markOcrOutputStored(operationId: string): Promise<void> {
  await prisma.ocrOperation.update({ where: { id: operationId }, data: { outputStoredAt: new Date() } });
}

export async function markOcrCleaned(operationId: string): Promise<void> {
  await prisma.ocrOperation.update({ where: { id: operationId }, data: { cleanedAt: new Date() } });
}
