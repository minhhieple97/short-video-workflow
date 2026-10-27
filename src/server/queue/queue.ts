import "server-only";

import type { Queue } from "bullmq";

import type { JobType } from "@/shared/types/job";

import { addStudioJob, createStudioQueue, removeWaitingJob } from "./producer";

const globalForQueue = globalThis as unknown as { studioQueue?: Queue };

function getStudioQueue(): Queue {
  globalForQueue.studioQueue ??= createStudioQueue();
  return globalForQueue.studioQueue;
}

export function enqueueJob(jobType: JobType, data: Record<string, unknown>, bullmqJobId: string): Promise<void> {
  return addStudioJob(getStudioQueue(), jobType, data, bullmqJobId);
}

export function cancelWaitingJob(bullmqJobId: string): Promise<boolean> {
  return removeWaitingJob(getStudioQueue(), bullmqJobId);
}
