import { Queue } from "bullmq";

import { AppError } from "@/shared/errors";
import type { JobType } from "@/shared/types/job";

import { DEFAULT_JOB_OPTIONS, JOB_OPTIONS_BY_TYPE, QUEUE_NAME } from "./constants";
import { createProducerConnection, withProbeConnection } from "./redis-connection";

// Usable from Next.js, the worker and terminal scripts (no server-only guard).
export function createStudioQueue(): Queue {
  return new Queue(QUEUE_NAME, { connection: createProducerConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
}

// A Queue created while Redis is down waits forever for "ready"; probing first turns that into a fast, clear error.
async function assertRedisReachable(): Promise<void> {
  try {
    await withProbeConnection((connection) => connection.ping());
  } catch (error) {
    throw new AppError(
      "QUEUE_UNAVAILABLE",
      "Không thể kết nối Redis. Hãy chạy `docker compose up -d` rồi thử lại.",
      503,
      {
        cause: error,
      },
    );
  }
}

// BullMQ ignores an add whose jobId already exists, which is what makes redelivering an outbox row safe.
export async function addJobToQueue(
  queue: Queue,
  jobType: JobType,
  data: Record<string, unknown>,
  bullmqJobId: string,
): Promise<void> {
  await queue.add(jobType, data, { jobId: bullmqJobId, ...JOB_OPTIONS_BY_TYPE[jobType] });
}

export async function addStudioJob(
  queue: Queue,
  jobType: JobType,
  data: Record<string, unknown>,
  bullmqJobId: string,
): Promise<void> {
  await assertRedisReachable();
  await addJobToQueue(queue, jobType, data, bullmqJobId);
}

// Removes a job that has not started yet; returns false when it is already running or gone.
export async function removeWaitingJob(queue: Queue, bullmqJobId: string): Promise<boolean> {
  await assertRedisReachable();
  const job = await queue.getJob(bullmqJobId);
  if (!job) return false;
  const state = await job.getState();
  if (state !== "waiting" && state !== "delayed" && state !== "prioritized") return false;
  await job.remove();
  return true;
}
