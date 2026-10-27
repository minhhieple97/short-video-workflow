import type { JobRecord } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type { JobType } from "@/shared/types/job";

interface CreateJobRecordInput {
  bullmqJobId: string;
  jobType: JobType;
  entityType: string;
  entityId: string;
  requestFingerprint?: string;
}

export function createJobRecord(input: CreateJobRecordInput): Promise<JobRecord> {
  return prisma.jobRecord.create({ data: input });
}

const ACTIVE_JOB_STATUSES = ["QUEUED", "WAITING_FOR_CLI", "RUNNING"] as const;

export function findActiveJobForEntity(
  jobType: JobType,
  entityType: string,
  entityId: string,
): Promise<JobRecord | null> {
  return prisma.jobRecord.findFirst({
    where: { jobType, entityType, entityId, status: { in: [...ACTIVE_JOB_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
}

export function findJobRecordById(id: string): Promise<JobRecord | null> {
  return prisma.jobRecord.findUnique({ where: { id } });
}

export function markJobRunning(id: string): Promise<JobRecord> {
  return prisma.jobRecord.update({
    where: { id },
    data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 }, errorCode: null, errorMessage: null },
  });
}

export function setJobProgress(id: string, progress: number): Promise<JobRecord> {
  return prisma.jobRecord.update({ where: { id }, data: { progress } });
}

export function markJobCompleted(id: string): Promise<JobRecord> {
  return prisma.jobRecord.update({
    where: { id },
    data: { status: "COMPLETED", progress: 100, completedAt: new Date() },
  });
}

export function markJobFailed(id: string, errorCode: string, errorMessage: string): Promise<JobRecord> {
  return prisma.jobRecord.update({
    where: { id },
    data: { status: "FAILED", errorCode, errorMessage, completedAt: new Date() },
  });
}
