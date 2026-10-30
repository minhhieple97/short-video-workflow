import type { VisualVariant } from "./scene-types";

// A scene's picture is cut into shots that share its one voice-over, so the picture changes every few seconds without
// another TTS clip or a pause. Shots are whole frames of the scene, back to back from frame 0.

export const SHOT_SIZES = ["WIDE", "MEDIUM", "CLOSE"] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];

export interface SceneShot {
  startFrame: number;
  durationInFrames: number;
  size: ShotSize;
}

export const MIN_SHOT_FRAMES = 54;
export const TARGET_SHOT_FRAMES = 75;
export const MAX_SHOT_FRAMES = 150;

export type RenderMode = "STAGE" | "TEXT";

// The cartoon stage for story moments, full-screen kinetic text for the lesson and the action.
export function renderModeFor(layout: VisualVariant): RenderMode {
  return layout === "BIG_TAKEAWAY" || layout === "ACTION_CHECKLIST" ? "TEXT" : "STAGE";
}

// Shot starts: a cut lands on the start of a caption page once the running shot has lasted about two and a half seconds,
// and never leaves a sliver at the end; any shot still longer than five seconds is split evenly.
export function shotStarts(pageStarts: readonly number[], sceneFrames: number): number[] {
  const starts = [0];
  for (const candidate of [...pageStarts].sort((left, right) => left - right)) {
    const last = starts.at(-1) ?? 0;
    if (candidate - last >= TARGET_SHOT_FRAMES && sceneFrames - candidate >= MIN_SHOT_FRAMES) starts.push(candidate);
  }
  const bounds = [...starts, sceneFrames];
  return starts.flatMap((start, index) => {
    const length = (bounds[index + 1] ?? sceneFrames) - start;
    const pieces = Math.max(1, Math.min(Math.ceil(length / MAX_SHOT_FRAMES), Math.floor(length / MIN_SHOT_FRAMES)));
    return Array.from({ length: pieces }, (_, piece) => start + Math.round((piece * length) / pieces));
  });
}

export function alternateShotSize(size: ShotSize): ShotSize {
  return size === "WIDE" ? "MEDIUM" : "WIDE";
}

// Shots of one scene, sized wide and medium in turn. `startWith` lets a scene that cuts straight on from the same place
// open on the other size, so the cut reads as a cut.
export function buildSceneShots(
  pageStarts: readonly number[],
  sceneFrames: number,
  mode: RenderMode,
  startWith: ShotSize,
): SceneShot[] {
  const starts = mode === "TEXT" ? [0] : shotStarts(pageStarts, sceneFrames);
  let size = startWith;
  return starts.map((startFrame, index) => {
    const shot = { startFrame, durationInFrames: (starts[index + 1] ?? sceneFrames) - startFrame, size };
    size = alternateShotSize(size);
    return shot;
  });
}
