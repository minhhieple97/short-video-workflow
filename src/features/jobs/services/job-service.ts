import "server-only";

import { randomUUID } from "node:crypto";

import { enqueueJob } from "@/server/queue/queue";
import { AppError, NotFoundError } from "@/shared/errors";
import type { JobDto, JobType } from "@/shared/types/job";

import {
  createJobRecord,
  findActiveJobForEntity,
  findJobRecordById,
  markJobFailed,
} from "../repositories/job-record.repository";
import { toJobDto } from "./job-dto";

interface TrackedJobRequest {
  jobType: JobType;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  requestFingerprint?: string;
}

// Creates the JobRecord read model first, then enqueues IDs only. An identical job still in flight is reused.
export async function enqueueTrackedJob(request: TrackedJobRequest): Promise<{ job: JobDto; reused: boolean }> {
  const active = await findActiveJobForEntity(request.jobType, request.entityType, request.entityId);
  if (active) return { job: toJobDto(active), reused: true };

  const record = await createJobRecord({
    bullmqJobId: randomUUID(),
    jobType: request.jobType,
    entityType: request.entityType,
    entityId: request.entityId,
    requestFingerprint: request.requestFingerprint,
  });

  try {
    await enqueueJob(request.jobType, { ...request.payload, jobRecordId: record.id }, record.bullmqJobId);
  } catch (error) {
    await markJobFailed(record.id, "QUEUE_UNAVAILABLE", "Không thể đưa tác vụ vào hàng đợi Redis.");
    if (error instanceof AppError) throw error;
    throw new AppError(
      "QUEUE_UNAVAILABLE",
      "Không thể kết nối Redis. Hãy chạy `docker compose up -d` rồi thử lại.",
      503,
      {
        cause: error,
      },
    );
  }
  return { job: toJobDto(record), reused: false };
}

export async function enqueueDiagnosticPingJob(kind: "ping" | "mock-ai" = "ping"): Promise<JobDto> {
  const { job } = await enqueueTrackedJob({
    jobType: "DIAGNOSTIC_PING",
    entityType: "SYSTEM",
    entityId: randomUUID(),
    payload: { message: "ping", kind },
  });
  return job;
}

export async function getJob(id: string): Promise<JobDto> {
  const record = await findJobRecordById(id);
  if (!record) throw new NotFoundError("JOB_NOT_FOUND", "Không tìm thấy tác vụ.");
  return toJobDto(record);
}
