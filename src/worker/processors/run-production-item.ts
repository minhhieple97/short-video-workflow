import { randomUUID } from "node:crypto";

import { runProductionItemPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { isTerminalItemStatus, toItemStatus } from "@/features/productions/domain/production-status";
import { claimProductionItem } from "@/features/productions/repositories/production-claim.repository";
import { findItemRunState, refreshBatchStatus } from "@/features/productions/repositories/production-jobs.repository";
import { createPipelineDeps } from "@/features/productions/services/pipeline-deps";
import {
  PRODUCTION_LEASE_MS,
  runProductionPipeline,
  settleProductionRun,
  type RunOutcome,
} from "@/features/productions/services/production-pipeline.service";
import { getAppConfig } from "@/shared/config/env";
import { AppError, JobCancelledError } from "@/shared/errors";
import { toSafeErrorMessage } from "@/shared/logger";

import { deferred, type JobProcessor } from "./types";

const MIN_CLAIM_WAIT_MS = 1_000;

// One job advances one production item through as many steps as it can without waiting. It never sleeps for a render or a
// retry pause: it reports `deferred`, the outbox schedules the same job again, and the worker is free in between. Each run
// starts from the item's checkpoint, so a restart repeats nothing that is done.
export const processRunProductionItem: JobProcessor = async ({ job, signal }) => {
  const { itemId } = runProductionItemPayloadSchema.parse(job.data);
  const claimToken = randomUUID();
  if (!(await claimProductionItem(itemId, claimToken, PRODUCTION_LEASE_MS))) {
    const state = await findItemRunState(itemId);
    if (!state || isTerminalItemStatus(toItemStatus(state.status))) return { itemId, skipped: true };
    // Still held under a lease, typically by a run that died with the previous worker: come back once it runs out.
    const waitMs = (state.claimExpiresAt?.getTime() ?? 0) - Date.now();
    return deferred(Math.max(MIN_CLAIM_WAIT_MS, waitMs + MIN_CLAIM_WAIT_MS));
  }

  let outcome: RunOutcome;
  try {
    await refreshBatchOf(itemId);
    outcome = await runProductionPipeline({
      itemId,
      claimToken,
      signal,
      deps: createPipelineDeps(getAppConfig().ai.mode),
    });
  } catch (error) {
    // Cancelling the job cancels the item. A lost claim means the item is no longer ours to touch. Anything else is
    // recorded as the item's failure, so it never sits in progress without a job.
    if (error instanceof JobCancelledError) {
      outcome = { kind: "CANCELLED" };
    } else if (error instanceof AppError && error.code === "PRODUCTION_CLAIM_LOST") {
      throw error;
    } else {
      outcome = {
        kind: "FAILED",
        code: error instanceof AppError ? error.code : "PRODUCTION_STEP_ERROR",
        message: toSafeErrorMessage(error),
      };
    }
    await settle(itemId, claimToken, outcome);
    throw error;
  }

  await settle(itemId, claimToken, outcome);
  switch (outcome.kind) {
    case "DEFER":
      return deferred(outcome.retryAfterMs);
    case "FAILED":
      throw new AppError(outcome.code, outcome.message, 422);
    default:
      return { itemId, outcome: outcome.kind };
  }
};

async function refreshBatchOf(itemId: string): Promise<void> {
  const state = await findItemRunState(itemId);
  if (state) await refreshBatchStatus(state.batchId);
}

async function settle(itemId: string, claimToken: string, outcome: RunOutcome): Promise<void> {
  await settleProductionRun({ itemId, claimToken, outcome });
  await refreshBatchOf(itemId);
}
