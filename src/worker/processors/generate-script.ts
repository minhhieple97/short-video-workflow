import { generateScriptPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { runSceneRegeneration, runScriptGeneration } from "@/features/videos/services/script-generation.service";

import { isWaitingForCli, type JobProcessor } from "./types";

export const processGenerateScript: JobProcessor = async ({ job, jobRecordId, signal, reportProgress }) => {
  const payload = generateScriptPayloadSchema.parse(job.data);
  const resume = {
    jobType: "GENERATE_VIDEO_SCRIPT" as const,
    payload: payload.sceneId
      ? {
          videoId: payload.videoId,
          sceneId: payload.sceneId,
          ...(payload.execution ? { execution: payload.execution } : {}),
        }
      : { videoId: payload.videoId, ...(payload.generationRunId ? { generationRunId: payload.generationRunId } : {}) },
  };
  await reportProgress(10);
  const result = payload.sceneId
    ? await runSceneRegeneration({
        videoId: payload.videoId,
        sceneId: payload.sceneId,
        execution: payload.execution,
        jobRecordId,
        resume,
        signal,
      })
    : await runScriptGeneration({
        videoId: payload.videoId,
        generationRunId: payload.generationRunId,
        jobRecordId,
        resume,
        signal,
      });
  if (!isWaitingForCli(result)) await reportProgress(100);
  return result;
};
