import "server-only";

import { enqueueTrackedJob } from "@/features/jobs/services/job-service";
import { AppError, NotFoundError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";

import { assertScriptNotGenerating, requireVideo } from "./video.service";

export async function requestScriptGeneration(videoId: string): Promise<JobDto> {
  const video = await requireVideo(videoId);
  if (video.videoLessons.length === 0) throw new AppError("VIDEO_WITHOUT_LESSONS", "Video chưa có bài học nguồn.", 409);
  await assertScriptNotGenerating(videoId, { sceneId: null });
  const { job } = await enqueueTrackedJob({
    jobType: "GENERATE_VIDEO_SCRIPT",
    entityType: "VIDEO",
    entityId: videoId,
    payload: { videoId },
  });
  return job;
}

export async function requestSceneRegeneration(videoId: string, sceneId: string): Promise<JobDto> {
  const video = await requireVideo(videoId);
  await assertScriptNotGenerating(videoId, { sceneId });
  const scene = video.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFoundError("SCENE_NOT_FOUND", "Không tìm thấy cảnh.");
  if (scene.type === "HOOK")
    throw new AppError("HOOK_REQUIRED", "Hãy chọn phương án hook khác thay vì viết lại HOOK.", 409);
  const { job } = await enqueueTrackedJob({
    jobType: "GENERATE_VIDEO_SCRIPT",
    entityType: "SCENE",
    entityId: sceneId,
    payload: { videoId, sceneId },
  });
  return job;
}
