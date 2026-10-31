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
  type PipelineDeps,
  type RunOutcome,
} from "@/features/productions/services/production-pipeline.service";
import { getAppConfig } from "@/shared/config/env";
import { AppError, JobCancelledError } from "@/shared/errors";
import { toSafeErrorMessage } from "@/shared/logger";
import { requireGenerationRun } from "@/features/videos/services/script-generation-run.service";

import { deferred, handoff, type JobProcessor } from "./types";

const MIN_CLAIM_WAIT_MS = 1_000;

// One job advances one production item through as many steps of its lane as it can without waiting. It never sleeps for a
// render or a retry pause: it reports `deferred`, the outbox schedules the same job again, and the worker is free in
// between. A step of another lane (the draft is Claude's, or NotebookLM's for an older item; the scene plan Claude's; the voice-over the voice lane's) is
// handed over to that lane's queue. Each run starts from the item's checkpoint, so a restart repeats nothing that is done.
export const processRunProductionItem: JobProcessor = async ({ job, jobRecordId, lane, signal }) => {
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
  let deps: PipelineDeps | null = null;
  try {
    await refreshBatchOf(itemId);
    const state = await findItemRunState(itemId);
    const mode = state?.scriptGenerationRunId
      ? (await requireGenerationRun(state.scriptGenerationRunId)).input.aiMode
      : getAppConfig().ai.mode;
    deps = createPipelineDeps(mode, undefined, Boolean(state?.scriptGenerationRunId));
    deps.jobRecordId = jobRecordId;
    outcome = await runProductionPipeline({ itemId, claimToken, signal, deps, lane });
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
  } finally {
    await deps?.close?.();
  }

  await settle(itemId, claimToken, outcome);
  switch (outcome.kind) {
    case "DEFER":
      return deferred(outcome.retryAfterMs);
    case "HANDOFF":
      return handoff(outcome.lane);
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
