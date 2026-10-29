import { createHash } from "node:crypto";

import { estimateNarrationSeconds, secondsToFrames } from "../domain/duration";
import { illustrationSchema, type Illustration } from "../domain/illustration";
import { syllablesPerSecond, toPace } from "../domain/pace";
import type { NewSceneRecord } from "../repositories/video.repository";

export interface SceneContent {
  type: string;
  title: string | null;
  narration: string;
  onScreenText: string;
  visualVariant: string;
  hookVariant: string | null;
  // Null (or absent) means the default picture for the scene's type.
  illustration?: Illustration | null;
}

// The illustration counts only when one is chosen, so scenes saved before illustrations existed keep their hash.
export function sceneContentHash(
  scene: Pick<SceneContent, "type" | "narration" | "onScreenText" | "visualVariant" | "illustration">,
): string {
  const parts: unknown[] = [scene.type, scene.narration, scene.onScreenText, scene.visualVariant];
  if (scene.illustration) parts.push(scene.illustration.setting, scene.illustration.action);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

// The words viewers see and hear, in order: what a caption is written from. Audio, pictures and layouts are left out, so a
// voice-over or a new illustration does not make the caption outdated.
export function scriptTextHash(
  scenes: readonly (Pick<SceneContent, "type" | "title" | "narration" | "onScreenText"> & { hidden?: boolean })[],
): string {
  const parts = scenes
    .filter((scene) => scene.hidden !== true)
    .map((scene) => [scene.type, scene.title, scene.narration, scene.onScreenText]);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function parseIllustration(json: string | null): Illustration | null {
  if (!json) return null;
  try {
    const parsed = illustrationSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// How fast the video's narration will be voiced, for estimating scene lengths before there is any audio.
export const narrationRateOf = (video: { pace: string }): number => syllablesPerSecond(toPace(video.pace));

// Fields are copied explicitly so callers passing richer objects (DTOs, form state) never leak extra keys into Prisma.
export function buildSceneRecord(scene: SceneContent, syllablesPerSecond?: number): NewSceneRecord {
  const estimatedSeconds = estimateNarrationSeconds(scene.narration, syllablesPerSecond);
  return {
    type: scene.type,
    title: scene.title,
    narration: scene.narration,
    onScreenText: scene.onScreenText,
    visualVariant: scene.visualVariant,
    hookVariant: scene.hookVariant,
    estimatedSeconds,
    durationFrames: secondsToFrames(estimatedSeconds),
    contentHash: sceneContentHash(scene),
    illustrationJson: scene.illustration
      ? JSON.stringify({ setting: scene.illustration.setting, action: scene.illustration.action })
      : null,
  };
}
