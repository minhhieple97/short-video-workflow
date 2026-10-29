import type { JobsOptions } from "bullmq";

import type { JobType } from "@/shared/types/job";

export const QUEUE_NAME = "studio-jobs";
export const WORKER_HEARTBEAT_KEY = "studio:worker:heartbeat";
export const WORKER_LOCK_KEY = "studio:worker:lock";
export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;
export const WORKER_HEARTBEAT_STALE_AFTER_MS = 15_000;
// How long the heartbeat and the lock outlive their last refresh: a few missed beats must not cost the worker its place.
export const WORKER_LIVENESS_TTL_MS = WORKER_HEARTBEAT_INTERVAL_MS * 6;

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
  GENERATE_PUBLISH_METADATA: {},
  GENERATE_SCENE_TTS: { attempts: 2, backoff: { type: "exponential", delay: 5_000 } },
  RENDER_VIDEO: {},
  // A production item resumes from its checkpoint by itself, and waits through deferral rather than BullMQ retries.
  RUN_PRODUCTION_ITEM: {},
  // An archive resumes from its stored checkpoints and waits out quota or outages through deferral, not BullMQ retries.
  ARCHIVE_RENDER: {},
  // An extraction resumes from its stored pages and OCR operations, and waits for a remote batch through deferral.
  EXTRACT_PDF: {},
};
