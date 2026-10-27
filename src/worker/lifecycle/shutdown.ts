import { createLogger, toSafeErrorMessage } from "@/shared/logger";

const logger = createLogger("worker.shutdown");

// A running render can take minutes; after this grace period the worker exits anyway. BullMQ treats the job as
// stalled and the next worker start reconciles it, so nothing is silently lost.
const SHUTDOWN_GRACE_MS = 15_000;

export function registerShutdown(cleanup: () => Promise<void>): void {
  let shuttingDown = false;

  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      logger.warn("Second signal received, exiting now", { signal });
      process.exit(1);
    }
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    setTimeout(() => {
      logger.error("Shutdown timed out, exiting", { graceMs: SHUTDOWN_GRACE_MS });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
    cleanup().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error("Shutdown failed", { error: toSafeErrorMessage(error) });
        process.exit(1);
      },
    );
  };

  process.on("SIGINT", handle);
  process.on("SIGTERM", handle);
}
