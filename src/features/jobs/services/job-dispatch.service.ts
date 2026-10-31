import { randomUUID } from "node:crypto";

import { z } from "zod";

import { AppError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";
import { isJobType, type JobType } from "@/shared/types/job";
import type { WorkLane } from "@/shared/types/work-lane";

import {
  createJobIntent,
  deleteIntent,
  listDueJobIntents,
  markIntentDispatched,
  recordIntentFailure,
  reassignJobIntent,
  rescheduleRunningJob,
  type JobIntent,
} from "../repositories/job-dispatch.repository";
import { markJobFailed } from "../repositories/job-record.repository";
import { releaseJobEntity } from "./job-effects";

// Shared by the web process and the worker, so it must not import "server-only".
const logger = createLogger("jobs.dispatch");
const SWEEP_BATCH_SIZE = 50;
const payloadSchema = z.record(z.string(), z.unknown());

export type EnqueueJob = (jobType: JobType, data: Record<string, unknown>, bullmqJobId: string) => Promise<void>;

export interface TrackedJobRequest {
  jobType: JobType;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  requestFingerprint?: string;
  // Holds the job back until this time; omit to make it due immediately.
  availableAt?: Date;
}

// An intent that can never be delivered (as opposed to Redis being briefly unreachable).
class UndeliverableIntentError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("DISPATCH_FAILED", message, 500, options);
  }
}

// Writes the JobRecord and its outbox row in one transaction. Nothing has been sent to Redis yet.
export function recordJobIntent(request: TrackedJobRequest): Promise<JobIntent> {
  return createJobIntent({ ...request, bullmqJobId: randomUUID() });
}

function parseIntent(intent: JobIntent): { jobType: JobType; data: Record<string, unknown> } {
  const { jobType } = intent.jobRecord;
  if (!isJobType(jobType)) throw new UndeliverableIntentError(`Loại tác vụ không được hỗ trợ: ${jobType}`);

  try {
    const payload = payloadSchema.parse(JSON.parse(intent.payloadJson));
    return { jobType, data: { ...payload, jobRecordId: intent.jobRecordId } };
  } catch (error) {
    throw new UndeliverableIntentError("Dữ liệu tác vụ trong outbox không hợp lệ.", { cause: error });
  }
}

// Enqueue first, mark second: a crash in between redelivers the row, and BullMQ ignores the duplicate jobId.
export async function dispatchJobIntent(intent: JobIntent, enqueue: EnqueueJob): Promise<void> {
  const { jobType, data } = parseIntent(intent);
  await enqueue(jobType, data, intent.jobRecord.bullmqJobId);
  await markIntentDispatched(intent.id, intent.jobRecord.bullmqJobId);
}

// Called by the worker when a processor reports that its remote operation is still pending. The schedule lives in
// SQLite, so it survives a worker restart (and a wiped Redis). False means the job was no longer RUNNING.
export function deferRunningJob(
  jobRecordId: string,
  jobData: unknown,
  retryAfterMs: number,
  now: Date = new Date(),
): Promise<boolean> {
  const { jobRecordId: _ownId, ...payload } = payloadSchema.parse(jobData);
  return rescheduleRunningJob(jobRecordId, payload, new Date(now.getTime() + retryAfterMs));
}

// Moves a job to another lane and delivers it at once; the outbox sweep delivers it instead if Redis refuses now. False means
// the job was no longer waiting or running.
export async function handOffJob(
  jobRecordId: string,
  jobData: unknown,
  lane: WorkLane,
  enqueue: EnqueueJob,
): Promise<boolean> {
  const { jobRecordId: _ownId, ...payload } = payloadSchema.parse(jobData);
  const intent = await reassignJobIntent(jobRecordId, { ...payload, lane });
  if (!intent) return false;
  try {
    await dispatchJobIntent(intent, enqueue);
  } catch (error) {
    logger.warn("Hand-off not delivered yet; the outbox sweep will deliver it", {
      jobRecordId,
      lane,
      error: toSafeErrorMessage(error),
    });
  }
  return true;
}

// The job was refused before it could run (for example Redis is down), so it must not linger as QUEUED.
export async function failJobIntent(intent: JobIntent, errorCode: string, message: string): Promise<void> {
  await deleteIntent(intent.id);
  await markJobFailed(intent.jobRecordId, errorCode, message);
}

// Delivers every due outbox row to the queue; returns how many were delivered.
export async function sweepDueJobIntents(enqueue: EnqueueJob, now: Date = new Date()): Promise<number> {
  let delivered = 0;
  for (const intent of await listDueJobIntents(now, SWEEP_BATCH_SIZE)) {
    // Cancelled or finished while waiting: the row is stale, delivering it would only resurrect the job.
    if (intent.jobRecord.status !== "QUEUED") {
      await deleteIntent(intent.id);
      continue;
    }

    try {
      await dispatchJobIntent(intent, enqueue);
      delivered += 1;
    } catch (error) {
      await handleDeliveryFailure(intent, error);
    }
  }
  return delivered;
}

async function handleDeliveryFailure(intent: JobIntent, error: unknown): Promise<void> {
  const fields = { jobRecordId: intent.jobRecordId, error: toSafeErrorMessage(error) };

  if (error instanceof UndeliverableIntentError) {
    logger.error("Outbox row can never be delivered; failing the job", fields);
    await failJobIntent(intent, error.code, error.message);
    await releaseJobEntity(intent.jobRecord, "FAILED", error.message);
    return;
  }

  // Redis unreachable or similar: keep the row so the next sweep retries it.
  await recordIntentFailure(intent.id, toSafeErrorMessage(error));
  logger.warn("Outbox delivery failed; will retry", fields);
}
