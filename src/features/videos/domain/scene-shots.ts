import type { VisualVariant } from "./scene-types";

// A scene's picture is cut into shots that share its one voice-over, so the picture changes every few seconds without
// another TTS clip or a pause. Shots are whole frames of the scene, back to back from frame 0.

export const SHOT_SIZES = ["WIDE", "MEDIUM", "CLOSE"] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];

export const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
  WIDE: "Toàn cảnh",
  MEDIUM: "Trung cảnh",
  CLOSE: "Cận mặt",
};

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

// A text card fills the screen whatever the scene's layout; any other shot is drawn the way its scene is.
export function shotRenderMode(layout: VisualVariant, shot: { card: unknown }): RenderMode {
  return shot.card ? "TEXT" : renderModeFor(layout);
}

// How many even pieces a stretch of picture is cut into so that none is longer than five seconds or shorter than the minimum.
function pieceCount(length: number): number {
  return Math.max(1, Math.min(Math.ceil(length / MAX_SHOT_FRAMES), Math.floor(length / MIN_SHOT_FRAMES)));
}

function splitEvenly(start: number, length: number): number[] {
  const pieces = pieceCount(length);
  return Array.from({ length: pieces }, (_, piece) => start + Math.round((piece * length) / pieces));
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
  return starts.flatMap((start, index) => splitEvenly(start, (bounds[index + 1] ?? sceneFrames) - start));
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

// A cut this close to a caption page turn moves onto it, so the picture and the captions change together.
export const SHOT_SNAP_FRAMES = 12;

export interface ShotCue {
  // The frame the shot's first word is spoken on.
  frame: number;
  size?: ShotSize;
  // A text card plays its own animation once, so it is never cut into camera pieces.
  card: boolean;
}

export interface PlacedShot extends SceneShot {
  // Which planned shot this piece of picture shows.
  plan: number;
}

function snapToPage(frame: number, pageStarts: readonly number[]): number {
  const nearest = pageStarts.reduce(
    (best, start) => (Math.abs(start - frame) < Math.abs(best - frame) ? start : best),
    Number.POSITIVE_INFINITY,
  );
  return Math.abs(nearest - frame) <= SHOT_SNAP_FRAMES ? nearest : frame;
}

// The planned shots of a scene on its frames. The first starts at frame 0; a later one starts on its first word, unless it
// would leave a shot under the minimum, in which case it is skipped and the picture before it stays up. A cartoon shot
// longer than five seconds is cut into even pieces that alternate the camera, all showing the same picture. A scene
// drawn as text has nothing to cut between two plain shots, so they merge; only a card starts or ends a shot there.
export function placePlannedShots(
  cues: readonly ShotCue[],
  pageStarts: readonly number[],
  sceneFrames: number,
  startWith: ShotSize,
  mode: RenderMode,
): PlacedShot[] {
  const starts = [{ frame: 0, plan: 0 }];
  cues.forEach((cue, plan) => {
    if (plan === 0) return;
    const frame = snapToPage(cue.frame, pageStarts);
    const last = starts.at(-1);
    const bothPlain = mode === "TEXT" && !cue.card && !cues[last?.plan ?? 0]?.card;
    if (!bothPlain && frame - (last?.frame ?? 0) >= MIN_SHOT_FRAMES && sceneFrames - frame >= MIN_SHOT_FRAMES) {
      starts.push({ frame, plan });
    }
  });
  let size = startWith;
  return starts.flatMap(({ frame, plan }, index) => {
    const end = starts[index + 1]?.frame ?? sceneFrames;
    const cue = cues[plan];
    const whole = cue?.card === true || mode === "TEXT";
    const pieces = whole ? [frame] : splitEvenly(frame, end - frame);
    return pieces.map((startFrame, piece) => {
      const pieceSize = piece === 0 && cue?.size ? cue.size : size;
      if (!whole) size = alternateShotSize(pieceSize);
      return { startFrame, durationInFrames: (pieces[piece + 1] ?? end) - startFrame, size: pieceSize, plan };
    });
  });
}
