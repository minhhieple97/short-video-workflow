import { sweepDueJobIntents, type EnqueueJob } from "@/features/jobs/services/job-dispatch.service";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

const logger = createLogger("worker.dispatch-sweeper");
const SWEEP_INTERVAL_MS = 5_000;

// Delivers outbox rows that never reached Redis (the web process died between the two writes) and releases
// delayed jobs when they come due. A sweep still running when the next tick fires makes that tick a no-op.
export function startDispatchSweeper(enqueue: EnqueueJob): () => Promise<void> {
  let inFlight: Promise<void> | null = null;

  const sweep = async (): Promise<void> => {
    try {
      const delivered = await sweepDueJobIntents(enqueue);
      if (delivered > 0) logger.info("Delivered outbox jobs", { delivered });
    } catch (error) {
      logger.warn("Outbox sweep failed", { error: toSafeErrorMessage(error) });
    }
  };

  const timer = setInterval(() => {
    inFlight ??= sweep().finally(() => {
      inFlight = null;
    });
  }, SWEEP_INTERVAL_MS);

  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}
