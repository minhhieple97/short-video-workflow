import type { Job } from "bullmq";
import { ZodError } from "zod";

import { baseJobPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import {
  findJobRecordById,
  markJobCancelled,
  markJobCompleted,
  markJobFailed,
  markJobRetrying,
  markJobRunning,
  markJobWaitingForCli,
  recordJobTransientFailure,
  recordJobWaitReason,
  setJobProgress,
} from "@/features/jobs/repositories/job-record.repository";
import { deferRunningJob } from "@/features/jobs/services/job-dispatch.service";
import { deferJobEntity, releaseJobEntity } from "@/features/jobs/services/job-effects";
import { AppError, JobCancelledError } from "@/shared/errors";
import { IntegrationError } from "@/server/integrations/integration-error";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";
import { isJobType, type JobType } from "@/shared/types/job";

import { isDeferred, isWaitingForCli, type JobProcessor } from "./types";

const logger = createLogger("worker.dispatch");
const CANCEL_POLL_MS = 2_000;

function toErrorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof ZodError) return "INVALID_PAYLOAD";
  return "PROCESSOR_ERROR";
}

// Turns a CANCEL_REQUESTED status written by the web app into an AbortSignal the processor can honour.
function watchForCancel(jobRecordId: string): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const timer = setInterval(() => {
    findJobRecordById(jobRecordId)
      .then((record) => {
        if (record?.status === "CANCEL_REQUESTED") controller.abort();
      })
      .catch(() => undefined);
  }, CANCEL_POLL_MS);
  return { signal: controller.signal, stop: () => clearInterval(timer) };
}

export function createJobDispatcher(processors: Record<JobType, JobProcessor>): (job: Job) => Promise<unknown> {
  return async function processJob(job: Job): Promise<unknown> {
    const { jobRecordId } = baseJobPayloadSchema.parse(job.data);
    const fields = { jobId: job.id, jobType: job.name, jobRecordId };

    const record = await findJobRecordById(jobRecordId);
    if (!record || record.status === "CANCELLED" || record.status === "CANCEL_REQUESTED") {
      if (record) {
        await markJobCancelled(jobRecordId);
        await releaseJobEntity(record, "CANCELLED", "Đã huỷ trước khi chạy.");
      }
      logger.info("Job skipped (cancelled)", fields);
      return { cancelled: true };
    }

    const finishCancelled = async (): Promise<{ cancelled: true }> => {
      await markJobCancelled(jobRecordId);
      await releaseJobEntity(record, "CANCELLED", "Đã huỷ theo yêu cầu.");
      logger.info("Job cancelled", fields);
      return { cancelled: true };
    };

    const watcher = watchForCancel(jobRecordId);
    try {
      if (!isJobType(job.name)) throw new AppError("UNKNOWN_JOB_TYPE", `Loại tác vụ không được hỗ trợ: ${job.name}`);
      await markJobRunning(jobRecordId);
      logger.info("Job started", fields);

      const result = await processors[job.name]({
        job,
        jobRecordId,
        signal: watcher.signal,
        reportProgress: async (progress) => {
          await job.updateProgress(progress);
          await setJobProgress(jobRecordId, progress);
        },
      });

      if (isWaitingForCli(result)) {
        await markJobWaitingForCli(jobRecordId);
        logger.info("Job waiting for Claude CLI", { ...fields, taskDir: result.taskDir });
      } else if (isDeferred(result)) {
        if (!(await deferRunningJob(jobRecordId, job.data, result.retryAfterMs))) return await finishCancelled();
        logger.info("Job deferred", { ...fields, retryAfterMs: result.retryAfterMs });
      } else {
        await markJobCompleted(jobRecordId);
        logger.info("Job completed", fields);
      }
      return result;
    } catch (error) {
      if (watcher.signal.aborted || error instanceof JobCancelledError) return await finishCancelled();
      if (error instanceof IntegrationError && error.kind === "QUOTA") {
        const retryAfterMs = Math.max(1, error.retryAfterMs ?? 60_000);
        await recordJobWaitReason(jobRecordId, error);
        await deferJobEntity(record);
        if (!(await deferRunningJob(jobRecordId, job.data, retryAfterMs))) return await finishCancelled();
        return { deferred: true, retryAfterMs };
      }
      if (job.name === "ANALYZE_CHAPTER" && error instanceof IntegrationError && error.kind === "TRANSIENT") {
        const failures = await recordJobTransientFailure(jobRecordId);
        if (failures <= 5) {
          const retryAfterMs = Math.max(error.retryAfterMs ?? 0, Math.min(15 * 60_000, 30_000 * 2 ** (failures - 1)));
          await recordJobWaitReason(jobRecordId, error);
          await deferJobEntity(record);
          if (!(await deferRunningJob(jobRecordId, job.data, retryAfterMs))) return await finishCancelled();
          return { deferred: true, retryAfterMs };
        }
      }

      const message = toSafeErrorMessage(error);
      const willRetry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
      logger.error(willRetry ? "Job failed, will retry" : "Job failed", {
        ...fields,
        errorCode: toErrorCode(error),
        error: message,
      });
      if (willRetry) await markJobRetrying(jobRecordId, toErrorCode(error), message);
      else
        await markJobFailed(
          jobRecordId,
          toErrorCode(error),
          message,
          error instanceof AppError && typeof error.details?.sceneId === "string" ? error.details.sceneId : undefined,
        );
      throw error;
    } finally {
      watcher.stop();
    }
  };
}
