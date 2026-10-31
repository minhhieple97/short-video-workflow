import { randomUUID } from "node:crypto";

import type { JobDispatch, JobRecord, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type { JobType } from "@/shared/types/job";

export type JobIntent = JobDispatch & { jobRecord: JobRecord };

interface CreateJobIntentInput {
  bullmqJobId: string;
  jobType: JobType;
  entityType: string;
  entityId: string;
  requestFingerprint?: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
}

// One nested write: the JobRecord and its outbox row exist together or not at all.
// Puts a RUNNING job back in the outbox under a fresh BullMQ job id (the finished one would swallow a duplicate add).
// Returns false, changing nothing, when the job is no longer RUNNING (for example a cancel was requested meanwhile).
export function rescheduleRunningJob(
  jobRecordId: string,
  payload: Record<string, unknown>,
  availableAt: Date,
): Promise<boolean> {
  const payloadJson = JSON.stringify(payload);
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.jobRecord.updateMany({
      where: { id: jobRecordId, status: "RUNNING" },
      data: { status: "QUEUED", bullmqJobId: randomUUID() },
    });
    if (count === 0) return false;

    await tx.jobDispatch.upsert({
      where: { jobRecordId },
      create: { jobRecordId, payloadJson, availableAt },
      update: { payloadJson, availableAt, dispatchedAt: null, attempts: 0, lastError: null },
    });
    return true;
  });
}

// Sends a waiting or running job to another lane: it goes back to the outbox under a fresh BullMQ job id, due now. Returns
// the row to deliver, or null, changing nothing, when the job is neither (for example it was cancelled meanwhile). A job
// that was running has counted that run as an attempt; moving it on is not a try that failed, so the count goes back.
export function reassignJobIntent(jobRecordId: string, payload: Record<string, unknown>): Promise<JobIntent | null> {
  const payloadJson = JSON.stringify(payload);
  return prisma.$transaction(async (tx) => {
    const running = await tx.jobRecord.updateMany({
      where: { id: jobRecordId, status: "RUNNING", attempts: { gt: 0 } },
      data: { status: "QUEUED", bullmqJobId: randomUUID(), attempts: { decrement: 1 } },
    });
    if (running.count === 0) {
      const waiting = await tx.jobRecord.updateMany({
        where: { id: jobRecordId, status: "QUEUED" },
        data: { bullmqJobId: randomUUID() },
      });
      if (waiting.count === 0) return null;
    }

    return tx.jobDispatch.upsert({
      where: { jobRecordId },
      create: { jobRecordId, payloadJson },
      update: { payloadJson, availableAt: new Date(), dispatchedAt: null, attempts: 0, lastError: null },
      include: { jobRecord: true },
    });
  });
}

export function createJobIntent(input: CreateJobIntentInput): Promise<JobIntent> {
  return createJobIntentWithin(prisma, input);
}

// Lets a caller start a job in the same transaction as the change that makes the job necessary.
export function createJobIntentWithin(tx: Prisma.TransactionClient, input: CreateJobIntentInput): Promise<JobIntent> {
  const { payload, availableAt, ...record } = input;
  return tx.jobDispatch.create({
    data: { payloadJson: JSON.stringify(payload), availableAt, jobRecord: { create: record } },
    include: { jobRecord: true },
  });
}

export function listDueJobIntents(now: Date, limit: number): Promise<JobIntent[]> {
  return prisma.jobDispatch.findMany({
    where: { dispatchedAt: null, availableAt: { lte: now } },
    orderBy: { availableAt: "asc" },
    take: limit,
    include: { jobRecord: true },
  });
}

export async function listUndeliveredJobRecordIds(): Promise<Set<string>> {
  const rows = await prisma.jobDispatch.findMany({ where: { dispatchedAt: null }, select: { jobRecordId: true } });
  return new Set(rows.map((row) => row.jobRecordId));
}

export async function markIntentDispatched(id: string, bullmqJobId: string): Promise<boolean> {
  const { count } = await prisma.jobDispatch.updateMany({
    where: { id, dispatchedAt: null, jobRecord: { bullmqJobId } },
    data: { dispatchedAt: new Date() },
  });
  return count > 0;
}

export function recordIntentFailure(id: string, message: string): Promise<JobDispatch> {
  return prisma.jobDispatch.update({ where: { id }, data: { attempts: { increment: 1 }, lastError: message } });
}

export async function deleteIntent(id: string): Promise<void> {
  await prisma.jobDispatch.deleteMany({ where: { id } });
}

// True when the job had not reached Redis yet, so cancelling it needs no queue call.
export async function deleteUndeliveredIntent(jobRecordId: string): Promise<boolean> {
  const { count } = await prisma.jobDispatch.deleteMany({ where: { jobRecordId, dispatchedAt: null } });
  return count > 0;
}
