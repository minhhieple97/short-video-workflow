import { generateTtsPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { runSceneTts } from "@/features/videos/services/tts-runner";
import { withProviderCooldown } from "@/features/jobs/services/provider-cooldown.service";

import type { JobProcessor } from "./types";

export const processGenerateTts: JobProcessor = async ({ job, signal, reportProgress }) => {
  const { sceneId } = generateTtsPayloadSchema.parse(job.data);
  await reportProgress(10);
  const result = await withProviderCooldown("edge-tts", () => runSceneTts({ sceneId, signal }), {
    isSuccessful: (result) => !result.cached,
  });
  await reportProgress(100);
  return result;
};
