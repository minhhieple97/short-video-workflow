import "dotenv/config";

import { Worker } from "bullmq";

import { configureDatabase, prisma } from "@/server/db/client";
import { QUEUE_NAME } from "@/server/queue/constants";
import { createWorkerConnection, redactRedisUrl, withProbeConnection } from "@/server/queue/redis-connection";
import { ensureDataDirs } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { startHeartbeat } from "./lifecycle/heartbeat";
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
  await configureDatabase();

  const connection = createWorkerConnection();
  const worker = new Worker(QUEUE_NAME, processJob, { connection, concurrency: config.concurrency.worker });
  worker.on("error", (error) => logger.error("Worker error", { error: toSafeErrorMessage(error) }));

  const stopHeartbeat = startHeartbeat(connection);
  registerShutdown(async () => {
    stopHeartbeat();
    await worker.close();
    await connection.quit();
    await prisma.$disconnect();
  });

  logger.info("Worker started", { queue: QUEUE_NAME, concurrency: config.concurrency.worker, dataDir });
}

main().catch((error: unknown) => {
  logger.error("Worker failed to start", { error: toSafeErrorMessage(error) });
  process.exit(1);
});
