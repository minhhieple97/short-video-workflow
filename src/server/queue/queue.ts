import "server-only";

import { Queue } from "bullmq";

import type { JobType } from "@/shared/types/job";

import { DEFAULT_JOB_OPTIONS, QUEUE_NAME } from "./constants";
import { createProducerConnection } from "./redis-connection";

const globalForQueue = globalThis as unknown as { studioQueue?: Queue };

function getStudioQueue(): Queue {
  globalForQueue.studioQueue ??= new Queue(QUEUE_NAME, {
    connection: createProducerConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return globalForQueue.studioQueue;
}

export async function enqueueJob(jobType: JobType, data: Record<string, unknown>, jobId: string): Promise<void> {
  await getStudioQueue().add(jobType, data, { jobId });
}
