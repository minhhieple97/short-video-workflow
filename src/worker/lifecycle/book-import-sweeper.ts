import { sweepBookImports } from "@/features/book-imports/services/book-import-run.service";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

const logger = createLogger("worker.book-imports");

export function startBookImportSweeper(): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    inFlight ??= sweepBookImports()
      .catch((error: unknown) => {
        logger.error("Book import sweep failed", { error: toSafeErrorMessage(error) });
      })
      .finally(() => {
        inFlight = null;
      });
  }, 10_000);
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}
