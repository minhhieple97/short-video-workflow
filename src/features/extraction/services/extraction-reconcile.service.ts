import { createLogger } from "@/shared/logger";

import { ensureExtractionJob, listRunnableExtractionIds } from "../repositories/extraction-jobs.repository";

const logger = createLogger("extraction.reconcile");

// Run by the worker at start-up, after the job records were re-aligned with Redis: a run still in progress whose job was
// lost gets a new one and resumes from what is stored. Not run periodically, so a run that keeps crashing its job does
// not loop; it waits for a restart or for the user's retry.
export async function reconcileExtractions(): Promise<number> {
  let started = 0;
  for (const extractionId of await listRunnableExtractionIds()) {
    const result = await ensureExtractionJob(extractionId);
    if (result?.started) started += 1;
  }
  if (started > 0) logger.info("Extractions given a new job", { started });
  return started;
}
