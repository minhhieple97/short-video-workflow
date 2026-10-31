import type { RenderMode } from "@/features/videos/domain/scene-shots";

export type TransitionKind = "none" | "slide" | "wipe" | "fade";

export interface SceneTransition {
  kind: TransitionKind;
  frames: number;
  direction: "from-right" | "from-left";
}

// What the picture shows where a scene starts or ends: its first or its last shot.
export interface CutEdge {
  mode: RenderMode;
  setting: string;
}

export interface SceneCut {
  enter: CutEdge;
  exit: CutEdge;
  durationInFrames: number;
}

const CUT: SceneTransition = { kind: "none", frames: 0, direction: "from-right" };

// How the picture moves from one scene to the next. Staying in the same place is a straight cut (the next scene opens on
// another shot size); a new place wipes; text cards slide in and out.
export function transitionBetween(previous: CutEdge, next: CutEdge): SceneTransition {
  if (previous.mode === "STAGE" && next.mode === "STAGE") {
    return previous.setting === next.setting ? CUT : { kind: "wipe", frames: 12, direction: "from-right" };
  }
  if (previous.mode === "TEXT" && next.mode === "TEXT") return { kind: "fade", frames: 8, direction: "from-right" };
  return { kind: "slide", frames: 12, direction: next.mode === "TEXT" ? "from-right" : "from-left" };
}

// The pictures overlap during a transition, but every scene's voice and captions keep their own exact frames. So each
// picture is drawn for its own length plus the transition after it: every picture then starts on the frame its voice
// starts, and the video's length stays the sum of the scenes.
export function planSceneVisuals(scenes: readonly SceneCut[]): { durationInFrames: number; after: SceneTransition }[] {
  return scenes.map((scene, index) => {
    const next = scenes[index + 1];
    const after = next ? transitionBetween(scene.exit, next.enter) : CUT;
    // A transition can never be longer than either scene it joins.
    const frames = next ? Math.min(after.frames, scene.durationInFrames, next.durationInFrames) : 0;
    return { durationInFrames: scene.durationInFrames + frames, after: { ...after, frames } };
  });
}
