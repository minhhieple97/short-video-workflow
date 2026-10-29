import type { Redis } from "ioredis";

import { WORKER_HEARTBEAT_INTERVAL_MS, WORKER_HEARTBEAT_KEY, WORKER_LIVENESS_TTL_MS } from "@/server/queue/constants";
import type { WorkerLock } from "@/server/queue/worker-lock";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

const logger = createLogger("worker.heartbeat");

// Each beat also keeps the worker's lock alive. `onLockLost` runs once, when another worker holds the lock now; the
// beats stop then, so this worker no longer speaks for a role it lost.
export function startHeartbeat(connection: Redis, lock: WorkerLock, onLockLost: () => void): () => void {
  // While Redis is away a beat never settles; skipping the next ones keeps its commands from piling up.
  let beating = false;
  let lost = false;

  const beat = async (): Promise<void> => {
    if (beating || lost) return;
    beating = true;
    try {
      await connection.set(WORKER_HEARTBEAT_KEY, String(Date.now()), "PX", WORKER_LIVENESS_TTL_MS);
      const renewal = await lock.renew();
      if (renewal === "reacquired") logger.warn("Worker lock had lapsed and was taken back");
      if (renewal === "lost") {
        lost = true;
        onLockLost();
      }
    } catch (error) {
      logger.warn("Heartbeat failed", { error: toSafeErrorMessage(error) });
    } finally {
      beating = false;
    }
  };

  void beat();
  const timer = setInterval(() => void beat(), WORKER_HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}
