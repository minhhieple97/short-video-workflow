import { randomUUID } from "node:crypto";

import { createJobIntentWithin } from "@/features/jobs/repositories/job-dispatch.repository";
import type { JobRecord, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { ACTIVE_JOB_STATUSES } from "@/shared/types/job";

import { RUNNABLE_EXTRACTION_STATUSES } from "../domain/extraction-status";

type Tx = Prisma.TransactionClient;

export const EXTRACTION_ENTITY = "EXTRACTION";

// Every change that makes an extraction runnable starts its job in the same transaction; the outbox delivers it.
export async function startExtractionJobWithin(tx: Tx, extractionId: string): Promise<JobRecord> {
  const intent = await createJobIntentWithin(tx, {
    bullmqJobId: randomUUID(),
    jobType: "EXTRACT_PDF",
    entityType: EXTRACTION_ENTITY,
    entityId: extractionId,
    payload: { extractionId },
  });
  return intent.jobRecord;
}

export function findActiveExtractionJob(extractionId: string, tx: Tx = prisma): Promise<JobRecord | null> {
  return tx.jobRecord.findFirst({
    where: {
      jobType: "EXTRACT_PDF",
      entityType: EXTRACTION_ENTITY,
      entityId: extractionId,
      status: { in: [...ACTIVE_JOB_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
  });
}

// Gives a runnable extraction a job when it has none (its job was lost with the worker). The first statement writes the
// extraction, which takes SQLite's write lock, so two callers cannot both find no job and start one each.
export function ensureExtractionJob(extractionId: string): Promise<{ job: JobRecord; started: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.bookExtraction.updateMany({
      where: { id: extractionId, status: { in: [...RUNNABLE_EXTRACTION_STATUSES] } },
      data: { updatedAt: new Date() },
    });
    if (count === 0) return null;
    const active = await findActiveExtractionJob(extractionId, tx);
    if (active) return { job: active, started: false };
    return { job: await startExtractionJobWithin(tx, extractionId), started: true };
  });
}

export async function listRunnableExtractionIds(): Promise<string[]> {
  const rows = await prisma.bookExtraction.findMany({
    where: { status: { in: [...RUNNABLE_EXTRACTION_STATUSES] }, book: { deletedAt: null } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => row.id);
}

export type ExtractionRetryResult =
  | { kind: "started"; job: JobRecord }
  | { kind: "running"; job: JobRecord }
  | { kind: "not_retryable"; status: string }
  | { kind: "missing" };

// A user retry: a stopped run picks up where its data says it stands (pages already read are never read or paid for
// again), OCR pages that failed go back to the queue, and the reason the run stopped is cleared. The new job is
// recorded in the same transaction.
export function resetExtractionForRetry(extractionId: string): Promise<ExtractionRetryResult> {
  return prisma.$transaction(async (tx): Promise<ExtractionRetryResult> => {
    const extraction = await tx.bookExtraction.findUnique({
      where: { id: extractionId },
      select: { status: true, pageCount: true, _count: { select: { pages: true } } },
    });
    if (!extraction) return { kind: "missing" };
    const active = await findActiveExtractionJob(extractionId, tx);
    if (active) return { kind: "running", job: active };

    const resumeAt = resumeStatus(extraction.status, extraction._count.pages > 0);
    if (!resumeAt) return { kind: "not_retryable", status: extraction.status };

    await tx.bookExtraction.update({
      where: { id: extractionId },
      data: { status: resumeAt, errorCode: null, errorMessage: null, transientFailures: 0, completedAt: null },
    });
    await tx.extractionPage.updateMany({
      where: { extractionId, status: "FAILED", ocrReason: { not: null } },
      data: { status: "NEEDS_OCR", errorCode: null },
    });
    return { kind: "started", job: await startExtractionJobWithin(tx, extractionId) };
  });
}

function resumeStatus(status: string, hasPages: boolean): string | null {
  switch (status) {
    case "FAILED":
    case "CANCELLED":
      return hasPages ? "OCR_PENDING" : "QUEUED";
    case "PARTIAL":
    case "OCR_PENDING":
      return "OCR_PENDING";
    case "QUEUED":
    case "INSPECTING":
    case "EXTRACTING":
    case "ASSEMBLING":
      return status;
    default:
      return null;
  }
}

// A cancel stops the run where it is; an OCR batch already at the provider keeps its reservation and is collected on retry.
export async function cancelExtraction(extractionId: string): Promise<void> {
  await prisma.bookExtraction.updateMany({
    where: { id: extractionId, status: { in: [...RUNNABLE_EXTRACTION_STATUSES] } },
    data: { status: "CANCELLED", errorCode: "EXTRACTION_CANCELLED", errorMessage: "Đã huỷ theo yêu cầu." },
  });
}
