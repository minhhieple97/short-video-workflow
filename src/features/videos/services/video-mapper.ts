import { z } from "zod";

import { hookOptionSchema } from "@/server/ai/contracts/video-script";

import {
  assessDurationBudget,
  effectiveSceneFrames,
  estimateNarrationSeconds,
  HOOK_MAX_SECONDS,
  VIDEO_FPS,
} from "../domain/duration";
import { lessonSnapshotSchema } from "../domain/lesson-snapshot";
import { isVoiceStale, paceProfile, syllablesPerSecond, toPace } from "../domain/pace";
import { toSceneType, toVisualVariant, HOOK_VARIANTS, type HookVariant } from "../domain/scene-types";
import { toVideoStatus } from "../domain/video-status";
import type { VideoDetailRecord } from "../repositories/video.repository";
import type { SceneAudioDto, SceneDto, VideoDetail } from "../schemas/video.dto";
import { parseIllustration } from "./scene-records";

const hookOptionsSchema = z.array(hookOptionSchema).catch([]);

function toHookVariant(value: string | null): HookVariant | null {
  return HOOK_VARIANTS.find((variant) => variant === value) ?? null;
}

function toSceneDto(scene: VideoDetailRecord["scenes"][number], rate: number): SceneDto {
  return {
    id: scene.id,
    order: scene.order,
    type: toSceneType(scene.type),
    title: scene.title,
    narration: scene.narration,
    onScreenText: scene.onScreenText,
    visualVariant: toVisualVariant(scene.visualVariant),
    hookVariant: toHookVariant(scene.hookVariant),
    estimatedSeconds: scene.estimatedSeconds ?? estimateNarrationSeconds(scene.narration, rate),
    durationFrames: scene.durationFrames ?? 0,
    hidden: scene.hidden,
    version: scene.version,
    audioAssetId: scene.audioAssetId,
    audio: toSceneAudio(scene),
    illustration: parseIllustration(scene.illustrationJson),
  };
}

const audioSettingsSchema = z
  .object({ leadingSilenceMs: z.number().default(0), speed: z.number().optional() })
  .catch({ leadingSilenceMs: 0 });

function toSceneAudio(scene: VideoDetailRecord["scenes"][number]): SceneAudioDto | null {
  const asset = scene.mediaAssets.find((candidate) => candidate.id === scene.audioAssetId);
  if (!asset) return null;
  const settings = audioSettingsSchema.parse(asset.generationSettingsJson ?? {});
  return {
    assetId: asset.id,
    provider: asset.provider ?? "upload",
    durationMs: asset.durationMs ?? 0,
    leadingSilenceMs: settings.leadingSilenceMs,
    speedPercent: settings.speed ?? null,
    url: mediaAssetUrl(asset.id),
  };
}

export const mediaAssetUrl = (assetId: string) => `/api/media/assets/${assetId}`;

export function hookIssues(scenes: readonly SceneDto[]): string[] {
  const hook = scenes[0];
  if (!hook || hook.type !== "HOOK") return ["Cảnh đầu tiên phải là HOOK bắt đầu tại frame 0."];
  const issues: string[] = [];
  if (hook.hidden) issues.push("Không được ẩn cảnh HOOK.");
  if (hook.onScreenText.trim().length === 0) issues.push("HOOK cần chữ trên màn hình ngay từ frame 0.");
  // With narration attached the real clip length decides; otherwise the text estimate does.
  const hookSeconds = hook.audio ? hook.durationFrames / VIDEO_FPS : hook.estimatedSeconds;
  if (hookSeconds > HOOK_MAX_SECONDS) {
    issues.push(
      `HOOK dài khoảng ${Math.round(hookSeconds * 10) / 10} giây${hook.audio ? " (theo âm thanh)" : ""}; tối đa ${HOOK_MAX_SECONDS} giây — hãy rút gọn.`,
    );
  }
  if (scenes.slice(1).some((scene) => scene.type === "HOOK")) issues.push("Chỉ được có một cảnh HOOK, ở vị trí đầu.");
  return issues;
}

export function toVideoDetail(video: VideoDetailRecord): VideoDetail {
  const pace = toPace(video.pace);
  const rate = syllablesPerSecond(pace);
  const scenes = video.scenes.map((scene) => toSceneDto(scene, rate));
  const visibleSeconds =
    scenes
      .filter((scene) => !scene.hidden)
      .reduce((sum, scene) => sum + effectiveSceneFrames(scene.durationFrames), 0) / VIDEO_FPS;
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    status: toVideoStatus(video.status),
    book: { id: video.book.id, title: video.book.title, author: video.book.author },
    targetDurationSec: video.targetDurationSec,
    minDurationSec: video.minDurationSec,
    maxDurationSec: video.maxDurationSec,
    pace,
    staleVoiceSceneCount: scenes.filter(
      (scene) => !scene.hidden && scene.audio && isVoiceStale(scene.audio, paceProfile(pace).speedPercent),
    ).length,
    durationReason: video.durationReason,
    width: video.width,
    height: video.height,
    fps: video.fps,
    aspectRatio: video.aspectRatio,
    platformPreviewMode: video.platformPreviewMode,
    scriptVersion: video.scriptVersion,
    approvedScriptVersion: video.approvedScriptVersion,
    autoReady: video.autoReadyScriptVersion !== null && video.autoReadyScriptVersion === video.scriptVersion,
    hookOptions: hookOptionsSchema
      .parse(video.hookOptionsJson ?? [])
      .map((option) => ({ ...option, estimatedSeconds: estimateNarrationSeconds(option.narration, rate) })),
    lessons: video.videoLessons.map((videoLesson) => {
      const snapshot = lessonSnapshotSchema.safeParse(videoLesson.lessonSnapshotJson);
      return {
        lessonId: videoLesson.lessonId,
        position: videoLesson.position,
        title: snapshot.success ? snapshot.data.title : videoLesson.lesson.title,
        currentStatus: videoLesson.lesson.status,
        changedSinceSnapshot: snapshot.success && snapshot.data.contentHash !== videoLesson.lesson.contentHash,
      };
    }),
    scenes,
    budget: assessDurationBudget(visibleSeconds, {
      targetSeconds: video.targetDurationSec,
      minDurationSec: video.minDurationSec,
      maxDurationSec: video.maxDurationSec,
    }),
    hookIssues: hookIssues(scenes),
    createdAt: video.createdAt.toISOString(),
    updatedAt: video.updatedAt.toISOString(),
  };
}

export function lessonSnapshotsOf(video: VideoDetailRecord) {
  return video.videoLessons.map((videoLesson) => lessonSnapshotSchema.parse(videoLesson.lessonSnapshotJson));
}
