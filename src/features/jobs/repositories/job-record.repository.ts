import type { JobRecord } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { ACTIVE_JOB_STATUSES, type JobType } from "@/shared/types/job";

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

export function listJobRecords(limit: number): Promise<JobRecord[]> {
  return prisma.jobRecord.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export function listActiveJobRecords(): Promise<JobRecord[]> {
  return prisma.jobRecord.findMany({
    where: { status: { in: [...ACTIVE_JOB_STATUSES] } },
    orderBy: { createdAt: "asc" },
  });
}

export function listJobsWaitingForCli(): Promise<JobRecord[]> {
  return prisma.jobRecord.findMany({ where: { status: "WAITING_FOR_CLI" }, orderBy: { createdAt: "asc" } });
}

export function listUnsettledJobRecords(): Promise<JobRecord[]> {
  return prisma.jobRecord.findMany({ where: { status: { in: ["QUEUED", "RUNNING", "CANCEL_REQUESTED"] } } });
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

export function markJobWaitingForCli(id: string): Promise<JobRecord> {
  return prisma.jobRecord.update({ where: { id }, data: { status: "WAITING_FOR_CLI" } });
}

export function markJobRetrying(id: string, errorCode: string, errorMessage: string): Promise<JobRecord> {
  return prisma.jobRecord.update({
    where: { id },
    data: { status: "QUEUED", errorCode, errorMessage: `Sẽ thử lại: ${errorMessage}` },
  });
}

export function markJobFailed(id: string, errorCode: string, errorMessage: string): Promise<JobRecord> {
  return prisma.jobRecord.update({
    where: { id },
    data: { status: "FAILED", errorCode, errorMessage, completedAt: new Date() },
  });
}

export function markJobCancelRequested(id: string): Promise<JobRecord> {
  return prisma.jobRecord.update({ where: { id }, data: { status: "CANCEL_REQUESTED" } });
}

export function markJobCancelled(id: string): Promise<JobRecord> {
  return prisma.jobRecord.update({
    where: { id },
    data: {
      status: "CANCELLED",
      errorCode: "JOB_CANCELLED",
      errorMessage: "Đã huỷ theo yêu cầu.",
      completedAt: new Date(),
    },
  });
}

export function requeueJobRecord(id: string, bullmqJobId: string): Promise<JobRecord> {
  return prisma.jobRecord.update({
    where: { id },
    data: { status: "QUEUED", bullmqJobId, progress: 0, errorCode: null, errorMessage: null },
  });
}
