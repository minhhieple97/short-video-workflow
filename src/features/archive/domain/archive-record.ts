import type { RenderSnapshot } from "@/features/videos/domain/render-snapshot";
import { stableStringify } from "@/shared/stable-json";

export const ARCHIVE_SCRIPT_VERSION = "archive-script-v1";
export const ARCHIVE_MANIFEST_VERSION = "archive-manifest-v1";

export interface ArchiveFileDigest {
  name: string;
  bytes: number;
  sha256: string;
}

export interface ArchiveRenderFacts {
  renderId: string;
  bookId: string;
  snapshotHash: string;
  durationMs: number | null;
  completedAt: string;
}

// Remote names follow the plan's layout: video_s<script version>_<renderId>_<width>x<height>.mp4, script.json, manifest.json.
export function archiveFileNames(render: { id: string; scriptVersion: number; width: number; height: number }) {
  return {
    VIDEO: `video_s${render.scriptVersion}_${render.id}_${render.width}x${render.height}.mp4`,
    SCRIPT: "script.json",
    MANIFEST: "manifest.json",
  } as const;
}

// Sorted keys, two-space indent and a final newline: the same render always gives the same bytes, so a retry that
// rebuilds the file uploads exactly what the first attempt would have.
export function toArchiveJson(value: unknown): string {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`;
}

// What was said on screen, taken from the render's snapshot (never from the live video), with the book sources it rests on.
export function buildArchiveScript(snapshot: RenderSnapshot, facts: Pick<ArchiveRenderFacts, "renderId">) {
  const fps = snapshot.render.fps;
  return {
    schemaVersion: ARCHIVE_SCRIPT_VERSION,
    renderId: facts.renderId,
    videoId: snapshot.video.id,
    title: snapshot.video.title,
    bookTitle: snapshot.video.bookTitle,
    scriptVersion: snapshot.video.scriptVersion,
    targetDurationSec: snapshot.video.targetDurationSec,
    scenes: [...snapshot.scenes]
      .filter((scene) => !scene.hidden)
      .sort((left, right) => left.order - right.order)
      .map((scene) => ({
        order: scene.order,
        type: scene.type,
        title: scene.title,
        narration: scene.narration,
        onScreenText: scene.onScreenText,
        durationSec: Math.round((scene.durationFrames / fps) * 1000) / 1000,
      })),
    lessons: snapshot.lessons.map((lesson) => ({
      lessonId: lesson.lessonId,
      title: lesson.title,
      sources: lesson.sources.map((source) => ({ chapterTitle: source.chapterTitle, excerpt: source.excerpt })),
    })),
  };
}

// The render's record: what it was made from and the exact files that make it up. No local paths are written into it.
export function buildArchiveManifest(
  snapshot: RenderSnapshot,
  facts: ArchiveRenderFacts,
  files: { video: ArchiveFileDigest; script: ArchiveFileDigest },
) {
  return {
    schemaVersion: ARCHIVE_MANIFEST_VERSION,
    renderId: facts.renderId,
    videoId: snapshot.video.id,
    bookId: facts.bookId,
    quality: snapshot.render.quality,
    width: snapshot.render.width,
    height: snapshot.render.height,
    fps: snapshot.render.fps,
    durationMs: facts.durationMs,
    scriptVersion: snapshot.video.scriptVersion,
    templateVersion: snapshot.templateVersion,
    compositionId: snapshot.compositionId,
    snapshotVersion: snapshot.schemaVersion,
    snapshotHash: facts.snapshotHash,
    snapshotCapturedAt: snapshot.capturedAt,
    renderCompletedAt: facts.completedAt,
    files,
    audio: snapshot.audio.map((audio) => ({
      assetId: audio.assetId,
      contentHash: audio.contentHash,
      durationMs: audio.durationMs,
      provider: audio.provider,
    })),
  };
}
