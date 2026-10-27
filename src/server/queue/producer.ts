import { Queue } from "bullmq";

import type { JobType } from "@/shared/types/job";

import { DEFAULT_JOB_OPTIONS, JOB_OPTIONS_BY_TYPE, QUEUE_NAME } from "./constants";
import { createProducerConnection } from "./redis-connection";

// Usable from Next.js, the worker and terminal scripts (no server-only guard).
export function createStudioQueue(): Queue {
  return new Queue(QUEUE_NAME, { connection: createProducerConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
}

export async function addStudioJob(
  queue: Queue,
  jobType: JobType,
  data: Record<string, unknown>,
  bullmqJobId: string,
): Promise<void> {
  await queue.add(jobType, data, { jobId: bullmqJobId, ...JOB_OPTIONS_BY_TYPE[jobType] });
}

// Removes a job that has not started yet; returns false when it is already running or gone.
export async function removeWaitingJob(queue: Queue, bullmqJobId: string): Promise<boolean> {
  const job = await queue.getJob(bullmqJobId);
  if (!job) return false;
  const state = await job.getState();
  if (state !== "waiting" && state !== "delayed" && state !== "prioritized") return false;
  await job.remove();
  return true;
}
