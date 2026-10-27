import { renderVideoPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { runRender } from "@/features/videos/services/render-runner";

import type { JobProcessor } from "./types";

export const processRenderVideo: JobProcessor = async ({ job, reportProgress }) => {
  const { renderId } = renderVideoPayloadSchema.parse(job.data);
  await reportProgress(2);
  return runRender({ renderId, onProgress: reportProgress });
};
