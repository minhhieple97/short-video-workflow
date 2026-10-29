import "dotenv/config";

import { Queue, Worker } from "bullmq";

import { sweepRenderArchives } from "@/features/archive/services/archive-request.service";
import { reconcileExtractions } from "@/features/extraction/services/extraction-reconcile.service";
import { sweepDueJobIntents, type EnqueueJob } from "@/features/jobs/services/job-dispatch.service";
import { reconcileProductionItems } from "@/features/productions/services/production-reconcile.service";
import { configureDatabase, prisma } from "@/server/db/client";
import { QUEUE_NAME } from "@/server/queue/constants";
import { addJobToQueue } from "@/server/queue/producer";
import { createWorkerConnection, redactRedisUrl, withProbeConnection } from "@/server/queue/redis-connection";
import { acquireWorkerLock } from "@/server/queue/worker-lock";
import { ensureDataDirs } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { startArchiveSweeper } from "./lifecycle/archive-sweeper";
import { startDispatchSweeper } from "./lifecycle/dispatch-sweeper";
import { startHeartbeat } from "./lifecycle/heartbeat";
import { reconcileJobRecords } from "./lifecycle/reconcile";
import { registerShutdown } from "./lifecycle/shutdown";
import { processJob } from "./processors";

const logger = createLogger("worker");

async function main(): Promise<void> {
  const config = getAppConfig();
  const dataDir = ensureDataDirs();

  try {
    await withProbeConnection((connection) => connection.ping());
  } catch (error) {
    logger.error("Redis is unreachable; start it with `docker compose up -d` and retry", {
      redis: redactRedisUrl(config.redisUrl),
      error: toSafeErrorMessage(error),
    });
    process.exit(1);
  }

  const connection = createWorkerConnection();
  // Before anything that changes state: a second worker must not even reconcile or sweep.
  const attempt = await acquireWorkerLock(connection, dataDir);
  if (!attempt.acquired) {
    const { state, worker, heartbeatAgeMs } = attempt.holder;
    logger.error("A worker is already running; not starting another", { state, heartbeatAgeMs, ...worker });
    connection.disconnect();
    process.exit(1);
  }
  const { lock } = attempt;
  const stopHeartbeat = startHeartbeat(connection, lock, () => {
    logger.error("Another worker holds the lock now; shutting this one down");
    process.kill(process.pid, "SIGTERM");
  });
  await configureDatabase();

  const queue = new Queue(QUEUE_NAME, { connection });
  const enqueue: EnqueueJob = (jobType, data, bullmqJobId) => addJobToQueue(queue, jobType, data, bullmqJobId);
  // Deliver stranded outbox rows first so reconcile only judges jobs that really are (or should be) in Redis.
  await sweepDueJobIntents(enqueue);
  await reconcileJobRecords(queue);
  // After the records match Redis: an item whose job was lost gets a new one, delivered by the sweeper below.
  await reconcileProductionItems();
  await reconcileExtractions();
  await sweepRenderArchives();
  const worker = new Worker(QUEUE_NAME, processJob, { connection, concurrency: config.concurrency.worker });
  worker.on("error", (error) => logger.error("Worker error", { error: toSafeErrorMessage(error) }));

  const stopDispatchSweeper = startDispatchSweeper(enqueue);
  const stopArchiveSweeper = startArchiveSweeper();
  registerShutdown(async () => {
    stopHeartbeat();
    await stopDispatchSweeper();
    await stopArchiveSweeper();
    await worker.close();
    await lock.release();
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
  });

  logger.info("Worker started", { queue: QUEUE_NAME, concurrency: config.concurrency.worker, dataDir });
}

main().catch((error: unknown) => {
  logger.error("Worker failed to start", { error: toSafeErrorMessage(error) });
  process.exit(1);
});
