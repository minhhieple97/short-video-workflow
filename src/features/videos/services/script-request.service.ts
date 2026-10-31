import "server-only";

import { enqueueTrackedJob } from "@/features/jobs/services/job-service";
import { AppError, NotFoundError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";
import { getAiSettings } from "@/features/settings/services/ai-settings.service";
import { dispatchJobIntent } from "@/features/jobs/services/job-dispatch.service";
import { toJobDto } from "@/features/jobs/services/job-dto";
import { enqueueJob } from "@/server/queue/queue";
import { generationInputSchema, SCRIPT_DRAFT_PROMPT_VERSION } from "@/server/script-draft/contracts";
import { SCENE_PLAN_PROMPT_VERSION } from "@/server/ai/prompts/scene-plan-prompt";
import { createScriptGenerationIntent } from "../repositories/script-generation-request.repository";
import { toPace } from "../domain/pace";
import { pickStoryAngle } from "../domain/story-angle";
import { lessonSnapshotsOf } from "./video-mapper";
import { getAppConfig } from "@/shared/config/env";

import { assertScriptNotGenerating, requireVideo } from "./video.service";

export async function requestScriptGeneration(videoId: string): Promise<JobDto> {
  const video = await requireVideo(videoId);
  if (video.videoLessons.length === 0) throw new AppError("VIDEO_WITHOUT_LESSONS", "Video chưa có bài học nguồn.", 409);
  await assertScriptNotGenerating(videoId, { sceneId: null });
  const { settings } = await getAiSettings();
  const context = generationInputSchema.parse({
    aiMode: getAppConfig().ai.mode,
    videoId,
    title: video.title,
    bookId: video.bookId,
    book: video.book,
    lessons: lessonSnapshotsOf(video),
    minDurationSec: video.minDurationSec,
    maxDurationSec: video.maxDurationSec,
    pace: toPace(video.pace),
    storyAngle: pickStoryAngle(video.id, video.scriptVersion),
    draftPromptVersion: SCRIPT_DRAFT_PROMPT_VERSION,
    scenePromptVersion: SCENE_PLAN_PROMPT_VERSION,
  });
  const intent = await createScriptGenerationIntent({ context, settings, baseScriptVersion: video.scriptVersion });
  await dispatchJobIntent(intent, enqueueJob);
  return toJobDto(intent.jobRecord);
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
    payload: { videoId, sceneId, execution: (await getAiSettings()).settings.script },
  });
  return job;
}
