import "server-only";

import { randomUUID } from "node:crypto";

import { enqueueJob } from "@/server/queue/queue";
import { AppError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";

import { createJobRecord, findJobRecordById, markJobFailed } from "../repositories/job-record.repository";
import { toJobDto } from "./job-dto";

export async function enqueueDiagnosticPingJob(): Promise<JobDto> {
  const record = await createJobRecord({
    bullmqJobId: randomUUID(),
    jobType: "DIAGNOSTIC_PING",
    entityType: "SYSTEM",
    entityId: "diagnostic",
  });

  try {
    await enqueueJob("DIAGNOSTIC_PING", { jobRecordId: record.id, message: "ping" }, record.bullmqJobId);
  } catch (error) {
    await markJobFailed(record.id, "QUEUE_UNAVAILABLE", "Không thể đưa tác vụ vào hàng đợi Redis.");
    throw new AppError(
      "QUEUE_UNAVAILABLE",
      "Không thể kết nối Redis. Hãy chạy `docker compose up -d` rồi thử lại.",
      503,
      { cause: error },
    );
  }

  return toJobDto(record);
}

export async function getJob(id: string): Promise<JobDto> {
  const record = await findJobRecordById(id);
  if (!record) {
    throw new AppError("JOB_NOT_FOUND", "Không tìm thấy tác vụ.", 404);
  }
  return toJobDto(record);
}
