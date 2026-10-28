import type { JobDispatch, JobRecord } from "@/generated/prisma/client";
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
export function createJobIntent(input: CreateJobIntentInput): Promise<JobIntent> {
  const { payload, availableAt, ...record } = input;
  return prisma.jobDispatch.create({
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

export async function markIntentDispatched(id: string): Promise<boolean> {
  const { count } = await prisma.jobDispatch.updateMany({
    where: { id, dispatchedAt: null },
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
