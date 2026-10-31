import "server-only";

import { findActiveJobForEntity } from "@/features/jobs/repositories/job-record.repository";
import { toJobDto } from "@/features/jobs/services/job-dto";
import { enqueueTrackedJob } from "@/features/jobs/services/job-service";
import { AppError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";
import { getAiSettings } from "@/features/settings/services/ai-settings.service";

import type { PublishMetadata } from "../domain/publish-metadata";
import { upsertPublishMetadata } from "../repositories/publish-metadata.repository";
import type { VideoDetail } from "../schemas/video.dto";
import { scriptTextHash } from "./scene-records";
import { assertScriptNotGenerating, getVideo, requireVideo } from "./video.service";

export async function findActivePublishJob(videoId: string): Promise<JobDto | null> {
  const record = await findActiveJobForEntity("GENERATE_PUBLISH_METADATA", "VIDEO", videoId);
  return record ? toJobDto(record) : null;
}

// A script job about to run would replace the script and the set written with it, so neither a rewrite nor an edit
// starts while one is active.
export async function requestPublishMetadataGeneration(videoId: string): Promise<JobDto> {
  const video = await requireVideo(videoId);
  if (!video.scenes.some((scene) => !scene.hidden)) {
    throw new AppError("SCRIPT_EMPTY", "Chưa có kịch bản để viết tiêu đề và caption.", 409);
  }
  await assertScriptNotGenerating(videoId);
  const { job } = await enqueueTrackedJob({
    jobType: "GENERATE_PUBLISH_METADATA",
    entityType: "VIDEO",
    entityId: videoId,
    payload: { videoId, execution: (await getAiSettings()).settings.scene },
  });
  return job;
}

// Saving marks the set current for the script as it is now: the user has just read it against that script.
export async function savePublishMetadata(videoId: string, metadata: PublishMetadata): Promise<VideoDetail> {
  const video = await requireVideo(videoId);
  await assertScriptNotGenerating(videoId);
  if (await findActivePublishJob(videoId)) {
    throw new AppError(
      "PUBLISH_GENERATION_IN_PROGRESS",
      "AI đang viết lại tiêu đề và caption. Hãy đợi tác vụ xong hoặc huỷ nó trước khi lưu.",
      409,
    );
  }
  await upsertPublishMetadata(videoId, {
    metadata,
    origin: "EDITED",
    promptVersion: video.publishMetadata?.promptVersion ?? null,
    sourceTextHash: scriptTextHash(video.scenes),
  });
  return getVideo(videoId);
}
