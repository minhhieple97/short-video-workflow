import { sweepRenderArchives } from "@/features/archive/services/archive-request.service";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

const logger = createLogger("worker.archive-sweeper");
const SWEEP_INTERVAL_MS = 60_000;

// Picks up renders to archive once Drive is connected, and archives whose job was lost. A sweep still running when the
// next tick fires makes that tick a no-op.
export function startArchiveSweeper(): () => Promise<void> {
  let inFlight: Promise<void> | null = null;

  const sweep = async (): Promise<void> => {
    try {
      await sweepRenderArchives();
    } catch (error) {
      logger.warn("Archive sweep failed", { error: toSafeErrorMessage(error) });
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
