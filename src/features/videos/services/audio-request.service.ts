import "server-only";

import { enqueueTrackedJob } from "@/features/jobs/services/job-service";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";

import { sceneIdsToRevoice } from "../domain/audio";
import { listVisibleScenesForVoice, listVisibleScenesWithoutAudio } from "../repositories/audio.repository";
import { requireScene } from "./audio.service";
import { assertScriptNotGenerating, requireVideo } from "./video.service";

function assertTtsEnabled(): void {
  if (getAppConfig().tts.mode === "upload") {
    throw new AppError("TTS_DISABLED", "Đang dùng TTS_MODE=upload: hãy tải âm thanh MP3/WAV lên cho từng cảnh.", 409);
  }
}

export async function requestSceneTts(sceneId: string): Promise<JobDto> {
  assertTtsEnabled();
  const scene = await requireScene(sceneId);
  await assertScriptNotGenerating(scene.video.id);
  if (!scene.narration.trim()) throw new AppError("EMPTY_NARRATION", "Cảnh chưa có lời dẫn.", 409);
  const { job } = await enqueueTrackedJob({
    jobType: "GENERATE_SCENE_TTS",
    entityType: "SCENE",
    entityId: sceneId,
    payload: { sceneId },
  });
  return job;
}

async function requestScenes(videoId: string, sceneIds: readonly string[]): Promise<JobDto[]> {
  const jobs: JobDto[] = [];
  for (const sceneId of sceneIds) jobs.push(await requestSceneTts(sceneId));
  return jobs;
}

export async function requestMissingTts(videoId: string): Promise<JobDto[]> {
  assertTtsEnabled();
  await requireVideo(videoId);
  await assertScriptNotGenerating(videoId);
  return requestScenes(
    videoId,
    (await listVisibleScenesWithoutAudio(videoId)).map((scene) => scene.id),
  );
}

// Every visible scene that has narration, except those with a clip the user uploaded: a new voice must not replace it. A
// scene whose voice already matches the pace is served from the cache, so only its length is worked out again.
export async function requestAllTts(videoId: string): Promise<JobDto[]> {
  assertTtsEnabled();
  await requireVideo(videoId);
  await assertScriptNotGenerating(videoId);
  const scenes = await listVisibleScenesForVoice(videoId);
  return requestScenes(
    videoId,
    sceneIdsToRevoice(
      scenes.map((scene) => ({
        id: scene.id,
        narration: scene.narration,
        audioProvider: scene.mediaAssets.find((asset) => asset.id === scene.audioAssetId)?.provider ?? null,
      })),
    ),
  );
}
