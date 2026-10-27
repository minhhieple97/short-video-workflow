import type { JobsOptions } from "bullmq";

export const QUEUE_NAME = "studio-jobs";
export const WORKER_HEARTBEAT_KEY = "studio:worker:heartbeat";
export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;
export const WORKER_HEARTBEAT_STALE_AFTER_MS = 15_000;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
