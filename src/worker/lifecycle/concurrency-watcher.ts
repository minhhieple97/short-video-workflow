import { concurrencyForLane } from "@/features/settings/domain/concurrency-settings";
import { getConcurrencySettings } from "@/features/settings/services/concurrency-settings.service";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";
import { WORK_LANES, type WorkLane } from "@/shared/types/work-lane";

const logger = createLogger("worker.concurrency");
const CONCURRENCY_POLL_MS = 5_000;

// BullMQ reads a worker's concurrency before it takes a job, so a change saved on the Settings page applies without a
// restart. An idle lane takes the new number at once; a lane already running as many tasks as it may waits for one of them
// to end before it takes more (BullMQ offers no way to wake it sooner without passing the limit). On a cut, the running
// tasks finish and fewer are taken after them.
export async function applyConcurrencySettings(workers: Record<WorkLane, { concurrency: number }>): Promise<void> {
  const settings = await getConcurrencySettings();
  for (const lane of WORK_LANES) {
    const wanted = concurrencyForLane(settings, lane);
    if (workers[lane].concurrency === wanted) continue;
    logger.info("Lane concurrency changed", { lane, from: workers[lane].concurrency, to: wanted });
    workers[lane].concurrency = wanted;
  }
}

export function startConcurrencyWatcher(workers: Record<WorkLane, { concurrency: number }>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    inFlight ??= applyConcurrencySettings(workers)
      .catch((error: unknown) => {
        logger.error("Reading the concurrency settings failed", { error: toSafeErrorMessage(error) });
      })
      .finally(() => {
        inFlight = null;
      });
  }, CONCURRENCY_POLL_MS);
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}
