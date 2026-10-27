import "server-only";

import { enqueueTrackedJob } from "@/features/jobs/services/job-service";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";

import { listVisibleScenesWithoutAudio } from "../repositories/audio.repository";
import { requireScene } from "./audio.service";
import { requireVideo } from "./video.service";

function assertTtsEnabled(): void {
  if (getAppConfig().tts.mode !== "edge-tts") {
    throw new AppError("TTS_DISABLED", "Đang dùng TTS_MODE=upload: hãy tải âm thanh MP3/WAV lên cho từng cảnh.", 409);
  }
}

export async function requestSceneTts(sceneId: string): Promise<JobDto> {
  assertTtsEnabled();
  const scene = await requireScene(sceneId);
  if (!scene.narration.trim()) throw new AppError("EMPTY_NARRATION", "Cảnh chưa có lời dẫn.", 409);
  const { job } = await enqueueTrackedJob({
    jobType: "GENERATE_SCENE_TTS",
    entityType: "SCENE",
    entityId: sceneId,
    payload: { sceneId },
  });
  return job;
}

export async function requestMissingTts(videoId: string): Promise<JobDto[]> {
  assertTtsEnabled();
  await requireVideo(videoId);
  const jobs: JobDto[] = [];
  for (const scene of await listVisibleScenesWithoutAudio(videoId)) jobs.push(await requestSceneTts(scene.id));
  return jobs;
}
