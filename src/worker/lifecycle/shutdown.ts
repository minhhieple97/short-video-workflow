import { createLogger, toSafeErrorMessage } from "@/shared/logger";

const logger = createLogger("worker.shutdown");

export function registerShutdown(cleanup: () => Promise<void>): void {
  let shuttingDown = false;

  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
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
