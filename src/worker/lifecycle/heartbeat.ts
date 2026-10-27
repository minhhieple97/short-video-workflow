import type { Redis } from "ioredis";

import { WORKER_HEARTBEAT_INTERVAL_MS, WORKER_HEARTBEAT_KEY } from "@/server/queue/constants";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

const logger = createLogger("worker.heartbeat");
const HEARTBEAT_TTL_MS = WORKER_HEARTBEAT_INTERVAL_MS * 6;

export function startHeartbeat(connection: Redis): () => void {
  const beat = (): void => {
    connection
      .set(WORKER_HEARTBEAT_KEY, String(Date.now()), "PX", HEARTBEAT_TTL_MS)
      .catch((error: unknown) => logger.warn("Heartbeat write failed", { error: toSafeErrorMessage(error) }));
  };

  beat();
  const timer = setInterval(beat, WORKER_HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}
