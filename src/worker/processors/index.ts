import type { Job } from "bullmq";
import { ZodError } from "zod";

import { baseJobPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import {
  markJobCompleted,
  markJobFailed,
  markJobRunning,
  setJobProgress,
} from "@/features/jobs/repositories/job-record.repository";
import { AppError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";
import { isJobType, type JobType } from "@/shared/types/job";

import { processAnalyzeChapter } from "./analyze-chapter";
import { processDiagnosticPing } from "./diagnostic-ping";
import { processGenerateScript } from "./generate-script";
import { processGenerateTts } from "./generate-tts";
import { processRenderVideo } from "./render-video";
import type { JobProcessor } from "./types";

const logger = createLogger("worker.dispatch");

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

export async function processJob(job: Job): Promise<unknown> {
  const payload = baseJobPayloadSchema.parse(job.data);
  const { jobRecordId } = payload;
  const fields = { jobId: job.id, jobType: job.name, jobRecordId };

  try {
    if (!isJobType(job.name)) {
      throw new AppError("UNKNOWN_JOB_TYPE", `Loại tác vụ không được hỗ trợ: ${job.name}`);
    }

    await markJobRunning(jobRecordId);
    logger.info("Job started", fields);

    const result = await PROCESSORS[job.name]({
      job,
      jobRecordId,
      reportProgress: async (progress) => {
        await job.updateProgress(progress);
        await setJobProgress(jobRecordId, progress);
      },
    });

    await markJobCompleted(jobRecordId);
    logger.info("Job completed", fields);
    return result;
  } catch (error) {
    const message = toSafeErrorMessage(error);
    logger.error("Job failed", { ...fields, errorCode: toErrorCode(error), error: message });
    await markJobFailed(jobRecordId, toErrorCode(error), message);
    throw error;
  }
}
