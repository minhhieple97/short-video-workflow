import { createLogger } from "@/shared/logger";

import { ensureItemJob, listRunnableItemIds } from "../repositories/production-jobs.repository";

const logger = createLogger("productions.reconcile");

// Run by the worker at start-up, after the job records were re-aligned with Redis: an item still in progress whose job
// was lost gets a new one and resumes from its checkpoint. Not run periodically, so an item that keeps crashing its job
// does not loop; it waits for a restart or for the user's retry.
export async function reconcileProductionItems(): Promise<number> {
  let started = 0;
  for (const itemId of await listRunnableItemIds()) {
    const result = await ensureItemJob(itemId);
    if (result?.started) started += 1;
  }
  if (started > 0) logger.info("Production items given a new job", { started });
  return started;
}
