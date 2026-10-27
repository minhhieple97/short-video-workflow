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

export function buildSceneRecord(scene: SceneContent): NewSceneRecord {
  const estimatedSeconds = estimateNarrationSeconds(scene.narration);
  return {
    ...scene,
    estimatedSeconds,
    durationFrames: secondsToFrames(estimatedSeconds),
    contentHash: sceneContentHash(scene),
  };
}
