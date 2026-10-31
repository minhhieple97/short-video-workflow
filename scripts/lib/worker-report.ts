import { createStudioQueues } from "@/server/queue/producer";
import { createProducerConnection } from "@/server/queue/redis-connection";
import type { RunningWorkerStatus } from "@/server/queue/worker-lock";
import { resolveDataDir } from "@/server/storage/paths";

import { describeForeignWorker, describeWorkerStatus, type QueueCounts } from "./worker-status-text";

const QUEUE_COUNTS_TIMEOUT_MS = 3_000;

// Best effort: the status is still worth showing when the counts cannot be read in time.
async function readQueueCounts(): Promise<QueueCounts | null> {
  // BullMQ leaves a connection it was handed open, so this one is closed here, not through the queues.
  const connection = createProducerConnection();
  const queues = createStudioQueues(connection);
  for (const queue of Object.values(queues)) queue.on("error", () => undefined);
  // The totals over every lane: one line still says whether the worker has anything to do.
  const read = async (): Promise<QueueCounts | null> => {
    try {
      const counts = await Promise.all(
        Object.values(queues).map((queue) => queue.getJobCounts("active", "waiting", "delayed")),
      );
      return counts.reduce<QueueCounts>(
        (total, count) => ({
          active: total.active + (count.active ?? 0),
          waiting: total.waiting + (count.waiting ?? 0),
          delayed: total.delayed + (count.delayed ?? 0),
        }),
        { active: 0, waiting: 0, delayed: 0 },
      );
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
