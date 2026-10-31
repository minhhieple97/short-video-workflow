import { PRODUCTION_STEP_COUNT, PRODUCTION_STEP_LABELS, productionStep } from "./production-labels";
import { hasReachedCheckpoint, type ItemCheckpoint, type ItemStatus } from "./production-status";

export type StepState = "done" | "current" | "stopped" | "todo";

export interface StepView {
  label: string;
  state: StepState;
}

// Every step with where the item stands: finished steps are done, the next one is current while the item is alive
// and stopped once it failed or was cancelled, the rest are still to do.
export function productionSteps(checkpoint: ItemCheckpoint, status: ItemStatus): StepView[] {
  const { done } = productionStep(checkpoint);
  const halted = status === "FAILED" || status === "CANCELLED";
  return PRODUCTION_STEP_LABELS.map((label, index) => {
    if (index < done || status === "COMPLETED") return { label, state: "done" };
    if (index === done) return { label, state: halted ? "stopped" : "current" };
    return { label, state: "todo" };
  });
}

// One sentence that says which step the item is at, so "2/6" never has to be read on its own.
export function describeProductionStep(checkpoint: ItemCheckpoint, status: ItemStatus): string {
  const { done, label } = productionStep(checkpoint);
  if (status === "COMPLETED" || done >= PRODUCTION_STEP_COUNT) return `Đã xong cả ${PRODUCTION_STEP_COUNT} bước`;
  const place = `bước ${done + 1}/${PRODUCTION_STEP_COUNT}: ${label}`;
  switch (status) {
    case "FAILED":
      return `Dừng ở ${place}`;
    case "CANCELLED":
      return `Đã huỷ ở ${place}`;
    case "RUNNING":
      return `Đang làm ${place}`;
    case "WAITING":
      return `Đang chờ ở ${place}`;
    default:
      return `Chờ tới lượt · ${place}`;
  }
}

export interface VideoContent {
  scriptVersion: number;
  sceneCount: number;
  voicedSceneCount: number;
}

// What the video holds right now: its script version and its visible scenes, and how many of those have a voice-over.
export function videoContentOf(video: {
  scriptVersion: number;
  scenes: readonly { audioAssetId: string | null }[];
}): VideoContent {
  return {
    scriptVersion: video.scriptVersion,
    sceneCount: video.scenes.length,
    voicedSceneCount: video.scenes.filter((scene) => scene.audioAssetId !== null).length,
  };
}

// The scenes of a video are written by the "Áp dụng kịch bản" step. Scenes found while the item stands before it were
// left by an earlier pass (one that an AI correction sent back), so the checkpoint says less than the video holds.
export function contentFromEarlierPass(checkpoint: ItemCheckpoint, content: VideoContent): VideoContent | null {
  return content.sceneCount > 0 && !hasReachedCheckpoint(checkpoint, "APPLIED") ? content : null;
}
