import { randomUUID } from "node:crypto";

import { runProductionItemPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import {
  claimProductionItem,
  releaseProductionClaim,
} from "@/features/productions/repositories/production-claim.repository";
import { createPipelineDeps } from "@/features/productions/services/pipeline-deps";
import {
  PRODUCTION_LEASE_MS,
  runProductionPipeline,
  settleProductionRun,
  type PipelineDeps,
  type RunOutcome,
} from "@/features/productions/services/production-pipeline.service";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

import { deferred, type JobProcessor } from "./types";

// One job advances one production item through as many steps as it can without waiting. It never sleeps for a render or a
// retry pause: it reports `deferred`, the outbox schedules the same job again, and the worker is free in between. Each run
// starts from the item's checkpoint, so a restart repeats nothing that is done.
export const processRunProductionItem: JobProcessor = async ({ job, signal }) => {
  const { itemId } = runProductionItemPayloadSchema.parse(job.data);
  const claimToken = randomUUID();
  if (!(await claimProductionItem(itemId, claimToken, PRODUCTION_LEASE_MS))) return { itemId, skipped: true };

  let deps: PipelineDeps;
  try {
    deps = createPipelineDeps(getAppConfig().ai.mode);
  } catch (error) {
    if (error instanceof AppError) {
      await releaseProductionClaim(itemId, claimToken, "FAILED", { code: error.code, message: error.message });
    } else {
      await releaseProductionClaim(itemId, claimToken, "PENDING");
    }
    throw error;
  }

  let outcome: RunOutcome;
  try {
    outcome = await runProductionPipeline({ itemId, claimToken, signal, deps });
  } catch (error) {
    // A cancelled job or an unexpected error leaves the item resumable; a lost claim means it is no longer ours to touch.
    if (!(error instanceof AppError && error.code === "PRODUCTION_CLAIM_LOST")) {
      await releaseProductionClaim(itemId, claimToken, "PENDING");
    }
    throw error;
  }

  await settleProductionRun({ itemId, claimToken, outcome });
  switch (outcome.kind) {
    case "DEFER":
      return deferred(outcome.retryAfterMs);
    case "FAILED":
      throw new AppError(outcome.code, outcome.message, 422);
    default:
      return { itemId, outcome: outcome.kind };
  }
};
