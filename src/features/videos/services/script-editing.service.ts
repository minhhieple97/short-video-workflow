import { AppError, NotFoundError } from "@/shared/errors";

import { DEFAULT_VISUAL_VARIANT, SCENE_TYPE_LABELS, toSceneType, type BodySceneType } from "../domain/scene-types";
import type { LessonSnapshot } from "../domain/lesson-snapshot";
import {
  deleteSceneRecord,
  insertSceneAfter,
  reorderSceneRecords,
  updateSceneRecord,
  type VideoDetailRecord,
} from "../repositories/video.repository";
import type { VideoDetail } from "../schemas/video.dto";
import type { AddSceneInput, UpdateSceneInput } from "../schemas/video.schema";
import { buildSceneRecord } from "./scene-records";
import { lessonSnapshotsOf, toVideoDetail } from "./video-mapper";
import { getVideo, requireVideo } from "./video.service";

function requireScene(video: VideoDetailRecord, sceneId: string) {
  const scene = video.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new NotFoundError("SCENE_NOT_FOUND", "Không tìm thấy cảnh.");
  return scene;
}

export async function selectHookOption(videoId: string, optionIndex: number): Promise<VideoDetail> {
  const video = await requireVideo(videoId);
  const option = toVideoDetail(video).hookOptions[optionIndex];
  if (!option) throw new AppError("HOOK_OPTION_NOT_FOUND", "Không có phương án hook này.", 404);

  const hookScene = buildSceneRecord({
    type: "HOOK",
    title: "Hook",
    narration: option.narration,
    onScreenText: option.onScreenText,
    visualVariant: option.visualVariant,
    hookVariant: option.variant,
  });
  const existing = video.scenes.find((scene) => scene.type === "HOOK");
  if (existing) await updateSceneRecord(videoId, existing.id, { ...hookScene, hidden: false }, true);
  else await insertSceneAfter(videoId, null, hookScene);
  return getVideo(videoId);
}

export async function updateScene(videoId: string, sceneId: string, input: UpdateSceneInput): Promise<VideoDetail> {
  const video = await requireVideo(videoId);
  const scene = requireScene(video, sceneId);
  if (scene.type === "HOOK" && input.hidden) throw new AppError("HOOK_REQUIRED", "Không thể ẩn cảnh HOOK.", 409);

  const record = buildSceneRecord({ ...input, type: scene.type, hookVariant: scene.hookVariant });
  const contentChanged = record.contentHash !== scene.contentHash;
  await updateSceneRecord(videoId, sceneId, { ...record, hidden: input.hidden }, contentChanged);
  return getVideo(videoId);
}

const TEMPLATE_FIELD: Record<BodySceneType, keyof LessonSnapshot> = {
  SITUATION: "realLifeScenario",
  COMMON_MISTAKE: "commonMistake",
  BETTER_APPROACH: "betterApproach",
  KEY_TAKEAWAY: "principle",
  ACTION_STEP: "actionableStep",
  SUMMARY: "summary",
};

// New scenes start from the matching field of the first lesson snapshot so they are never empty.
export async function addScene(videoId: string, input: AddSceneInput): Promise<VideoDetail> {
  const video = await requireVideo(videoId);
  const type = toSceneType(input.type);
  if (type === "HOOK") throw new AppError("HOOK_REQUIRED", "HOOK được tạo bằng cách chọn phương án hook.", 400);
  const [lesson] = lessonSnapshotsOf(video);
  const field = lesson?.[TEMPLATE_FIELD[type]];
  const narration = typeof field === "string" && field ? field : `Lời dẫn cho cảnh ${SCENE_TYPE_LABELS[type]}.`;

  const afterSceneId = input.afterSceneId ?? video.scenes.at(-1)?.id ?? null;
  if (afterSceneId) requireScene(video, afterSceneId);
  await insertSceneAfter(
    videoId,
    afterSceneId,
    buildSceneRecord({
      type,
      title: SCENE_TYPE_LABELS[type],
      narration,
      onScreenText: SCENE_TYPE_LABELS[type].toUpperCase(),
      visualVariant: DEFAULT_VISUAL_VARIANT[type],
      hookVariant: null,
    }),
  );
  return getVideo(videoId);
}

export async function deleteScene(videoId: string, sceneId: string): Promise<VideoDetail> {
  const video = await requireVideo(videoId);
  if (requireScene(video, sceneId).type === "HOOK") {
    throw new AppError(
      "HOOK_REQUIRED",
      "Không thể xoá cảnh HOOK; hãy chọn phương án hook khác hoặc sửa nội dung.",
      409,
    );
  }
  await deleteSceneRecord(videoId, sceneId);
  return getVideo(videoId);
}

export async function reorderScenes(videoId: string, sceneIds: readonly string[]): Promise<VideoDetail> {
  const video = await requireVideo(videoId);
  const current = video.scenes.map((scene) => scene.id);
  if (
    sceneIds.length !== current.length ||
    new Set(sceneIds).size !== current.length ||
    !current.every((id) => sceneIds.includes(id))
  ) {
    throw new AppError("INVALID_SCENE_ORDER", "Danh sách cảnh không khớp với kịch bản hiện tại.", 400);
  }
  const hook = video.scenes.find((scene) => scene.type === "HOOK");
  if (hook && sceneIds[0] !== hook.id) {
    throw new AppError("HOOK_REQUIRED", "Cảnh HOOK phải luôn đứng đầu (bắt đầu tại frame 0).", 409);
  }
  await reorderSceneRecords(videoId, sceneIds);
  return getVideo(videoId);
}
