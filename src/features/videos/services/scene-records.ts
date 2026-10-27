import { createHash } from "node:crypto";

import type { NewSceneRecord } from "../repositories/video.repository";
import { estimateNarrationSeconds, secondsToFrames } from "../domain/duration";

export interface SceneContent {
  type: string;
  title: string | null;
  narration: string;
  onScreenText: string;
  visualVariant: string;
  hookVariant: string | null;
}

export function sceneContentHash(
  scene: Pick<SceneContent, "type" | "narration" | "onScreenText" | "visualVariant">,
): string {
  return createHash("sha256")
    .update(JSON.stringify([scene.type, scene.narration, scene.onScreenText, scene.visualVariant]))
    .digest("hex");
}

// Fields are copied explicitly so callers passing richer objects (DTOs, form state) never leak extra keys into Prisma.
export function buildSceneRecord(scene: SceneContent): NewSceneRecord {
  const estimatedSeconds = estimateNarrationSeconds(scene.narration);
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
  };
}
