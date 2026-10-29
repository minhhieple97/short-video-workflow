import type { RenderRecord } from "@/generated/prisma/client";
import { scriptDraftArtifactSchema } from "@/server/scene-plan/handoff";
import { AppError } from "@/shared/errors";

import {
  currentSnapshotIdentity,
  fingerprintRenderSnapshot,
  readStoredRenderSnapshot,
  type RenderSnapshot,
} from "../domain/render-snapshot";
import type { RenderQuality } from "../domain/preflight";
import { lessonSnapshotSchema } from "../domain/lesson-snapshot";
import { SCENE_TYPE_FOR_BEAT } from "../domain/narrative-beats";
import type { SceneType } from "../domain/scene-types";
import { findMediaAssets } from "../repositories/audio.repository";
import { saveRenderSnapshotIfMissing } from "../repositories/render.repository";
import { findProductionDraftForVideo } from "../repositories/video.repository";
import type { VideoDetail } from "../schemas/video.dto";
import { dimensionsFor } from "./render.service";
import { toVideoDetail } from "./video-mapper";
import { requireVideo } from "./video.service";

// The parts of the story that are scenarios made up for the video, not taken from the book: what the production's draft
// marked as illustrative, or, for a video made by hand, the situation (it comes from the lesson's illustrative scenario).
async function illustrativeSceneTypes(videoId: string): Promise<ReadonlySet<SceneType>> {
  const artifact = scriptDraftArtifactSchema.safeParse(await findProductionDraftForVideo(videoId));
  if (!artifact.success) return new Set<SceneType>(["SITUATION"]);
  return new Set(
    artifact.data.draft.beats.filter((beat) => beat.illustrative).map((beat) => SCENE_TYPE_FOR_BEAT[beat.beat]),
  );
}

// Captures what a render of this video would be made from right now. A visible scene that points at audio which no longer
// exists is refused here, loudly, instead of being rendered silent.
export async function captureRenderSnapshot(
  videoId: string,
  quality: RenderQuality,
): Promise<{ snapshot: RenderSnapshot; hash: string; video: VideoDetail }> {
  const record = await requireVideo(videoId);
  const video = toVideoDetail(record);

  const audioIds = [...new Set(video.scenes.flatMap((scene) => (scene.audioAssetId ? [scene.audioAssetId] : [])))];
  const assets = new Map((await findMediaAssets(audioIds)).map((asset) => [asset.id, asset]));
  const silenceByAsset = new Map(
    video.scenes.flatMap((scene) =>
      scene.audio ? [[scene.audio.assetId, scene.audio.leadingSilenceMs] as const] : [],
    ),
  );
  const missing = video.scenes.filter(
    (scene) => !scene.hidden && scene.audioAssetId && !assets.has(scene.audioAssetId),
  );
  if (missing.length > 0) {
    throw new AppError(
      "RENDER_AUDIO_MISSING",
      "Có cảnh trỏ tới tệp giọng đọc không còn tồn tại. Hãy tạo lại giọng đọc.",
      409,
      {
        details: { sceneIds: missing.map((scene) => scene.id) },
      },
    );
  }

  const illustrative = await illustrativeSceneTypes(videoId);
  const dims = dimensionsFor(quality);
  const snapshot: RenderSnapshot = {
    ...currentSnapshotIdentity(),
    capturedAt: new Date().toISOString(),
    video: {
      id: video.id,
      title: video.title,
      bookTitle: video.book.title,
      targetDurationSec: video.targetDurationSec,
      scriptVersion: video.scriptVersion,
      status: video.status,
      autoReady: video.autoReady,
    },
    render: { quality, width: dims.width, height: dims.height, fps: dims.fps },
    scenes: video.scenes.map((scene) => ({
      id: scene.id,
      order: scene.order,
      type: scene.type,
      title: scene.title,
      narration: scene.narration,
      onScreenText: scene.onScreenText,
      visualVariant: scene.visualVariant,
      hookVariant: scene.hookVariant,
      durationFrames: scene.durationFrames,
      hidden: scene.hidden,
      audioAssetId: scene.audioAssetId,
      illustration: scene.illustration,
      illustrative: illustrative.has(scene.type),
    })),
    audio: audioIds.flatMap((assetId) => {
      const asset = assets.get(assetId);
      return asset
        ? [
            {
              assetId,
              path: asset.path,
              mimeType: asset.mimeType,
              contentHash: asset.contentHash,
              durationMs: asset.durationMs,
              leadingSilenceMs: silenceByAsset.get(assetId) ?? 0,
              provider: asset.provider,
            },
          ]
        : [];
    }),
    lessons: record.videoLessons.map((videoLesson) => {
      const lesson = lessonSnapshotSchema.safeParse(videoLesson.lessonSnapshotJson);
      return {
        lessonId: videoLesson.lessonId,
        title: lesson.success ? lesson.data.title : videoLesson.lesson.title,
        sources: lesson.success ? lesson.data.sources : [],
      };
    }),
  };
  return { snapshot, hash: fingerprintRenderSnapshot(snapshot), video };
}

// The snapshot a render must use. A stored one is verified (valid shape, hash unchanged) and returned as it is, never
// recaptured. A render queued before snapshots existed has none, so one is captured now from the live video and stored.
export async function resolveRenderSnapshot(render: RenderRecord): Promise<RenderSnapshot> {
  if (render.snapshotJson !== null && render.snapshotHash !== null) {
    const stored = readStoredRenderSnapshot(render.snapshotJson, render.snapshotHash);
    if (!stored) throw new AppError("RENDER_SNAPSHOT_CORRUPT", "Snapshot của bản render bị hỏng hoặc đã bị sửa.", 500);
    return stored;
  }

  const { snapshot, hash } = await captureRenderSnapshot(render.videoId, render.qualityPreset);
  await saveRenderSnapshotIfMissing(render.id, snapshot, hash);
  return snapshot;
}
