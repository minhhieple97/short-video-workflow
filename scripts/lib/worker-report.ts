import { Queue } from "bullmq";

import { QUEUE_NAME } from "@/server/queue/constants";
import { createProducerConnection } from "@/server/queue/redis-connection";
import type { RunningWorkerStatus } from "@/server/queue/worker-lock";
import { resolveDataDir } from "@/server/storage/paths";

import { describeForeignWorker, describeWorkerStatus, type QueueCounts } from "./worker-status-text";

const QUEUE_COUNTS_TIMEOUT_MS = 3_000;

// Best effort: the status is still worth showing when the counts cannot be read in time.
async function readQueueCounts(): Promise<QueueCounts | null> {
  // BullMQ leaves a connection it was handed open, so this one is closed here, not through the queue.
  const connection = createProducerConnection();
  const queue = new Queue(QUEUE_NAME, { connection });
  queue.on("error", () => undefined);
  const read = async (): Promise<QueueCounts | null> => {
    try {
      const counts = await queue.getJobCounts("active", "waiting", "delayed");
      return { active: counts.active ?? 0, waiting: counts.waiting ?? 0, delayed: counts.delayed ?? 0 };
    } catch {
      return null;
    }
  };
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), QUEUE_COUNTS_TIMEOUT_MS).unref());
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    connection.disconnect();
  }
}

export async function reportRunningWorker(status: RunningWorkerStatus): Promise<string[]> {
  const lines = describeWorkerStatus(status, await readQueueCounts());
  const foreign = describeForeignWorker(status, resolveDataDir());
  return foreign === null ? lines : [...lines, foreign];
}
