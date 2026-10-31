import { Queue } from "bullmq";
import type { Redis } from "ioredis";

import { AppError } from "@/shared/errors";
import type { JobType } from "@/shared/types/job";
import type { WorkLane } from "@/shared/types/work-lane";

import { DEFAULT_JOB_OPTIONS, JOB_OPTIONS_BY_TYPE } from "./constants";
import { LANE_QUEUE_NAMES, laneForJob, mapLanes } from "./lanes";
import { withProbeConnection } from "./redis-connection";

export type StudioQueues = Record<WorkLane, Queue>;

// Usable from Next.js, the worker and terminal scripts (no server-only guard). The queues share the connection they are
// given, and BullMQ leaves a connection it was handed open: whoever passed it closes it.
export function createStudioQueues(connection: Redis): StudioQueues {
  return mapLanes((lane) => new Queue(LANE_QUEUE_NAMES[lane], { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }));
}

export async function closeStudioQueues(queues: StudioQueues): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
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
  queues: StudioQueues,
  jobType: JobType,
  data: Record<string, unknown>,
  bullmqJobId: string,
): Promise<void> {
  await queues[laneForJob(jobType, data)].add(jobType, data, { jobId: bullmqJobId, ...JOB_OPTIONS_BY_TYPE[jobType] });
}

export async function addStudioJob(
  queues: StudioQueues,
  jobType: JobType,
  data: Record<string, unknown>,
  bullmqJobId: string,
): Promise<void> {
  await assertRedisReachable();
  await addJobToQueue(queues, jobType, data, bullmqJobId);
}

// Removes a job that has not started yet; returns false when it is already running or gone. A job record does not say
// which lane its job went to, so every queue is asked.
export async function removeWaitingJob(queues: StudioQueues, bullmqJobId: string): Promise<boolean> {
  await assertRedisReachable();
  for (const queue of Object.values(queues)) {
    const job = await queue.getJob(bullmqJobId);
    if (!job) continue;
    const state = await job.getState();
    if (state !== "waiting" && state !== "delayed" && state !== "prioritized") return false;
    await job.remove();
    return true;
  }
  return false;
}
