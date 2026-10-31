import { generatePublishMetadataPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { runPublishMetadataGeneration } from "@/features/videos/services/publish-generation.service";

import { isWaitingForCli, type JobProcessor } from "./types";

export const processGeneratePublishMetadata: JobProcessor = async ({ job, jobRecordId, signal, reportProgress }) => {
  const payload = generatePublishMetadataPayloadSchema.parse(job.data);
  const resume = {
    jobType: "GENERATE_PUBLISH_METADATA" as const,
    payload: { videoId: payload.videoId, ...(payload.execution ? { execution: payload.execution } : {}) },
  };
  await reportProgress(10);
  const result = await runPublishMetadataGeneration({
    videoId: payload.videoId,
    execution: payload.execution,
    jobRecordId,
    resume,
    signal,
  });
  if (!isWaitingForCli(result)) await reportProgress(100);
  return result;
};
