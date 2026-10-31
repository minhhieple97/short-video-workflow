import "dotenv/config";

import { Worker } from "bullmq";

import { sweepRenderArchives } from "@/features/archive/services/archive-request.service";
import { reconcileExtractions } from "@/features/extraction/services/extraction-reconcile.service";
import { sweepDueJobIntents, type EnqueueJob } from "@/features/jobs/services/job-dispatch.service";
import { reconcileProductionItems } from "@/features/productions/services/production-reconcile.service";
import { concurrencyForLane } from "@/features/settings/domain/concurrency-settings";
import { getConcurrencySettings } from "@/features/settings/services/concurrency-settings.service";
import { configureDatabase, prisma } from "@/server/db/client";
import { LANE_QUEUE_NAMES, mapLanes } from "@/server/queue/lanes";
import { addJobToQueue, closeStudioQueues, createStudioQueues } from "@/server/queue/producer";
import { createWorkerConnection, redactRedisUrl, withProbeConnection } from "@/server/queue/redis-connection";
import { acquireWorkerLock } from "@/server/queue/worker-lock";
import { ensureDataDirs } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { startArchiveSweeper } from "./lifecycle/archive-sweeper";
import { startBookImportSweeper } from "./lifecycle/book-import-sweeper";
import { startConcurrencyWatcher } from "./lifecycle/concurrency-watcher";
import { startDispatchSweeper } from "./lifecycle/dispatch-sweeper";
import { startHeartbeat } from "./lifecycle/heartbeat";
import { startNotificationSweeper } from "./lifecycle/notification-sweeper";
import { reconcileJobRecords } from "./lifecycle/reconcile";
import { registerShutdown } from "./lifecycle/shutdown";
import { createLaneProcessor } from "./processors";

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

  const queues = createStudioQueues(connection);
  const enqueue: EnqueueJob = (jobType, data, bullmqJobId) => addJobToQueue(queues, jobType, data, bullmqJobId);
  // Deliver stranded outbox rows first so reconcile only judges jobs that really are (or should be) in Redis.
  await sweepDueJobIntents(enqueue);
  await reconcileJobRecords(queues);
  // After the records match Redis: an item whose job was lost gets a new one, delivered by the sweeper below.
  await reconcileProductionItems();
  await reconcileExtractions();
  await sweepRenderArchives();
  const settings = await getConcurrencySettings();
  // One BullMQ worker per lane, each with its own number of tasks at once (Settings → Chạy song song).
  const workers = mapLanes((lane) => {
    const worker = new Worker(LANE_QUEUE_NAMES[lane], createLaneProcessor(lane, enqueue), {
      connection,
      concurrency: concurrencyForLane(settings, lane),
    });
    worker.on("error", (error) => logger.error("Worker error", { lane, error: toSafeErrorMessage(error) }));
    return worker;
  });

  const stopConcurrencyWatcher = startConcurrencyWatcher(workers);
  const stopDispatchSweeper = startDispatchSweeper(enqueue);
  const stopArchiveSweeper = startArchiveSweeper();
  const stopBookImportSweeper = startBookImportSweeper();
  const stopNotificationSweeper = startNotificationSweeper();
  registerShutdown(async () => {
    stopHeartbeat();
    await stopConcurrencyWatcher();
    await stopDispatchSweeper();
    await stopArchiveSweeper();
    await stopBookImportSweeper();
    await stopNotificationSweeper();
    await Promise.all(Object.values(workers).map((worker) => worker.close()));
    await lock.release();
    await closeStudioQueues(queues);
    await connection.quit();
    await prisma.$disconnect();
  });

  logger.info("Worker started", {
    lanes: Object.fromEntries(Object.entries(workers).map(([lane, worker]) => [lane, worker.concurrency])),
    dataDir,
  });
}

main().catch((error: unknown) => {
  logger.error("Worker failed to start", { error: toSafeErrorMessage(error) });
  process.exit(1);
});
