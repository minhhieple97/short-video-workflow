import "server-only";

import { randomUUID } from "node:crypto";

import { enqueueJob } from "@/server/queue/queue";
import { AppError, NotFoundError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";

import { findActiveJobForEntity, findJobRecordById } from "../repositories/job-record.repository";
import type { DiagnosticKind } from "../schemas/job-payload.schema";
import { dispatchJobIntent, failJobIntent, recordJobIntent, type TrackedJobRequest } from "./job-dispatch.service";
import { toJobDto } from "./job-dto";

// Stores the job and its outbox row first, then enqueues IDs only. If this process dies in between, the worker's
// sweep delivers the row. An identical job still in flight is reused.
export async function enqueueTrackedJob(request: TrackedJobRequest): Promise<{ job: JobDto; reused: boolean }> {
  const active = await findActiveJobForEntity(request.jobType, request.entityType, request.entityId);
  if (active) return { job: toJobDto(active), reused: true };

  const intent = await recordJobIntent(request);
  const record = intent.jobRecord;

  try {
    await dispatchJobIntent(intent, enqueueJob);
  } catch (error) {
    await failJobIntent(intent, "QUEUE_UNAVAILABLE", "Không thể đưa tác vụ vào hàng đợi Redis.");
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

export async function enqueueDiagnosticPingJob(kind: DiagnosticKind = "ping"): Promise<JobDto> {
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
