import type { JobsOptions } from "bullmq";

import type { JobType } from "@/shared/types/job";

export const QUEUE_NAME = "studio-jobs";
export const WORKER_HEARTBEAT_KEY = "studio:worker:heartbeat";
export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;
export const WORKER_HEARTBEAT_STALE_AFTER_MS = 15_000;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

// AI jobs never auto-retry (quota-aware); TTS retries once with backoff; renders are not retried to avoid wasted CPU.
export const JOB_OPTIONS_BY_TYPE: Record<JobType, JobsOptions> = {
  DIAGNOSTIC_PING: {},
  ANALYZE_CHAPTER: {},
  GENERATE_VIDEO_SCRIPT: {},
  GENERATE_SCENE_TTS: { attempts: 2, backoff: { type: "exponential", delay: 5_000 } },
  RENDER_VIDEO: {},
  // A production item resumes from its checkpoint by itself, and waits through deferral rather than BullMQ retries.
  RUN_PRODUCTION_ITEM: {},
};
