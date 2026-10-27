import { generateTtsPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { runSceneTts } from "@/features/videos/services/tts-runner";

import type { JobProcessor } from "./types";

export const processGenerateTts: JobProcessor = async ({ job, signal, reportProgress }) => {
  const { sceneId } = generateTtsPayloadSchema.parse(job.data);
  await reportProgress(10);
  const result = await runSceneTts({ sceneId, signal });
  await reportProgress(100);
  return result;
};
