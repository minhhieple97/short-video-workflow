import { generateScriptPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { runSceneRegeneration, runScriptGeneration } from "@/features/videos/services/script-generation.service";

import { isWaitingForCli, type JobProcessor } from "./types";

export const processGenerateScript: JobProcessor = async ({ job, jobRecordId, reportProgress }) => {
  const payload = generateScriptPayloadSchema.parse(job.data);
  const resume = {
    jobType: "GENERATE_VIDEO_SCRIPT" as const,
    payload: payload.sceneId ? { videoId: payload.videoId, sceneId: payload.sceneId } : { videoId: payload.videoId },
  };
  await reportProgress(10);
  const result = payload.sceneId
    ? await runSceneRegeneration({ videoId: payload.videoId, sceneId: payload.sceneId, jobRecordId, resume })
    : await runScriptGeneration({ videoId: payload.videoId, jobRecordId, resume });
  if (!isWaitingForCli(result)) await reportProgress(100);
  return result;
};
