import { requestRenderArchive } from "@/features/archive/services/archive-request.service";
import { renderVideoPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { runRender } from "@/features/videos/services/render-runner";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import type { JobProcessor } from "./types";

const logger = createLogger("worker.render");

export const processRenderVideo: JobProcessor = async ({ job, signal, reportProgress }) => {
  const { renderId } = renderVideoPayloadSchema.parse(job.data);
  await reportProgress(2);
  const result = await runRender({ renderId, signal, onProgress: reportProgress });
  // The render is done and its archive intent is stored with it; if starting the archive fails now, the sweep starts it.
  await requestRenderArchive(renderId).catch((error: unknown) => {
    logger.warn("Could not start the archive of a finished render", { renderId, error: toSafeErrorMessage(error) });
  });
  return result;
};
