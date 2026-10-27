import { generateScriptPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { runSceneRegeneration, runScriptGeneration } from "@/features/videos/services/script-generation.service";

import type { JobProcessor } from "./types";

export const processGenerateScript: JobProcessor = async ({ job, jobRecordId, reportProgress }) => {
  const payload = generateScriptPayloadSchema.parse(job.data);
  await reportProgress(10);
  const result = payload.sceneId
    ? await runSceneRegeneration({ videoId: payload.videoId, sceneId: payload.sceneId, jobRecordId })
    : await runScriptGeneration({ videoId: payload.videoId, jobRecordId });
  await reportProgress(100);
  return result;
};
