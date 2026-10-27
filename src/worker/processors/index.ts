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
  setJobProgress,
} from "@/features/jobs/repositories/job-record.repository";
import { releaseJobEntity } from "@/features/jobs/services/job-effects";
import { AppError, JobCancelledError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";
import { isJobType, type JobType } from "@/shared/types/job";

import { processAnalyzeChapter } from "./analyze-chapter";
import { processDiagnosticPing } from "./diagnostic-ping";
import { processGenerateScript } from "./generate-script";
import { processGenerateTts } from "./generate-tts";
import { processRenderVideo } from "./render-video";
import { isWaitingForCli, type JobProcessor } from "./types";

const logger = createLogger("worker.dispatch");
const CANCEL_POLL_MS = 2_000;

const PROCESSORS: Record<JobType, JobProcessor> = {
  DIAGNOSTIC_PING: processDiagnosticPing,
  ANALYZE_CHAPTER: processAnalyzeChapter,
  GENERATE_VIDEO_SCRIPT: processGenerateScript,
  GENERATE_SCENE_TTS: processGenerateTts,
  RENDER_VIDEO: processRenderVideo,
};

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

export async function processJob(job: Job): Promise<unknown> {
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

  const watcher = watchForCancel(jobRecordId);
  try {
    if (!isJobType(job.name)) throw new AppError("UNKNOWN_JOB_TYPE", `Loại tác vụ không được hỗ trợ: ${job.name}`);
    await markJobRunning(jobRecordId);
    logger.info("Job started", fields);

    const result = await PROCESSORS[job.name]({
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
    } else {
      await markJobCompleted(jobRecordId);
      logger.info("Job completed", fields);
    }
    return result;
  } catch (error) {
    if (watcher.signal.aborted || error instanceof JobCancelledError) {
      await markJobCancelled(jobRecordId);
      await releaseJobEntity(record, "CANCELLED", "Đã huỷ theo yêu cầu.");
      logger.info("Job cancelled", fields);
      return { cancelled: true };
    }

    const message = toSafeErrorMessage(error);
    const willRetry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
    logger.error(willRetry ? "Job failed, will retry" : "Job failed", {
      ...fields,
      errorCode: toErrorCode(error),
      error: message,
    });
    if (willRetry) await markJobRetrying(jobRecordId, toErrorCode(error), message);
    else await markJobFailed(jobRecordId, toErrorCode(error), message);
    throw error;
  } finally {
    watcher.stop();
  }
}
