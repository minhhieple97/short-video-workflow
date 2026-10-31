import "server-only";

import type { JobType } from "@/shared/types/job";

import { addStudioJob, createStudioQueues, removeWaitingJob, type StudioQueues } from "./producer";
import { createProducerConnection } from "./redis-connection";

const globalForQueue = globalThis as unknown as { studioQueues?: StudioQueues };

function getStudioQueues(): StudioQueues {
  globalForQueue.studioQueues ??= createStudioQueues(createProducerConnection());
  return globalForQueue.studioQueues;
}

export function enqueueJob(jobType: JobType, data: Record<string, unknown>, bullmqJobId: string): Promise<void> {
  return addStudioJob(getStudioQueues(), jobType, data, bullmqJobId);
}

export function cancelWaitingJob(bullmqJobId: string): Promise<boolean> {
  return removeWaitingJob(getStudioQueues(), bullmqJobId);
}
